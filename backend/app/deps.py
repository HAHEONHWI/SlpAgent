from fastapi import Depends
from uuid import uuid4
from .auth import Principal, current_principal
from .repo.base import NotFound, Repo, VersionedChange
from .repo.provider import get_repo  # re-exported: the single repository dependency


def _audit_data(p: Principal, action: str, col: str, doc_id: str, child_id: str | None, via_ai: bool):
    return {"actor": p.uid, "role": p.role, "action": action, "collection": col,
            "doc_id": doc_id, "child_id": child_id, "via_ai": via_ai}


def audit(repo: Repo, p: Principal, action: str, col: str, doc_id: str, child_id: str | None = None, via_ai: bool = False):
    repo.create("audit_logs", p.org_id, _audit_data(p, action, col, doc_id, child_id, via_ai))


def audit_change(p: Principal, action: str, col: str, doc_id: str, child_id: str | None = None) -> VersionedChange:
    return VersionedChange("audit_logs", uuid4().hex, None, _audit_data(p, action, col, doc_id, child_id, False))


def linked_therapist_name(org: dict, uid: str) -> str:
    return next((t["name"] for t in org.get("therapists") or [] if t.get("uid") == uid), "").strip()


def my_therapist_name(repo: Repo, p: Principal) -> str:
    """The 치료사 목록 name an admin linked to this account. Never the account's own (applicant-chosen) name:
    a same-name account must not inherit another therapist's 담당 아동, so an unlinked account has none."""
    try:
        org = repo.get("organizations", p.org_id, p.org_id)
    except NotFound:
        return ""
    return linked_therapist_name(org, p.uid)


def monthly_edit_owner(repo: Repo, p: Principal, child_id: str) -> tuple[str, tuple[VersionedChange, ...]]:
    """Bind the linked teacher and assigned child checks to the same commit as a monthly edit."""
    from fastapi import HTTPException
    child = child_or_404(repo, p, child_id)
    try:
        org = repo.get("organizations", p.org_id, p.org_id)
    except NotFound:
        raise HTTPException(404, "child not found")
    name = (child.get("therapist") or "").strip() if p.role == "admin" else linked_therapist_name(org, p.uid)
    if child.get("archived") or child.get("terminated_on") or (p.role != "admin" and (not name or (child.get("therapist") or "").strip() != name)):
        raise HTTPException(404, "child not found")
    guards = (VersionedChange("organizations", p.org_id, org["updated_at"]),
              VersionedChange("children", child_id, child["updated_at"]))
    return name, guards


def child_scope(repo: Repo, p: Principal, *, all_but_admin: bool = False) -> set[str] | None:
    """Children a non-admin account (therapist or read-only assistant) may see: the 담당 아동 of the 치료사 its
    account is linked to. None = no restriction (admins). `all_but_admin` is kept for callers; it no longer differs."""
    if p.role == "admin":
        return None
    name = my_therapist_name(repo, p)
    if not name:
        return set()
    return {c["id"] for c in repo.list("children", p.org_id) if (c.get("therapist") or "").strip() == name}


def in_scope(rows: list[dict], scope: set[str] | None, key: str = "child_id") -> list[dict]:
    """Drop rows about children outside the scope (rows with no child stay)."""
    return rows if scope is None else [r for r in rows if not r.get(key) or r[key] in scope]


def owned_or_404(repo: Repo, p: Principal, row: dict, detail: str = "not found") -> dict:
    """A child-scoped row loaded by its own id: another therapist's child's row is as if it did not exist."""
    from fastapi import HTTPException
    if p.role != "admin" and row.get("child_id"):
        try:
            child_or_404(repo, p, row["child_id"])
        except HTTPException as exc:
            raise HTTPException(404, detail) from exc
    return row


def child_or_404(repo: Repo, p: Principal, child_id: str) -> dict:
    from fastapi import HTTPException
    try:
        child = repo.get("children", p.org_id, child_id)
    except NotFound:
        raise HTTPException(404, "child not found")
    if p.role != "admin":  # therapists and read-only assistants: only the linked 치료사's children
        name = my_therapist_name(repo, p)
        if not name or (child.get("therapist") or "").strip() != name:
            raise HTTPException(404, "child not found")
    return child


def check_class_date(child: dict, day: str) -> None:
    from fastapi import HTTPException
    if child.get("terminated_on") and day >= child["terminated_on"]:
        raise HTTPException(409, "종결일부터는 수업을 등록할 수 없습니다")


def can_settle(repo: Repo, p: Principal) -> bool:
    """정산: organization admins and the accounts an admin made 회계 담당."""
    if p.role == "admin":
        return True
    try:
        return p.uid in (repo.get("organizations", p.org_id, p.org_id).get("accountants") or [])
    except NotFound:
        return False
