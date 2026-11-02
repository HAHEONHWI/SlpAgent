from tests.conftest import H


def test_org_settings_admin_only_and_feed_behavior_scale(client, child):
    body = {"name": "히즈", "behavior_scale": {"min": 1, "max": 4}, "unit_price": 40000}
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


def test_therapist_roster_links_accounts_and_renames_follow(client, repo, child):
    from tests.conftest import H
    admin = H(role="admin", uid="boss")
    repo.create("users", "orgA", {"uid": "t1", "email": "t1@example.com", "name": "김치료", "role": "therapist"}, doc_id="t1")
    client.put(f"/children/{child['id']}/therapist", headers=admin, json={"therapist": "김치료"})
    auto = client.get("/org/roster", headers=admin).json()["therapists"]
    assert [(t["name"], t["uid"]) for t in auto] == [("테스트치료사", "u1"), ("김치료", "t1")]  # assigned -> listed, same-name account linked
    assert client.put("/org/roster", headers=H(), json={"therapists": []}).status_code == 403
    assert client.put("/org/roster", headers=admin, json={"therapists": [{"name": "A"}, {"name": "A"}]}).status_code == 422
    assert client.put("/org/roster", headers=admin, json={"therapists": [{"name": "A", "uid": "nobody"}]}).status_code == 422
    r = client.put("/org/roster", headers=admin, json={"therapists": [{"name": "김치료", "uid": "t1"}, {"name": "박선생"}]}).json()
    assert [(t["name"], t["email"]) for t in r["therapists"]] == [("김치료", "t1@example.com"), ("박선생", None)]
    assert client.get("/org/therapists", headers=H()).json() == ["김치료", "박선생"]
    assert client.get("/me", headers=H(uid="t1")).json()["therapist_name"] == "김치료"
    rid = r["therapists"][0]["id"]
    client.put("/org/roster", headers=admin, json={"therapists": [{"id": rid, "name": "김재활", "uid": "t1"}, {"name": "박선생"}]})
    assert client.get(f"/children/{child['id']}", headers=H(uid="t1")).json()["therapist"] == "김재활"  # rename followed, still t1's child
    assert client.get("/me", headers=H(uid="t1")).json()["therapist_name"] == "김재활"
    assert "members" not in client.get("/org/roster", headers=H()).json()


def test_assigned_therapists_join_the_roster_automatically(client, repo, child):
    from tests.conftest import H
    admin = H(role="admin", uid="boss")
    repo.create("users", "orgA", {"uid": "t9", "email": "t9@example.com", "name": "최치료", "role": "therapist"}, doc_id="t9")
    client.put(f"/children/{child['id']}/therapist", headers=admin, json={"therapist": "최치료"})
    client.post("/children", headers=H(), json={"alias": "N-1", "display_name": "새아동", "birth_date": "2021-01-01", "therapist": "정선생"})
    client.post("/children/import", headers=H(), json={"rows": [{"alias": "N-2", "display_name": "둘째", "birth_date": "2021-02-02", "therapist": "한선생"}]})
    rows = client.get("/org/roster", headers=admin).json()["therapists"]
    assert [(t["name"], t["uid"]) for t in rows] == [("테스트치료사", "u1"), ("최치료", "t9"), ("정선생", None), ("한선생", None)]  # same-name account linked
    assert client.get("/org/therapists", headers=H()).json() == ["테스트치료사", "최치료", "정선생", "한선생"]
    # names assigned before the roster existed show up when the roster is opened
    repo.update("children", "orgA", child["id"], {"therapist": "옛선생"})
    assert "옛선생" in [t["name"] for t in client.get("/org/roster", headers=admin).json()["therapists"]]
