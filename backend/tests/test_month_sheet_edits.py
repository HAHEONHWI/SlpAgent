from concurrent.futures import ThreadPoolExecutor

import pytest

from app.repo.base import RevisionConflict
from tests.conftest import H


def test_empty_month_cell_adds_only_one_dated_lesson(client, repo, child):
    body = {'child_id': child['id'], 'date': '2026-11-02', 'start': '09:00'}
    response = client.post('/schedules/month-sheet', headers=H(), json=body)
    assert response.status_code == 201
    row = response.json()
    assert (row['end'], row['therapist']) == ('09:40', child['therapist'])
    assert repo.list('timetable_entries', 'orgA') == [] and repo.list('pay_plans', 'orgA') == []
    assert client.post('/schedules/month-sheet', headers=H(), json=body).status_code == 409
    assert client.post('/schedules/month-sheet', headers=H(), json={**body, 'date': '2026-11-03', 'therapist': '동료'}).status_code == 404
    sheet = client.get('/month-sheet?month=2026-11', headers=H()).json()
    assert [c['id'] for c in sheet['classes']] == [row['id']]
    assert sheet['aliases'][child['id']] == child['alias']
    assert client.get('/attendance/day?on=2026-11-02', headers=H()).json()[0]['schedule_id'] == row['id']


def test_month_cell_foreign_reserved_slot_is_anonymous(client, repo, child):
    other = client.post('/children', headers=H(role='admin'), json={'alias': 'OTHER', 'display_name': '비공개아동', 'birth_date': '2020-01-01', 'therapist': '동료'}).json()
    _lesson(client, other, date='2026-11-02', start='09:00', therapist=child['therapist'])
    sheet = client.get('/month-sheet?month=2026-11', headers=H()).json()
    assert sheet['reserved'] == [{'date': '2026-11-02', 'start': '09:00', 'end': '09:40'}]
    assert other['id'] not in str(sheet) and other['display_name'] not in str(sheet)
    assert client.post('/schedules/month-sheet', headers=H(), json={'child_id': other['id'], 'date': '2026-11-02', 'start': '11:00'}).status_code == 404
    assert client.post('/schedules/month-sheet', headers=H(), json={'child_id': child['id'], 'date': '2026-11-02', 'start': '09:00'}).status_code == 409


def test_unlinked_admin_can_edit_every_teacher_in_own_organization(client, repo, child):
    headers = H(role='admin', uid='unlinked-admin')
    lesson = _lesson(client, child)
    sheet = client.get('/month-sheet?month=2026-11', headers=headers).json()
    assert sheet['can_edit'] and sheet['classes'][0]['can_edit']
    move = {'date': lesson['date'], 'start': '14:00', 'expected_revision': lesson['updated_at']}
    assert client.put(f"/schedules/{lesson['id']}/month-sheet", headers=headers, json=move).status_code == 200
    assert client.put(f"/children/{child['id']}/pay-plan?month=2026-11", headers=headers,
                      json={'same_as_actual': False, 'slots': [{'date': lesson['date'], 'start': '14:00'}]}).status_code == 200
    assert client.post('/schedules/month-sheet', headers=headers, json={'child_id': child['id'], 'date': '2026-11-11', 'start': '09:00', 'therapist': child['therapist']}).status_code == 201
    assert client.get('/me/payment-settings', headers=headers).status_code == 403


def _lesson(client, child, **fields):
    response = client.post("/schedules", headers=H(role="admin"), json={
        "child_id": child["id"], "date": "2026-11-10", "start": "12:00", "note": "기존 메모",
        "pay": "private", **fields})
    assert response.status_code == 201
    return response.json()


def test_monthly_edit_moves_only_own_lesson_and_preserves_payment(client, repo, child):
    lesson = _lesson(client, child)
    client.put(f"/schedules/{lesson['id']}/attendance", headers=H(), json={"status": "late", "minutes_late": 5})
    sheet = client.get("/month-sheet?month=2026-11", headers=H()).json()
    assert sheet["can_edit"] and sheet["plans"][0]["can_edit"]
    [row] = sheet["classes"]
    assert row == {**{key: lesson[key] for key in ("id", "child_id", "date", "start", "end", "note")},
                   "pay": "private", "revision": lesson["updated_at"], "can_edit": True}
    url = f"/schedules/{lesson['id']}/month-sheet"
    move = {"date": "2026-11-11", "start": "13:10", "note": "이번 회차만"}
    assert client.put(url, headers=H(), json=move).status_code == 422
    move["expected_revision"] = row["revision"]
    assert client.put(url, headers=H(), json={**move, "pay": "voucher"}).status_code == 422
    updated = client.put(url, headers=H(), json=move).json()
    assert (updated["end"], updated["pay"], updated["note"]) == ("13:50", "private", "이번 회차만")
    [row] = client.get("/month-sheet?month=2026-11", headers=H()).json()["classes"]
    assert (row["date"], row["start"], row["note"]) == ("2026-11-11", "13:10", "이번 회차만")
    mark = repo.get("attendance", "orgA", lesson["id"])
    assert (mark["date"], mark["start"], mark["status"]) == (row["date"], row["start"], "late")


