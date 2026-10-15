from fastapi import Depends
from .auth import Principal, current_principal
from .repo.base import NotFound, Repo
from .repo.provider import get_repo  # re-exported: the single repository dependency


def audit(repo: Repo, p: Principal, action: str, col: str, doc_id: str, child_id: str | None = None, via_ai: bool = False):
    repo.create("audit_logs", p.org_id, {"actor": p.uid, "role": p.role, "action": action, "collection": col,
                                         "doc_id": doc_id, "child_id": child_id, "via_ai": via_ai})


def my_therapist_name(repo: Repo, p: Principal) -> str:
    """The 치료사 목록 name linked to this account (else the account's own name)."""
    try:
        linked = repo.get("organizations", p.org_id, p.org_id).get("therapists") or []
        name = next((t["name"] for t in linked if t.get("uid") == p.uid), None)
        if name:
            return name.strip()
    except NotFound:
        pass
    try:
        return (repo.get("users", p.org_id, p.uid).get("name") or "").strip()
    except NotFound:
        return ""


def child_scope(repo: Repo, p: Principal, *, all_but_admin: bool = False) -> set[str] | None:
    """Children a non-admin therapist may see: their own 담당 아동. None = no restriction (admins, and assistants
    unless all_but_admin: then every non-admin account sees only the children it is 담당 of)."""
    if p.role == "admin" or (p.role != "therapist" and not all_but_admin):
        return None
    name = my_therapist_name(repo, p)
    return {c["id"] for c in repo.list("children", p.org_id) if name and (c.get("therapist") or "").strip() == name}


def in_scope(rows: list[dict], scope: set[str] | None, key: str = "child_id") -> list[dict]:
    """Drop rows about children outside the scope (rows with no child stay)."""
    return rows if scope is None else [r for r in rows if not r.get(key) or r[key] in scope]


def child_or_404(repo: Repo, p: Principal, child_id: str) -> dict:
    from fastapi import HTTPException
    try:
        child = repo.get("children", p.org_id, child_id)
    except NotFound:
        raise HTTPException(404, "child not found")
    scope = child_scope(repo, p)
    if scope is not None and child_id not in scope:  # another therapist's child: as if it did not exist
        raise HTTPException(404, "child not found")
    return child


def can_settle(repo: Repo, p: Principal) -> bool:
    """정산: organization admins and the accounts an admin made 회계 담당."""
    if p.role == "admin":
        return True
    try:
        return p.uid in (repo.get("organizations", p.org_id, p.org_id).get("accountants") or [])
    except NotFound:
        return False
