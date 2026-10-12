from tests.conftest import H


def test_org_settings_admin_only_and_feed_behavior_scale(client, child):
    body = {"name": "히즈", "behavior_scale": {"min": 1, "max": 4}, "unit_price": 40000, "voucher_minutes": 240}
    assert client.put("/org", json=body, headers=H(role="therapist")).status_code == 403
    assert client.put("/org", json={**body, "behavior_scale": {"min": 3, "max": 3}}, headers=H(role="admin")).status_code == 422
    assert client.put("/org", json=body, headers=H(role="admin")).status_code == 200
    assert client.get("/org", headers=H("orgB")).json()["name"] == ""  # other org sees nothing
    obs = {"observed_at": "2026-10-01T10:00:00", "antecedent": "a", "behavior": "b", "consequence": "c", "observer": "김", "intensity": 4}
    assert client.post(f"/children/{child['id']}/behavior", json=obs, headers=H()).status_code == 201


def test_schedule_conflicts_and_isolation(client, child):
    s = {"child_id": child["id"], "date": "2026-10-20", "start": "10:00", "end": "10:40", "therapist": "김"}
    assert client.post("/schedules", json=s, headers=H()).status_code == 201
    assert client.post("/schedules", json={**s, "start": "10:30", "end": "11:10"}, headers=H()).status_code == 409
    assert client.post("/schedules", json={**s, "start": "10:40", "end": "11:20"}, headers=H()).status_code == 201  # back-to-back ok
    sid = client.get("/schedules?month=2026-10", headers=H()).json()[0]["id"]
    assert client.post(f"/schedules/{sid}/cancel", headers=H("orgB")).status_code == 404
    client.post(f"/schedules/{sid}/cancel", headers=H())
    assert client.post("/schedules", json=s, headers=H()).status_code == 201  # slot freed
    assert client.get("/schedules", headers=H("orgB")).json() == []


def test_knowledge_documents_status(client, repo):
    for pg, ocr in [(1, False), (2, True)]:
        repo.create("knowledge_documents", "orgA", {"source": "A.pdf", "page": pg, "test_code": "PRES", "text": "x", "needs_ocr": ocr})
    repo.create("knowledge_documents", "orgA", {"source": "B.pdf", "page": 1, "test_code": None, "text": "", "needs_ocr": True})
    d = {x["source"]: x["status"] for x in client.get("/knowledge/documents", headers=H()).json()}
    assert d == {"A.pdf": "partial", "B.pdf": "ocr_required"}
    assert client.get("/knowledge/documents", headers=H("orgB")).json() == []