def test_second_open_monthly_editor_must_reload_after_the_first_saves(client, repo, child):
    lesson = _lesson(client, child)
    path = "/month-sheet?month=2026-11"
    web_revision = client.get(path, headers=H()).json()["classes"][0]["revision"]
    app_revision = client.get(path, headers=H()).json()["classes"][0]["revision"]
    url = f"/schedules/{lesson['id']}/month-sheet"
    move = {"date": lesson["date"], "start": "14:00", "expected_revision": web_revision}
    assert client.put(url, headers=H(), json=move).status_code == 200
    assert client.put(url, headers=H(), json={**move, "start": "15:00", "expected_revision": app_revision}).status_code == 409
    [row] = client.get(path, headers=H()).json()["classes"]
    assert row["start"] == "14:00" and row["revision"] != app_revision
    assert len(repo.list("audit_logs", "orgA", action="update", collection="schedules")) == 1
    assert client.put(url, headers=H(), json={**move, "start": "15:00", "expected_revision": row["revision"]}).status_code == 200


def test_monthly_edit_rechecks_teacher_after_timetable_sync(client, repo, child, monkeypatch):
    lesson = _lesson(client, child)

    def reassign(repo, org_id, month):
        repo.update("schedules", org_id, lesson["id"], {"therapist": "다른 치료사"})

    monkeypatch.setattr("app.routers.timetable.sync_month", reassign)
    response = client.put(f"/schedules/{lesson['id']}/month-sheet", headers=H(),
                          json={"date": lesson["date"], "start": "15:00", "expected_revision": lesson["updated_at"]})
    assert response.status_code == 404 and repo.get("schedules", "orgA", lesson["id"])["start"] == lesson["start"]


@pytest.mark.parametrize("headers,code", [(H(uid="no-link"), 404),
                                          (H(role="assistant"), 403), (H(org="orgB", role="admin"), 404)])
def test_other_accounts_cannot_write_month_class_or_plan(client, child, headers, code):
    lesson = _lesson(client, child)
    month = "month=2026-11"
    sheet = client.get(f"/month-sheet?{month}&therapist={child['therapist']}", headers=headers).json()
    assert not sheet["can_edit"]
    assert not any(row["can_edit"] for row in sheet["plans"] + sheet["classes"])
    assert client.put(f"/schedules/{lesson['id']}/month-sheet", headers=headers,
                      json={"date": lesson["date"], "start": "13:00", "expected_revision": lesson["updated_at"]}).status_code == code
    assert client.put(f"/children/{child['id']}/pay-plan?{month}", headers=headers, json={
        "same_as_actual": False, "slots": [{"date": lesson["date"], "start": "13:00"}]}).status_code == code


def test_different_teachers_child_and_substitute_class_stay_protected(client, repo, child):
    other = client.post("/children", headers=H(role="admin"), json={
        "alias": "B-02", "display_name": "합성아동", "birth_date": "2020-01-01", "therapist": "동료"}).json()
    colleague_lesson = _lesson(client, child, therapist="동료")
    substitute_lesson = _lesson(client, other, therapist=child["therapist"], start="13:00")
    for lesson in (colleague_lesson, substitute_lesson):
        url = f"/schedules/{lesson['id']}/month-sheet"
        for headers in (H(),):
            assert client.put(url, headers=headers, json={
                "date": lesson["date"], "start": "13:00", "expected_revision": lesson["updated_at"]}).status_code == 404
    assert client.get("/month-sheet?month=2026-11", headers=H()).json()["classes"] == []
    sheet = client.get("/month-sheet?month=2026-11&therapist=동료", headers=H(role="admin")).json()
    assert sheet["can_edit"] and all(row["can_edit"] for row in sheet["plans"] + sheet["classes"])
    assert [plan["child_id"] for plan in sheet["plans"]] == [other["id"]]
    assert client.put(f"/children/{other['id']}/pay-plan?month=2026-11", headers=H(role="admin"),
                      json={"same_as_actual": False, "slots": [{"date": "2026-11-09", "start": "12:00"}]}).status_code == 200
    repo.update("children", "orgA", child["id"], {"archived": True})
    assert client.put(f"/children/{child['id']}/pay-plan?month=2026-11", headers=H(),
                      json={"same_as_actual": False, "slots": [{"date": "2026-11-09", "start": "12:00"}]}).status_code == 404


