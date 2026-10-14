"""공지사항: organization notices for members, site notices for everyone."""
from tests.conftest import H

SITE = H("-", "site_admin", "root")
ADMIN = H(role="admin")
N = {"title": "휴무 안내", "body": "10월 9일 한글날 휴무입니다.\n보강은 따로 안내합니다.", "pinned": False}


def test_org_and_site_notices(client):
    assert client.post("/notices", headers=H(), json=N).status_code == 403  # therapists read only
    a = client.post("/notices", headers=ADMIN, json=N).json()
    b = client.post("/notices", headers=ADMIN, json={**N, "title": "고정 공지", "pinned": True}).json()
    s = client.post("/platform/notices", headers=SITE, json={**N, "title": "점검 안내"}).json()
    assert client.post("/platform/notices", headers=ADMIN, json=N).status_code == 403
    seen = client.get("/notices", headers=H()).json()
    assert [n["title"] for n in seen][0] == "고정 공지" and {n["scope"] for n in seen} == {"org", "site"}
    assert {n["title"] for n in client.get("/notices", headers=H("orgB")).json()} == {"점검 안내"}  # other org: site only
    assert client.put(f"/notices/{a['id']}", headers=H("orgB", "admin"), json=N).status_code == 404
    assert client.put(f"/notices/{a['id']}", headers=ADMIN, json={**N, "title": "수정됨"}).json()["title"] == "수정됨"
    assert client.delete(f"/notices/{s['id']}", headers=ADMIN).status_code == 404  # org admin cannot touch site notices
    assert client.delete(f"/platform/notices/{s['id']}", headers=SITE).status_code == 204
    assert client.delete(f"/notices/{b['id']}", headers=ADMIN).status_code == 204
    assert [n["title"] for n in client.get("/notices", headers=H()).json()] == ["수정됨"]
    assert client.post("/notices", headers=ADMIN, json={**N, "title": "  "}).status_code == 422
