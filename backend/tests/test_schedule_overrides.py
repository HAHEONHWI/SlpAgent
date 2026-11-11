"""One dated class may change without changing its fixed weekly timetable."""
import pytest

from app.routers.timetable import touch_timetable
from tests.conftest import H


def test_old_client_can_move_pending_class_into_absent_slot(client, repo, child):
    day = "2026-11-02"
    other = client.post("/children", headers=H(), json={
        "alias": "B-02", "display_name": "가상아동", "birth_date": "2021-01-01", "therapist": child["therapist"]}).json()

    def lesson(cid, start, end):
        result = client.post("/schedules", headers=H(), json={
            "child_id": cid, "date": day, "start": start, "end": end, "extra": "voucher"})
        assert result.status_code == 201
        return result.json()

    first = lesson(other["id"], "09:00", "09:40")
    second = lesson(child["id"], "09:40", "10:20")
    [shown] = client.get(f"/schedules?month=2026-11&child_id={child['id']}", headers=H()).json()
    assert shown["pay"] == "pending"
    url = f"/schedules/{second['id']}"
    move = {"date": day, "start": "09:00", "end": "09:40", "pay": shown["pay"]}
    assert client.put(url, headers=H(), json=move).status_code == 409
    assert client.put(f"/schedules/{first['id']}/attendance", headers=H(), json={"status": "absent"}).status_code == 200
    assert client.put(url, headers=H(), json=move).status_code == 200
    saved = repo.get("schedules", "orgA", second["id"])
    assert (saved["start"], saved["end"]) == ("09:00", "09:40")
    assert (saved["pay"], saved["extra"], saved["note"]) == (second["pay"], second["extra"], second["note"])
    [shown] = client.get(f"/schedules?month=2026-11&child_id={child['id']}", headers=H()).json()
    assert shown["pay"] == "pending"
    assert client.put(url + "/pay", headers=H(), json={"pay": "pending"}).status_code == 422
    assert client.put(url + "/pay", headers=H(), json={"pay": "private"}).status_code == 200
    assert client.put(url, headers=H(), json=move).json()["pay"] == "private"


@pytest.fixture
def weekly(client, repo, child):
    config = {"teachers": [{"id": "t", "name": child["therapist"], "short": "김", "color": "#2563eb"}]}
    assert client.put("/timetable/config", headers=H(role="admin"), json=config).status_code == 200
    entry = client.post("/timetable/entries", headers=H(), json={
        "day": 1, "slot": "09:00", "teacher_id": "t", "child_id": child["id"], "note": "고정 메모"}).json()
    rows = client.get("/schedules?month=2099-03", headers=H()).json()
    return entry, repo.get("schedules", "orgA", rows[0]["id"])


@pytest.mark.parametrize("day", ["2099-03-03", "2099-04-01"])
def test_edited_weekly_class_stays_changed_after_resync(client, repo, weekly, day):
    entry, schedule = weekly

    response = client.put(f"/schedules/{schedule['id']}", headers=H(), json={
        "date": day, "start": "09:50", "note": "이 날짜만 변경"})

    assert response.status_code == 200
    assert (response.json()["date"], response.json()["end"], response.json()["note"]) == (day, "10:30", "이 날짜만 변경")
    assert repo.get("timetable_entries", "orgA", entry["id"]) == entry
    touch_timetable(repo, "orgA")
    march = client.get("/schedules?month=2099-03", headers=H()).json()
    client.get("/schedules?month=2099-04", headers=H())
    assert "2099-03-02" not in {row["date"] for row in march}
    assert repo.get("schedules", "orgA", schedule["id"])["date"] == day
    assert repo.get("schedules", "orgA", schedule["id"])["note"] == "이 날짜만 변경"


def test_manual_class_survives_weekly_config_and_holiday_changes(client, repo, weekly):
    entry, schedule = weekly
    response = client.put(f"/schedules/{schedule['id']}", headers=H(), json={"date": "2099-03-03", "start": "09:50"})
    assert response.status_code == 200

    client.put("/timetable/entries/" + entry["id"], headers=H(), json={
        "day": 1, "slot": "10:40", "teacher_id": "t", "child_id": schedule["child_id"]})
    client.put("/org/holidays", headers=H(role="admin"), json={"holidays": [{"date": "2099-03-03"}]})
    client.put("/org/holidays", headers=H(role="admin"), json={"holidays": []})
    rows = client.get("/schedules?month=2099-03", headers=H()).json()

    assert [(row["date"], row["start"]) for row in rows if row["id"] == schedule["id"]] == [("2099-03-03", "09:50")]
    assert repo.get("schedules", "orgA", schedule["id"])["note"] == "고정 메모"


