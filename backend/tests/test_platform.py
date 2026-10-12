from app.main import app
from app.services.accounts import get_claims_setter
from tests.conftest import H

SITE = H("-", "site_admin", "root")
NEW = H("-", "none", "newbie")


class Recorder:
    def __init__(self):
        self.applied = []

    def __call__(self, uid, claims):
        self.applied.append((uid, claims))


def _with_claims(rec):
    app.dependency_overrides[get_claims_setter] = lambda: rec


def test_signup_waits_for_site_admin_approval(client, repo):
    me = client.get("/me", headers=NEW).json()
    assert me["status"] == "none" and me["org_id"] is None
    # pending account cannot touch clinical data
    assert client.get("/children", headers=NEW).status_code == 403
    r = client.post("/signup", headers=NEW, json={"org_name": "히즈언어치료", "therapist_name": "김재활"})
    assert r.status_code == 201
    assert client.post("/signup", headers=NEW, json={"org_name": "x", "therapist_name": "y"}).status_code == 409
    assert client.get("/me", headers=NEW).json()["status"] == "pending"

    # only site admins can see or decide signups
    assert client.get("/platform/signups", headers=H(role="admin")).status_code == 403
    assert client.post("/platform/signups/newbie/approve", headers=NEW).status_code == 403
    pending = client.get("/platform/signups?status=pending", headers=SITE).json()
    assert [p["uid"] for p in pending] == ["newbie"]

    rec = Recorder(); _with_claims(rec)
    approved = client.post("/platform/signups/newbie/approve", headers=SITE).json()
    org = approved["org_id"]
    assert rec.applied == [("newbie", {"org_id": org, "role": "admin"})]
    assert repo.get("organizations", org, org)["name"] == "히즈언어치료"
    assert repo.get("users", org, "newbie")["name"] == "김재활"
    assert client.post("/platform/signups/newbie/approve", headers=SITE).status_code == 409

    # after the token refreshes with claims, the user works inside the new org only
    member = H(org, "admin", "newbie")
    assert client.get("/me", headers=member).json()["status"] == "active"
    assert client.get("/children", headers=member).status_code == 200


def test_reject_then_reapply(client):
    client.post("/signup", headers=NEW, json={"org_name": "A", "therapist_name": "B"})
    assert client.post("/platform/signups/newbie/reject", headers=SITE, json={"reason": "기관 확인 불가"}).status_code == 200
    me = client.get("/me", headers=NEW).json()
    assert me["status"] == "rejected" and me["signup"]["reason"] == "기관 확인 불가"
    assert client.post("/signup", headers=NEW, json={"org_name": "A2", "therapist_name": "B"}).status_code == 201
    assert client.get("/me", headers=NEW).json()["status"] == "pending"


def test_site_admin_sees_counts_not_clinical_records(client, child):
    rec = Recorder(); _with_claims(rec)
    client.post("/signup", headers=NEW, json={"org_name": "A", "therapist_name": "B"})
    org = client.post("/platform/signups/newbie/approve", headers=SITE).json()["org_id"]
    client.post("/children", headers=H(org, "admin", "newbie"), json={"alias": "C-1", "display_name": "실명아동", "birth_date": "2022-01-01"})
    orgs = client.get("/platform/organizations", headers=SITE).json()
    row = next(o for o in orgs if o["org_id"] == org)
    assert row["children"] == 1 and row["users"] == 1
    assert "실명아동" not in str(orgs)
    summary = client.get("/platform/summary", headers=SITE).json()
    assert summary["organizations"] == 1 and summary["pending_signups"] == 0
    # a site admin is not an org member and cannot read clinical routes
    assert client.get("/children", headers=SITE).status_code == 403
    assert client.get(f"/children/{child['id']}", headers=SITE).status_code == 403


def test_reserved_platform_namespace_is_not_an_org(client):
    assert client.get("/children", headers=H("_platform", "admin", "x")).status_code == 403
