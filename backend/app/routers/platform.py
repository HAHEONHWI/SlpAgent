"""Self-service signup that needs site-admin approval, and the site-admin dashboard.

Site admins see organizations and aggregate counts only, never children's clinical records."""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict, model_validator
from ..auth import Identity, Role, current_identity, effective_identity, require_site_admin
from ..deps import get_repo
from ..repo.base import NotFound, now_iso
from ..services.accounts import PLATFORM, get_claims_setter, get_account_directory
from ..services.assessment_defs import DEFS, licensed_codes
from ..services.organization_merge import MergeIn, build_merge, merge_organizations

router = APIRouter(tags=["platform"])


class SignupIn(BaseModel):
    org_name: str = Field(min_length=1, max_length=80)
    therapist_name: str = Field(min_length=1, max_length=40)
    privacy_policy_version: str = Field(min_length=1, max_length=20, description="version of the privacy policy the applicant agreed to")


class LicensesIn(BaseModel):
    codes: list[str] = Field(default_factory=list, max_length=50)


class RejectIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class AccountAccessIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    org_id: str | None
    role: Role | None

    @model_validator(mode="after")
    def paired(self):
        if (self.org_id is None) != (self.role is None):
            raise ValueError("organization and role must both be set or both be null")
        return self


class OrgNameIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    name: str = Field(min_length=1, max_length=80, pattern=r"\S")


def _norm(name: str) -> str:
    return "".join((name or "").split()).lower()


def _active_registry(repo) -> list[dict]:
    return [r for r in repo.list("organization_registry", PLATFORM) if r.get("status", "active") == "active"]


def _active_org(repo, org_id: str):
    try:
        org = repo.get("organizations", org_id, org_id)
        repo.get("organization_registry", PLATFORM, org_id)
    except NotFound:
        raise HTTPException(404, "organization not found")
    if org.get("status", "active") != "active":
        raise HTTPException(409, "organization is not active")
    return org


@router.get("/platform/accounts")
def accounts(admin: Identity = Depends(require_site_admin), repo=Depends(get_repo),
             directory=Depends(get_account_directory)):
    names = {r["org_id"]: r["name"] for r in repo.list("organization_registry", PLATFORM)}
    rows = []
    for account in directory.list():
        row = account.model_dump()
        try:
            access = repo.get("account_access", PLATFORM, account.uid)
            if "org_id" in access:
                row.update(org_id=access.get("org_id"), role=access.get("role"))
            row["disabled"] = bool(access.get("disabled")) or row["disabled"]
        except NotFound:
            access = None
        row["org_name"] = names.get(row["org_id"])
        rows.append(row)
    return sorted(rows, key=lambda r: (r["org_name"] or "", r["email"] or r["uid"]))


@router.put("/platform/accounts/{uid}/access")
def account_access(uid: str, body: AccountAccessIn, admin: Identity = Depends(require_site_admin),
                   repo=Depends(get_repo), directory=Depends(get_account_directory),
                   set_claims=Depends(get_claims_setter)):
    account = next((a for a in accounts(admin, repo, directory) if a["uid"] == uid), None)
    if account is None:
        raise HTTPException(404, "account not found")
    if body.org_id:
        _active_org(repo, body.org_id)
    old_org = account["org_id"]
    if old_org and account["role"] == "admin" and (body.org_id != old_org or body.role != "admin"):
        admins = repo.list("users", old_org, role="admin")
        if not any(u["uid"] != uid for u in admins):
            raise HTTPException(409, "cannot remove the last organization admin")
    patch = body.model_dump()
    try:
        repo.update("account_access", PLATFORM, uid, patch)
    except NotFound:
        repo.create("account_access", PLATFORM, patch, doc_id=uid)
    if old_org and old_org != body.org_id:
        try:
            repo.delete("users", old_org, uid)
        except NotFound:
            old_org = None
    if body.org_id:
        data = {"uid": uid, "email": account["email"], "name": account["name"], "role": body.role}
        try:
            repo.update("users", body.org_id, uid, data)
        except NotFound:
            repo.create("users", body.org_id, data, doc_id=uid)
    repo.create("audit_logs", PLATFORM, {"actor": admin.uid, "role": "site_admin", "action": "set_account_access",
                                         "collection": "account_access", "doc_id": uid, "detail": patch})
    set_claims(uid, patch)
    return {"uid": uid, **patch, "reauthentication_required": True}


class AccountStatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    disabled: bool


