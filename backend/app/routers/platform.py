"""Self-service signup that needs site-admin approval, and the site-admin dashboard.

Site admins see organizations and aggregate counts only, never children's clinical records."""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from ..auth import Identity, current_identity, require_site_admin
from ..deps import get_repo
from ..repo.base import NotFound
from ..services.accounts import PLATFORM, get_claims_setter
from ..services.assessment_defs import DEFS, licensed_codes

router = APIRouter(tags=["platform"])


class SignupIn(BaseModel):
    org_name: str = Field(min_length=1, max_length=80)
    therapist_name: str = Field(min_length=1, max_length=40)


class LicensesIn(BaseModel):
    codes: list[str] = Field(default_factory=list, max_length=50)


class RejectIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


def _platform_audit(repo, actor: Identity, action: str, target: str):
    repo.create("audit_logs", PLATFORM, {"actor": actor.uid, "role": "site_admin" if actor.site_admin else None,
                                         "action": action, "collection": "signup_requests", "doc_id": target,
                                         "child_id": None, "via_ai": False})


def _request(repo, uid: str) -> dict | None:
    try:
        return repo.get("signup_requests", PLATFORM, uid)
    except NotFound:
        return None


@router.get("/me")
def me(identity: Identity = Depends(current_identity), repo=Depends(get_repo)):
    """Lets the client route a signed-in account: site admin, approved member, pending, or rejected."""
    out = identity.model_dump()
    if identity.org_id:
        try:
            out["org_name"] = repo.get("organizations", identity.org_id, identity.org_id).get("name")
        except NotFound:
            out["org_name"] = None
    req = _request(repo, identity.uid)
    out["signup"] = {k: req.get(k) for k in ("status", "org_name", "therapist_name", "reason", "created_at", "org_id")} if req else None
    out["status"] = ("site_admin" if identity.site_admin else "active" if identity.org_id and identity.role
                     else (req or {}).get("status", "none"))
    return out


@router.post("/signup", status_code=201)
def signup(body: SignupIn, identity: Identity = Depends(current_identity), repo=Depends(get_repo)):
    if identity.org_id or identity.site_admin:
        raise HTTPException(409, "account already belongs to an organization")
    data = {"uid": identity.uid, "email": identity.email, "org_name": body.org_name.strip(),
            "therapist_name": body.therapist_name.strip(), "status": "pending", "reason": None}
    existing = _request(repo, identity.uid)
    if existing and existing["status"] == "pending":
        raise HTTPException(409, "signup already pending approval")
    if existing and existing["status"] == "approved":
        raise HTTPException(409, "signup already approved; sign in again")
    if existing:  # previously rejected: allow a corrected re-application
        return repo.update("signup_requests", PLATFORM, identity.uid, data)
    return repo.create("signup_requests", PLATFORM, data, doc_id=identity.uid)


@router.get("/platform/signups")
def list_signups(status: Literal["pending", "approved", "rejected"] | None = None,
                 admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    rows = repo.list("signup_requests", PLATFORM, **({"status": status} if status else {}))
    return sorted(rows, key=lambda r: r.get("created_at", ""), reverse=True)


@router.post("/platform/signups/{uid}/approve")
def approve_signup(uid: str, admin: Identity = Depends(require_site_admin), repo=Depends(get_repo),
                   set_claims=Depends(get_claims_setter)):
    req = _request(repo, uid)
    if not req:
        raise HTTPException(404, "signup request not found")
    if req["status"] != "pending":
        raise HTTPException(409, f"signup is {req['status']}")
    org_id = uuid.uuid4().hex
    repo.create("organizations", org_id, {"name": req["org_name"], "status": "active", "behavior_scale": None,
                                          "unit_price": None, "voucher_minutes": None}, doc_id=org_id)
    repo.create("organization_registry", PLATFORM, {"org_id": org_id, "name": req["org_name"],
                                                    "owner_uid": uid, "status": "active"}, doc_id=org_id)
    repo.create("users", org_id, {"uid": uid, "email": req.get("email"), "name": req["therapist_name"],
                                  "role": "admin"}, doc_id=uid)
    # The applicant becomes the org's admin (admins can also write clinical records like therapists).
    set_claims(uid, {"org_id": org_id, "role": "admin"})
    repo.update("signup_requests", PLATFORM, uid, {"status": "approved", "org_id": org_id, "decided_by": admin.uid})
    _platform_audit(repo, admin, "approve", uid)
    return {"uid": uid, "org_id": org_id, "status": "approved"}


@router.post("/platform/signups/{uid}/reject")
def reject_signup(uid: str, body: RejectIn, admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    req = _request(repo, uid)
    if not req:
        raise HTTPException(404, "signup request not found")
    if req["status"] != "pending":
        raise HTTPException(409, f"signup is {req['status']}")
    repo.update("signup_requests", PLATFORM, uid, {"status": "rejected", "reason": body.reason, "decided_by": admin.uid})
    _platform_audit(repo, admin, "reject", uid)
    return {"uid": uid, "status": "rejected"}


def _org_stats(repo, org_id: str, since: str) -> dict:
    # Counts only: the platform view must not expose names or clinical content.
    children = [c for c in repo.list("children", org_id) if not c.get("archived")]
    sessions = [s for s in repo.list("therapy_sessions", org_id) if s.get("date", "") >= since[:10]]
    activity = max((a.get("created_at", "") for a in repo.list("audit_logs", org_id)), default=None)
    return {"users": len(repo.list("users", org_id)), "children": len(children),
            "sessions_30d": len(sessions), "last_activity": activity}


@router.get("/platform/organizations")
def organizations(admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    rows = repo.list("organization_registry", PLATFORM)
    return sorted(({"org_id": r["org_id"], "name": r["name"], "status": r.get("status"), "created_at": r.get("created_at"),
                    "licensed_assessments": sorted(licensed_codes(repo, r["org_id"])),
                    **_org_stats(repo, r["org_id"], since)} for r in rows), key=lambda r: r["created_at"] or "", reverse=True)


@router.put("/platform/organizations/{org_id}/licenses")
def set_licenses(org_id: str, body: LicensesIn, admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    """Record which tests an organization holds a license for. Only site admins can change this."""
    unknown = [c for c in body.codes if c not in DEFS]
    if unknown:
        raise HTTPException(422, f"unknown test codes: {unknown}")
    try:
        repo.get("organizations", org_id, org_id)
    except NotFound:
        raise HTTPException(404, "organization not found")
    codes = sorted(set(body.codes))
    repo.update("organizations", org_id, org_id, {"licensed_assessments": codes})
    repo.create("audit_logs", PLATFORM, {"actor": admin.uid, "role": "site_admin", "action": "set_licenses",
                                         "collection": "organizations", "doc_id": org_id, "child_id": None,
                                         "via_ai": False, "detail": codes})
    return {"org_id": org_id, "licensed_assessments": codes}


@router.get("/platform/summary")
def summary(admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    orgs = repo.list("organization_registry", PLATFORM)
    signups = repo.list("signup_requests", PLATFORM)
    stats = [_org_stats(repo, o["org_id"], since) for o in orgs]
    return {"organizations": len(orgs), "users": sum(s["users"] for s in stats), "children": sum(s["children"] for s in stats),
            "sessions_30d": sum(s["sessions_30d"] for s in stats),
            "pending_signups": sum(1 for s in signups if s["status"] == "pending"),
            "signups_30d": sum(1 for s in signups if s.get("created_at", "") >= since)}