def test_recording_defaults_follow_dated_class_start_and_keep_class_duration(client, repo, weekly):
    _, schedule = weekly
    day = "2099-03-03"
    url = f"/schedules?child_id={schedule['child_id']}&month=2099-03"
    for start, end, suggestion in [("09:50", "10:10", "10:30"), ("23:19", "23:45", "23:59"),
                                   ("23:20", "23:45", None)]:
        response = client.put(f"/schedules/{schedule['id']}", headers=H(), json={"date": day, "start": start, "end": end})
        assert response.status_code == 200
        [row] = [s for s in client.get(url, headers=H()).json() if s["date"] == day]
        assert (row["start"], row["end"], row["recording_end"]) == (start, end, suggestion)
    assert "recording_end" not in repo.get("schedules", "orgA", schedule["id"])
    repo.update("schedules", "orgA", schedule["id"], {"start": "25:00"})
    [legacy] = [s for s in client.get(url, headers=H()).json() if s["date"] == day]
    assert legacy["recording_end"] is None


def test_dated_edit_preserves_attendance_and_unspecified_note(client, repo, weekly):
    _, schedule = weekly
    client.put(f"/schedules/{schedule['id']}/attendance", headers=H(), json={"status": "late", "minutes_late": 5})

    response = client.put(f"/schedules/{schedule['id']}", headers=H(), json={"date": "2099-03-03", "start": "09:50"})

    assert response.status_code == 200 and response.json()["note"] == "고정 메모"
    mark = repo.get("attendance", "orgA", schedule["id"])
    assert (mark["date"], mark["start"], mark["status"]) == ("2099-03-03", "09:50", "late")


@pytest.mark.parametrize("day", ["2099-03-09", "2099-04-06"])
def test_dated_edit_still_rejects_overlapping_classes(client, repo, weekly, day):
    _, schedule = weekly

    response = client.put(f"/schedules/{schedule['id']}", headers=H(), json={"date": day, "start": "09:00"})

    assert response.status_code == 409
    assert repo.get("schedules", "orgA", schedule["id"])["date"] == "2099-03-02"


def test_repeated_moves_keep_the_original_timetable_date_and_can_clear_note(client, repo, weekly):
    entry, schedule = weekly
    client.put(f"/schedules/{schedule['id']}", headers=H(), json={"date": "2099-03-03", "start": "09:50", "note": "변경 메모"})

    response = client.put(f"/schedules/{schedule['id']}", headers=H(), json={"date": "2099-04-01", "start": "10:40", "note": None})

    assert response.status_code == 200 and response.json()["note"] is None
    assert response.json()["timetable_date"] == "2099-03-02"
    touch_timetable(repo, "orgA")
    rows = client.get("/schedules?month=2099-03", headers=H()).json()
    assert "2099-03-02" not in {row["date"] for row in rows}
    assert repo.get("timetable_entries", "orgA", entry["id"]) == entry


@pytest.mark.parametrize("headers,status", [(H("orgB"), 404), (H(uid="u2"), 404), (H(role="assistant"), 403)])
def test_dated_edit_keeps_role_and_child_permissions(client, repo, weekly, headers, status):
    _, schedule = weekly

    response = client.put(f"/schedules/{schedule['id']}", headers=headers, json={"date": "2099-03-03", "start": "09:50"})

    assert response.status_code == status
    assert repo.get("schedules", "orgA", schedule["id"]) == schedule


def test_cancelled_schedule_can_be_restored_and_keeps_attendance(client, repo, child):
    schedule = client.post("/schedules", headers=H(), json={
        "child_id": child["id"], "date": "2026-11-03", "start": "09:00"}).json()
    assert client.put(f"/schedules/{schedule['id']}/attendance", headers=H(), json={"status": "present"}).status_code == 200
    assert client.post(f"/schedules/{schedule['id']}/cancel", headers=H()).status_code == 200

    restored = client.post(f"/schedules/{schedule['id']}/restore", headers=H())

    assert restored.status_code == 200 and restored.json()["status"] == "scheduled"
    assert repo.get("attendance", "orgA", schedule["id"])["status"] == "present"
    assert client.get("/attendance/day?on=2026-11-03", headers=H()).json()[0]["schedule_id"] == schedule["id"]
    assert len(repo.list("audit_logs", "orgA", action="restore", collection="schedules")) == 1
    for headers, status in ((H("orgB"), 404), (H(uid="u2"), 404), (H(role="assistant"), 403)):
        assert client.post(f"/schedules/{schedule['id']}/restore", headers=headers).status_code == status


def test_restore_rejects_conflicting_and_system_cancelled_schedules(client, repo, child):
    day = "2026-11-03"
    cancelled = client.post("/schedules", headers=H(), json={
        "child_id": child["id"], "date": day, "start": "09:00"}).json()
    client.post(f"/schedules/{cancelled['id']}/cancel", headers=H())
    occupying = client.post("/schedules", headers=H(), json={
        "child_id": child["id"], "date": day, "start": "09:00"}).json()
    assert client.post(f"/schedules/{cancelled['id']}/restore", headers=H()).status_code == 409
    assert repo.get("schedules", "orgA", cancelled["id"])["status"] == "cancelled"

    repo.update("schedules", "orgA", occupying["id"], {"date": "2026-11-04"})
    repo.update("schedules", "orgA", cancelled["id"], {"cancel_reason": "아동 종결"})
    assert client.post(f"/schedules/{cancelled['id']}/restore", headers=H()).status_code == 409
