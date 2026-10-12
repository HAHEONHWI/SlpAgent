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
