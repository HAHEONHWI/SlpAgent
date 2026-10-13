from tests.conftest import H


def test_unauthenticated_rejected(client):
    assert client.get("/children").status_code == 401


def test_org_isolation(client, child):
    assert client.get(f"/children/{child['id']}", headers=H("orgB")).status_code == 404
    assert client.get("/children", headers=H("orgB")).json() == []
    assert client.post(f"/children/{child['id']}/vocabulary", headers=H("orgB"), json={
        "word": "공", "modality": "expressive", "status": "emerging", "observed_on": "2026-10-01"}).status_code == 404


def test_assistant_is_read_only(client, child):
    assert client.post("/children", headers=H(role="assistant"), json={"alias": "x", "display_name": "x", "birth_date": "2022-01-01"}).status_code == 403
    assert client.get("/children", headers=H(role="assistant")).status_code == 200


def test_assessment_never_invents_scores(client, child):
    r = client.post(f"/children/{child['id']}/assessments", headers=H(), json={
        "test_code": "PRES", "assessed_on": "2026-09-01", "examiner": "김", "raw_total": 12,
        "items": [{"item_id": "수용-1", "response": "2/3"}]})
    d = r.json()
    assert r.status_code == 201 and d["age_months_at_test"] == 53
    assert d["derived_scores"]["percentile"] is None and d["derived_scores"]["status"] == "norm_unavailable"
    assert client.post(f"/children/{child['id']}/assessments", headers=H(), json={
        "test_code": "FAKE", "assessed_on": "2026-09-01", "examiner": "김"}).status_code == 422


def test_behavior_intensity_needs_org_scale(client, repo, child):
    body = {"observed_at": "2026-10-01T10:00:00", "antecedent": "a", "behavior": "b", "consequence": "c", "observer": "김", "intensity": 3}
    assert client.post(f"/children/{child['id']}/behavior", headers=H(), json=body).status_code == 422
    repo.create("organizations", "orgA", {"behavior_scale": {"min": 1, "max": 3}}, doc_id="orgA")
    assert client.post(f"/children/{child['id']}/behavior", headers=H(), json=body).status_code == 201
    assert client.post(f"/children/{child['id']}/behavior", headers=H(), json={**body, "intensity": 9}).status_code == 422


def _session(client, child, date, start, end, status="completed"):
    return client.post(f"/children/{child['id']}/sessions", headers=H(), json={
        "date": date, "start": start, "end": end, "status": status, "therapist": "김",
        "activities": [{"name": "모방", "correct": 3, "trials": 5, "prompt_level": "모델"}]}).json()


def test_billing_computed_in_code(client, child):
    s = _session(client, child, "2026-10-02", "10:00", "10:40")
    assert s["minutes"] == 40 and s["activity_accuracy"][0]["accuracy_pct"] == 60.0
    _session(client, child, "2026-10-09", "10:00", "10:40")
    _session(client, child, "2026-10-16", "10:00", "10:40", status="cancelled")
    q = f"/billing/summary?month=2026-10&child_id={child['id']}"
    r = client.get(q + "&voucher_minutes=60&unit_price=40000", headers=H()).json()
    assert (r["session_count"], r["total_minutes"], r["voucher_minutes"], r["additional_minutes"], r["total_amount"]) == (2, 80, 60, 20, 80000)
    assert client.get(q, headers=H()).json()["total_amount"] is None  # price unset -> not guessed
    assert client.post(f"/children/{child['id']}/sessions", headers=H(), json={
        "date": "2026-10-02", "start": "11:00", "end": "10:00", "therapist": "김"}).status_code == 422


def test_plan_versioning_and_approval(client, child):
    g = {"kind": "short", "text": "2음절 /ㅈ/ 모방", "measure": "정반응률", "criterion": "3회기 연속 80%"}
    p1 = client.post(f"/children/{child['id']}/plans", headers=H(), json={"goals": [g]}).json()
    assert p1["status"] == "draft" and p1["goals"][0]["status"] == "draft"
    assert client.post(f"/plans/{p1['id']}/approve", headers=H(role="assistant")).status_code == 403
    assert client.post(f"/plans/{p1['id']}/approve", headers=H()).json()["goals"][0]["status"] == "active"
    p2 = client.post(f"/children/{child['id']}/plans", headers=H(), json={"goals": [g]}).json()
    client.post(f"/plans/{p2['id']}/approve", headers=H())
    plans = client.get(f"/children/{child['id']}/plans", headers=H()).json()
    assert [(x["version"], x["status"]) for x in plans] == [(1, "superseded"), (2, "active")]


def test_children_list_includes_current_age_months(client, child):
    from app.routers.children import age_months
    row = client.get("/children", headers=H()).json()[0]
    assert row["age_months"] == age_months("2022-03-15") and row["age_months"] > 0


def test_child_trash_restore_and_admin_purge(client, child):
    cid = child["id"]
    future = client.post("/schedules", headers=H(), json={"child_id": cid, "date": "2099-01-05", "start": "10:00", "end": "10:40", "therapist": "김"}).json()
    client.put("/timetable/config", headers=H(role="admin"), json={"teachers": [{"id": "t", "name": "김", "short": "김", "color": "#2563eb"}]})
    client.post("/timetable/entries", headers=H(), json={"day": 1, "slot": "09:00", "teacher_id": "t", "child_id": cid})
    assert client.post(f"/children/{cid}/archive", headers=H(role="assistant")).status_code == 403
    assert client.post(f"/children/{cid}/purge", headers=H(role="admin"), json={"confirm_name": "테스트아동"}).status_code == 409  # trash first
    assert client.post(f"/children/{cid}/archive", headers=H()).status_code == 200
    assert all(c["id"] != cid for c in client.get("/children", headers=H()).json())
    assert [c["id"] for c in client.get("/children/archived", headers=H()).json()] == [cid]
    assert client.get("/children/archived", headers=H("orgB")).json() == []
    assert client.get("/timetable", headers=H()).json()["entries"] == []  # hidden from the grid
    assert next(s for s in client.get("/schedules", headers=H()).json() if s["id"] == future["id"])["status"] == "cancelled"
    assert client.post(f"/children/{cid}/restore", headers=H()).json()["archived"] is False
    assert len(client.get("/timetable", headers=H()).json()["entries"]) == 1
    client.post(f"/children/{cid}/archive", headers=H())
    assert client.post(f"/children/{cid}/purge", headers=H(), json={"confirm_name": "테스트아동"}).status_code == 403  # admin only
    assert client.post(f"/children/{cid}/purge", headers=H(role="admin"), json={"confirm_name": "다른이름"}).status_code == 422
    assert client.post(f"/children/{cid}/purge", headers=H("orgB", "admin"), json={"confirm_name": "테스트아동"}).status_code == 404
    assert client.post(f"/children/{cid}/purge", headers=H(role="admin"), json={"confirm_name": "테스트아동"}).status_code == 200
    assert client.get(f"/children/{cid}", headers=H()).status_code == 404
    assert client.get("/children/archived", headers=H()).json() == []
    assert all(s["child_id"] != cid for s in client.get("/schedules", headers=H()).json())
