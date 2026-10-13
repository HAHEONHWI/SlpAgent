"""Site-admin account and organization management: join-existing approval, immediate role changes,
suspension, and organization merge."""
from app.main import app
from app.services.accounts import get_claims_setter
from tests.conftest import H

SITE = H("-", "site_admin", "root")


class Recorder:
    def __init__(self):
        self.applied = []

    def __call__(self, uid, claims):
        self.applied.append((uid, claims))


def _signup(client, uid, org_name, name="치료사"):
    assert client.post("/signup", headers=H("-", "none", uid), json={"org_name": org_name, "therapist_name": name, "privacy_policy_version": "2026-10-13"}).status_code == 201


def _new_org(client, uid, org_name):
    _signup(client, uid, org_name)
    return client.post(f"/platform/signups/{uid}/approve", headers=SITE).json()["org_id"]


def test_same_name_signup_is_suggested_and_can_join_existing_org(client, repo):
    app.dependency_overrides[get_claims_setter] = lambda: Recorder()
    org = _new_org(client, "owner", "히즈언어치료")
    _signup(client, "second", "히즈 언어치료")  # spacing differs
    row = next(r for r in client.get("/platform/signups?status=pending", headers=SITE).json() if r["uid"] == "second")
    assert row["suggested_org_id"] == org
    r = client.post("/platform/signups/second/approve", headers=SITE, json={"org_id": org, "role": "therapist"}).json()
    assert r["org_id"] == org and r["role"] == "therapist" and r["joined_existing"]
    assert len(client.get("/platform/organizations", headers=SITE).json()) == 1  # no duplicate org
    # the server-side access record applies even before the user's token is refreshed
    stale = H("-", "none", "second")
    me = client.get("/me", headers=stale).json()
    assert me["status"] == "active" and me["org_id"] == org and me["role"] == "therapist"
    assert client.get("/children", headers=stale).status_code == 200


def test_role_change_and_suspension_apply_on_next_request(client, repo):
    app.dependency_overrides[get_claims_setter] = lambda: Recorder()
    org = _new_org(client, "owner", "A기관")
    _signup(client, "t1", "A기관")
    client.post("/platform/signups/t1/approve", headers=SITE, json={"org_id": org, "role": "therapist"})
    t1 = H("-", "none", "t1")
    body = {"alias": "C-1", "display_name": "x", "birth_date": "2022-01-01"}
    assert client.post("/children", headers=t1, json=body).status_code == 201
    assert client.put("/platform/accounts/t1/access", headers=SITE, json={"org_id": org, "role": "assistant"}).status_code == 200
    assert client.post("/children", headers=t1, json=body).status_code == 403  # now read-only
    assert client.put("/platform/accounts/t1/status", headers=SITE, json={"disabled": True}).status_code == 200
    assert client.get("/children", headers=t1).status_code == 403
    assert client.get("/me", headers=t1).json()["status"] == "suspended"
    assert next(a for a in client.get("/platform/accounts", headers=SITE).json() if a["uid"] == "t1")["disabled"]
    assert client.put("/platform/accounts/t1/status", headers=SITE, json={"disabled": False}).status_code == 200
    assert client.get("/children", headers=t1).status_code == 200
    assert client.put("/platform/accounts/root/status", headers=SITE, json={"disabled": True}).status_code == 409
    # the last admin of an organization cannot be demoted
    assert client.put("/platform/accounts/owner/access", headers=SITE, json={"org_id": org, "role": "therapist"}).status_code == 409
    # only site admins manage accounts
    assert client.put("/platform/accounts/t1/status", headers=H(org, "admin", "owner"), json={"disabled": True}).status_code == 403


def test_merge_moves_members_and_records_into_target(client, repo):
    app.dependency_overrides[get_claims_setter] = lambda: Recorder()
    keep = _new_org(client, "a", "히즈언어치료")
    dup = _new_org(client, "b", "히즈언어치료")
    child = client.post("/children", headers=H("-", "none", "b"), json={"alias": "D-1", "display_name": "x", "birth_date": "2022-01-01"}).json()
    preview = client.post(f"/platform/organizations/{dup}/merge-preview", headers=SITE, json={"target_org_id": keep}).json()
    assert preview["counts"]["children"] == 1
    bad = client.post(f"/platform/organizations/{dup}/merge", headers=SITE,
                      json={"target_org_id": keep, "preview_token": preview["preview_token"], "confirmation": "wrong"})
    assert bad.status_code == 422
    done = client.post(f"/platform/organizations/{dup}/merge", headers=SITE,
                       json={"target_org_id": keep, "preview_token": preview["preview_token"], "confirmation": dup})
    assert done.status_code == 200
    b = H("-", "none", "b")  # b's old token still says nothing; the access record now points at the target
    assert client.get("/me", headers=b).json()["org_id"] == keep
    assert [c["id"] for c in client.get("/children", headers=b).json()] == [child["id"]]
    assert [o["org_id"] for o in client.get("/platform/organizations", headers=SITE).json()] == [keep]
    assert client.get("/children", headers=H(dup, "admin", "b-old-token")).status_code == 403  # merged org is closed


def test_account_deletion_by_site_admin_and_self(client, repo):
    app.dependency_overrides[get_claims_setter] = lambda: Recorder()
    org = _new_org(client, "boss", "삭제기관")
    _signup(client, "member", "삭제기관")
    client.post("/platform/signups/member/approve", headers=SITE, json={"org_id": org, "role": "therapist"})
    member = H(org, "therapist", "member")
    assert client.get("/children", headers=member).status_code == 200
    assert client.delete("/platform/accounts/member", headers=H(org, "admin", "boss")).status_code == 403
    assert client.delete("/platform/accounts/root", headers=SITE).status_code == 409  # not yourself
    assert client.delete("/platform/accounts/boss", headers=SITE).status_code == 409  # last org admin
    assert client.delete("/platform/accounts/member", headers=SITE).status_code == 200
    assert client.get("/children", headers=member).status_code == 403  # old token is dead
    assert all(a["uid"] != "member" for a in client.get("/platform/accounts", headers=SITE).json())
    assert client.delete("/platform/accounts/member", headers=SITE).status_code == 404

    _signup(client, "applicant", "새기관")
    assert client.delete("/me", headers=H("-", "none", "applicant")).status_code == 200
    assert all(r["uid"] != "applicant" for r in client.get("/platform/signups", headers=SITE).json())
    assert client.delete("/me", headers=H(org, "admin", "boss")).status_code == 409  # last admin must hand over
    assert client.delete("/me", headers=SITE).status_code == 409


def test_account_list_and_me_show_the_person_name(client, repo):
    app.dependency_overrides[get_claims_setter] = lambda: Recorder()
    org = _new_org(client, "named", "이름기관")
    _signup(client, "waiting", "다른기관", name="김대기")
    rows = {a["uid"]: a for a in client.get("/platform/accounts", headers=SITE).json()}
    assert rows["named"]["name"] == "치료사" and rows["waiting"]["name"] == "김대기"
    assert client.get("/me", headers=H(org, "admin", "named")).json()["name"] == "치료사"
    assert client.get("/me", headers=H("-", "none", "waiting")).json()["name"] == "김대기"