def test_plan_for_child_without_class_requires_current_revision_and_explicit_mode(client, repo, child):
    url = f"/children/{child['id']}/pay-plan?month=2026-11"
    manual = {"same_as_actual": False, "slots": [{"date": "2026-11-09", "start": "12:00"}]}
    assert client.put(url, headers=H(), json={"slots": []}).status_code == 422
    assert client.put(url, headers=H(), json={"same_as_actual": False, "slots": []}).status_code == 422
    assert client.put(url, headers=H(), json={"same_as_actual": True}).status_code == 409
    first = client.put(url, headers=H(), json=manual).json()
    assert client.put(url, headers=H(), json=manual).status_code == 409
    [plan] = client.get("/month-sheet?month=2026-11", headers=H()).json()["plans"]
    assert plan["can_edit"] and plan["mode"] == "manual" and plan["revision"] == first["updated_at"]
    body = {**manual, "expected_revision": plan["revision"], "slots": [{"date": "2026-11-11", "start": "14:00"}]}
    saved = client.put(url, headers=H(), json=body).json()
    assert saved["slots"] == body["slots"] and saved["updated_at"] != first["updated_at"]
    assert client.put(url, headers=H(), json=body).status_code == 409
    assert len(repo.list("audit_logs", "orgA", collection="pay_plans")) == 2


def test_manual_voucher_dates_follow_per_class_payment_edits(client, child):
    first = _lesson(client, child, date="2026-11-02", start="10:00", pay="voucher")
    second = _lesson(client, child, date="2026-11-03", start="10:00", pay="voucher")
    url = f"/children/{child['id']}/pay-plan?month=2026-11"
    saved = client.put(url, headers=H(), json={"same_as_actual": False, "slots": [
        {"date": first["date"], "start": first["start"]}, {"date": second["date"], "start": second["start"]},
    ]})
    assert saved.status_code == 200
    assert client.put(f"/schedules/{first['id']}/pay", headers=H(), json={"pay": "private"}).status_code == 200

    visits = client.get(f"/children/{child['id']}/voucher-visits?month=2026-11", headers=H()).json()["visits"]
    sheet = client.get("/month-sheet?month=2026-11", headers=H()).json()
    [plan] = sheet["plans"]
    assert [(v["date"], v["start"]) for v in visits] == [(second["date"], second["start"])]
    assert plan["slots"] == [{"date": second["date"], "start": second["start"]}]
    assert {row["id"]: row["pay"] for row in sheet["classes"]} == {first["id"]: "private", second["id"]: "voucher"}


@pytest.mark.parametrize("target", ["schedules", "pay_plans"])
def test_reassignment_before_commit_preserves_class_mark_plan_and_audit(client, repo, child, monkeypatch, target):
    lesson = _lesson(client, child)
    client.put(f"/schedules/{lesson['id']}/attendance", headers=H(), json={"status": "late", "minutes_late": 5})
    before_mark = repo.get("attendance", "orgA", lesson["id"])
    audit_rows = repo.list("audit_logs", "orgA", action="update", collection=target)
    original = repo.save_versioned

    def reassigned(*args, **kwargs):
        repo.update("children", "orgA", child["id"], {"therapist": "다른 치료사"})
        return original(*args, **kwargs)

    monkeypatch.setattr(repo, "save_versioned", reassigned)
    if target == "schedules":
        response = client.put(f"/schedules/{lesson['id']}/month-sheet", headers=H(),
                              json={"date": lesson["date"], "start": "15:00", "expected_revision": lesson["updated_at"]})
    else:
        response = client.put(f"/children/{child['id']}/pay-plan?month=2026-11", headers=H(),
                              json={"same_as_actual": False, "slots": [{"date": lesson["date"], "start": "15:00"}]})
    assert response.status_code == 409
    assert repo.get("schedules", "orgA", lesson["id"]) == lesson
    assert repo.get("attendance", "orgA", lesson["id"]) == before_mark
    assert repo.list("pay_plans", "orgA") == []
    assert repo.list("audit_logs", "orgA", action="update", collection=target) == audit_rows


def test_only_one_writer_can_replace_a_revision(repo):
    first = repo.save_versioned("pay_plans", "orgA", "plan", {"preserved": True}, None)

    def save(i):
        try:
            return repo.save_versioned("pay_plans", "orgA", "plan", {"i": i}, first["updated_at"])
        except RevisionConflict:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, (1, 2)))
    [saved] = [result for result in results if result is not None]
    assert saved["preserved"] and saved["created_at"] == first["created_at"]
    with pytest.raises(RevisionConflict):
        repo.save_versioned("pay_plans", "orgB", "plan", {}, saved["updated_at"])
