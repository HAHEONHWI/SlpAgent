from tests.conftest import H
from app.services.child_codes import counter_id


def test_admin_prefix_generates_sequential_child_codes(client, repo):
    admin = H("orgB", "admin", "boss")
    saved = client.put("/org/roster", headers=admin, json={"therapists": [{"name": "홍길동", "code_prefix": "A"}]})
    assert saved.status_code == 200
    teacher = saved.json()["therapists"][0]
    assert teacher["code_prefix"] == "A"
    assert client.put("/org/roster", headers=admin, json={"therapists": [
        {"id": teacher["id"], "name": "홍길동", "code_prefix": "A"}, {"name": "김길동", "code_prefix": "A"}
    ]}).status_code == 422
    assert client.put("/org/roster", headers=H("orgB", "therapist", "therapist"),
                      json={"therapists": []}).status_code == 403

    preview = client.get("/children/next-code", params={"therapist": "홍길동"}, headers=admin)
    assert preview.json() == {"code_prefix": "A", "alias": "A-01"}
    first = client.post("/children", headers=admin, json={"display_name": "첫째", "birth_date": "2021-01-01",
                                                          "therapist": "홍길동"})
    second = client.post("/children", headers=admin, json={"alias": "잘못 입력한 값", "display_name": "둘째",
                                                           "birth_date": "2021-02-01", "therapist": "홍길동"})
    assert (first.status_code, first.json()["alias"]) == (201, "A-01")
    assert (second.status_code, second.json()["alias"]) == (201, "A-02")
    imported = client.post("/children/import", headers=admin, json={"rows": [{"alias": "A-07", "display_name": "가져온 아동",
                                                                                "birth_date": "2021-03-01", "therapist": "홍길동"}]})
    assert imported.json()["created"] == 1
    imported_child = next(c for c in repo.list("children", "orgB") if c["display_name"] == "가져온 아동")
    client.post(f"/children/{imported_child['id']}/archive", headers=admin)
    client.post(f"/children/{imported_child['id']}/purge", headers=admin, json={"confirm_name": "가져온 아동"})
    reused = client.post("/children", headers=admin, json={"alias": "A-07", "display_name": "다른 아동",
                                                           "birth_date": "2021-04-01"})
    assert reused.status_code == 409
    assert client.get("/children/next-code", params={"therapist": "홍길동"}, headers=admin).json()["alias"] == "A-08"


def test_old_roster_update_preserves_prefix_and_manual_code_still_works(client):
    admin = H("orgB", "admin", "boss")
    teacher = client.put("/org/roster", headers=admin,
                         json={"therapists": [{"name": "홍길동", "code_prefix": "B"}]}).json()["therapists"][0]
    updated = client.put("/org/roster", headers=admin,
                         json={"therapists": [{"id": teacher["id"], "name": "홍길동"}]})
    assert updated.json()["therapists"][0]["code_prefix"] == "B"
    manual = client.post("/children", headers=admin,
                         json={"alias": "LOCAL-01", "display_name": "수동 코드", "birth_date": "2021-01-01"})
    assert manual.status_code == 201 and manual.json()["alias"] == "LOCAL-01"
    invalid = client.post("/children", headers=admin,
                          json={"alias": "B-00", "display_name": "잘못된 번호", "birth_date": "2021-01-02"})
    assert invalid.status_code == 422
    missing_import_code = client.post("/children/import", headers=admin,
                                      json={"rows": [{"display_name": "코드 없는 가져오기", "birth_date": "2021-02-02"}]})
    assert missing_import_code.status_code == 422


def test_auto_code_skips_existing_archived_codes(client, repo):
    admin = H("orgB", "admin", "boss")
    repo.create("children", "orgB", {"alias": "A-07", "display_name": "삭제된 아동", "birth_date": "2021-01-01", "archived": True})
    client.put("/org/roster", headers=admin, json={"therapists": [{"name": "홍길동", "code_prefix": "A"}]})
    preview = client.get("/children/next-code", params={"therapist": "홍길동"}, headers=admin)
    assert preview.json()["alias"] == "A-08"


def test_same_prefix_can_be_used_in_separate_organizations(client):
    for org in ("orgA", "orgB"):
        admin = H(org, "admin", f"{org}-boss")
        client.put("/org/roster", headers=admin, json={"therapists": [{"name": "홍길동", "code_prefix": "A"}]})
        child = client.post("/children", headers=admin,
                            json={"display_name": f"{org} 아동", "birth_date": "2021-01-01", "therapist": "홍길동"})
        assert child.status_code == 201 and child.json()["alias"] == "A-01"


def test_child_code_limit_returns_conflict(client, repo):
    admin = H("orgB", "admin", "boss")
    client.put("/org/roster", headers=admin, json={"therapists": [{"name": "홍길동", "code_prefix": "C"}]})
    repo.create("child_code_counters", "orgB", {"prefix": "C", "next_number": 100, "used_numbers": list(range(1, 100))},
                doc_id=counter_id("orgB", "C"))
    response = client.get("/children/next-code", params={"therapist": "홍길동"}, headers=admin)
    assert response.status_code == 409


def test_auto_code_is_not_reused_after_child_purge(client):
    admin = H("orgB", "admin", "boss")
    teacher = client.put("/org/roster", headers=admin,
                         json={"therapists": [{"name": "홍길동", "code_prefix": "D"}]}).json()["therapists"][0]
    child = client.post("/children", headers=admin,
                        json={"display_name": "삭제 대상", "birth_date": "2021-01-01", "therapist": "홍길동"}).json()
    assert child["alias"] == "D-01"
    assert client.post(f"/children/{child['id']}/archive", headers=admin).status_code == 200
    assert client.post(f"/children/{child['id']}/purge", headers=admin, json={"confirm_name": "삭제 대상"}).status_code == 200
    client.put("/org/roster", headers=admin,
               json={"therapists": [{"id": teacher["id"], "name": "홍길동", "code_prefix": None}]})
    reused = client.post("/children", headers=admin,
                         json={"alias": "D-01", "display_name": "다른 아동", "birth_date": "2021-02-01"})
    assert reused.status_code == 409