@router.put("/platform/accounts/{uid}/status")
def account_status(uid: str, body: AccountStatusIn, admin: Identity = Depends(require_site_admin),
                   repo=Depends(get_repo), directory=Depends(get_account_directory)):
    if uid == admin.uid:
        raise HTTPException(409, "you cannot suspend your own account")
    if not any(a.uid == uid for a in directory.list()):
        raise HTTPException(404, "account not found")
    try:
        repo.update("account_access", PLATFORM, uid, {"disabled": body.disabled})
    except NotFound:
        repo.create("account_access", PLATFORM, {"disabled": body.disabled}, doc_id=uid)
    directory.set_disabled(uid, body.disabled)  # also blocks sign-in and revokes sessions in Firebase
    repo.create("audit_logs", PLATFORM, {"actor": admin.uid, "role": "site_admin",
                                         "action": "suspend_account" if body.disabled else "reactivate_account",
                                         "collection": "account_access", "doc_id": uid})
    return {"uid": uid, "disabled": body.disabled}


@router.put("/platform/organizations/{org_id}")
def rename_org(org_id: str, body: OrgNameIn, admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    _active_org(repo, org_id)
    name = body.name.strip()
    repo.update("organizations", org_id, org_id, {"name": name})
    repo.update("organization_registry", PLATFORM, org_id, {"name": name})
    repo.create("audit_logs", PLATFORM, {"actor": admin.uid, "role": "site_admin", "action": "rename_organization",
                                         "collection": "organizations", "doc_id": org_id, "detail": name})
    return {"org_id": org_id, "name": name}


@router.post("/platform/organizations/{org_id}/merge-preview")
def preview_merge(org_id: str, body: MergeIn, admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    return build_merge(repo, org_id, body.target_org_id)[0]


@router.post("/platform/organizations/{org_id}/merge")
def apply_merge(org_id: str, body: MergeIn, admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    return merge_organizations(repo, org_id, body, admin.uid)


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
    """Lets the client route a signed-in account: site admin, approved member, pending, rejected, suspended."""
    try:
        identity = effective_identity(identity, repo)
    except HTTPException:
        return {**identity.model_dump(), "status": "suspended", "signup": None, "org_name": None}
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
            "therapist_name": body.therapist_name.strip(), "status": "pending", "reason": None,
            "privacy_consent": {"version": body.privacy_policy_version, "agreed_at": now_iso()}}
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
    by_name = {}
    for org in _active_registry(repo):
        by_name.setdefault(_norm(org["name"]), org["org_id"])
    for r in rows:  # same-name org already exists -> suggest joining it instead of creating a duplicate
        r["suggested_org_id"] = by_name.get(_norm(r.get("org_name", "")))
    return sorted(rows, key=lambda r: r.get("created_at", ""), reverse=True)


class ApproveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    org_id: str | None = None  # join this existing organization; omit to create a new one
    role: Role | None = None   # role when joining; a new organization's applicant is always its admin


@router.post("/platform/signups/{uid}/approve")
def approve_signup(uid: str, body: ApproveIn | None = None, admin: Identity = Depends(require_site_admin),
                   repo=Depends(get_repo), set_claims=Depends(get_claims_setter)):
    body = body or ApproveIn()
    req = _request(repo, uid)
    if not req:
        raise HTTPException(404, "signup request not found")
    if req["status"] != "pending":
        raise HTTPException(409, f"signup is {req['status']}")
    if body.org_id:
        org_id, role = body.org_id, body.role or "therapist"
        _active_org(repo, org_id)
    else:
        org_id, role = uuid.uuid4().hex, "admin"
        repo.create("organizations", org_id, {"name": req["org_name"], "status": "active", "behavior_scale": None,
                                              "unit_price": None, "voucher_minutes": None}, doc_id=org_id)
        repo.create("organization_registry", PLATFORM, {"org_id": org_id, "name": req["org_name"],
                                                        "owner_uid": uid, "status": "active"}, doc_id=org_id)
    repo.create("users", org_id, {"uid": uid, "email": req.get("email"), "name": req["therapist_name"],
                                  "role": role}, doc_id=uid)
    access = {"org_id": org_id, "role": role}
    try:
        repo.update("account_access", PLATFORM, uid, access)
    except NotFound:
        repo.create("account_access", PLATFORM, access, doc_id=uid)
    set_claims(uid, access)
    repo.update("signup_requests", PLATFORM, uid, {"status": "approved", "org_id": org_id, "decided_by": admin.uid})
    _platform_audit(repo, admin, "approve", uid)
    return {"uid": uid, "org_id": org_id, "role": role, "joined_existing": bool(body.org_id), "status": "approved"}


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
    rows = _active_registry(repo)  # merged organizations are kept for audit but not listed
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
    orgs = _active_registry(repo)
    signups = repo.list("signup_requests", PLATFORM)
    stats = [_org_stats(repo, o["org_id"], since) for o in orgs]
    return {"organizations": len(orgs), "users": sum(s["users"] for s in stats), "children": sum(s["children"] for s in stats),
            "sessions_30d": sum(s["sessions_30d"] for s in stats),
            "pending_signups": sum(1 for s in signups if s["status"] == "pending"),
            "signups_30d": sum(1 for s in signups if s.get("created_at", "") >= since)}


# ---------------------------------------------------------------- speech-to-text (site admin)
class SttSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fallback_enabled: bool
    monthly_fallback_cap_usd: float = Field(ge=0, le=10000)
    chunk_minutes: float = Field(ge=3, le=10)
    retain_original_days: int = Field(ge=0, le=365)


@router.get("/platform/stt/settings")
def stt_settings(admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    from ..config import get_settings
    from ..services.stt import budget
    s = get_settings()
    return {**budget.platform_settings(repo), "groq_configured": bool(s.groq_api_key and s.stt_model), "stt_model": s.stt_model,
            "fallback_configured": bool(s.openrouter_api_key and s.openrouter_stt_model), "fallback_model": s.openrouter_stt_model,
            "groq_audio_seconds_per_hour": s.groq_audio_seconds_per_hour, "groq_audio_seconds_per_day": s.groq_audio_seconds_per_day,
            "fallback_usd_per_hour": budget.fallback_rate_per_hour(repo, s)}


@router.put("/platform/stt/settings")
def put_stt_settings(body: SttSettingsIn, admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    data = body.model_dump()
    try:
        repo.update("platform_settings", PLATFORM, "stt", data)
    except NotFound:
        repo.create("platform_settings", PLATFORM, data, doc_id="stt")
    repo.create("audit_logs", PLATFORM, {"actor": admin.uid, "role": "site_admin", "action": "set_stt_settings",
                                         "collection": "platform_settings", "doc_id": "stt", "detail": data})
    return data


@router.get("/platform/stt/stats")
def stt_stats(admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    """Operational numbers only: no file names, transcripts, or child information."""
    from datetime import datetime as dt
    from ..config import get_settings
    from ..services.stt import budget
    s = get_settings()
    rows = [j for o in repo.list("organization_registry", PLATFORM) for j in repo.list("stt_jobs", o["org_id"])]
    by_status: dict[str, int] = {}
    for j in rows:
        by_status[j["status"]] = by_status.get(j["status"], 0) + 1
    finished = [j for j in rows if j.get("finished_at") and j.get("queued_at")]
    durations = [(dt.fromisoformat(j["finished_at"]) - dt.fromisoformat(j["queued_at"])).total_seconds() for j in finished]
    usage = budget.groq_usage(repo)
    month = budget.fallback_month(repo)
    platform = budget.platform_settings(repo)
    warnings = []
    if s.groq_audio_seconds_per_day and usage["day_seconds"] >= 0.8 * s.groq_audio_seconds_per_day:
        warnings.append("Groq 일일 오디오 한도의 80% 이상을 사용했습니다.")
    if s.groq_audio_seconds_per_hour and usage["hour_seconds"] >= 0.8 * s.groq_audio_seconds_per_hour:
        warnings.append("Groq 시간당 오디오 한도의 80% 이상을 사용했습니다.")
    waiting_quota = sum(1 for j in rows if j["status"] == "waiting" and j.get("wait_reason") == "groq_quota")
    if waiting_quota:
        warnings.append(f"무료 한도 때문에 대기 중인 작업이 {waiting_quota}건 있습니다. 요금제 상향이나 예비 경로 사용을 검토하세요.")
    cap = float(platform.get("monthly_fallback_cap_usd") or 0)
    if cap and month["cost_usd"] >= 0.8 * cap:
        warnings.append("예비 받아쓰기 월 비용 상한의 80% 이상을 사용했습니다.")
    return {
        "jobs_total": len(rows), "by_status": by_status,
        "audio_seconds_total": round(sum(j.get("duration_seconds") or 0 for j in rows), 1),
        "original_bytes_total": sum(j.get("original_size") or 0 for j in rows),
        "compressed_bytes_total": sum(j.get("compressed_size") or 0 for j in rows),
        "avg_processing_seconds": round(sum(durations) / len(durations), 1) if durations else None,
        "groq": {**usage, "hour_limit": s.groq_audio_seconds_per_hour, "day_limit": s.groq_audio_seconds_per_day},
        "fallback": {**month, "cap_usd": cap, "enabled": platform.get("fallback_enabled")},
        "failures": [{"job_id": j["id"][:8], "reason": (j.get("error") or {}).get("reason"), "status": j["status"],
                      "chunks_failed": j.get("chunks_failed", 0), "at": (j.get("error") or {}).get("at")}
                     for j in sorted(rows, key=lambda j: j.get("created_at", ""), reverse=True)
                     if j["status"] == "failed" or j.get("chunks_failed")][:20],
        "warnings": warnings,
    }
