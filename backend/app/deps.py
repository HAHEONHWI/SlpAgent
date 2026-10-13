from fastapi import Depends
from .auth import Principal, current_principal
from .repo.base import NotFound, Repo
from .repo.provider import get_repo  # re-exported: the single repository dependency


def audit(repo: Repo, p: Principal, action: str, col: str, doc_id: str, child_id: str | None = None, via_ai: bool = False):
    repo.create("audit_logs", p.org_id, {"actor": p.uid, "role": p.role, "action": action, "collection": col,
                                         "doc_id": doc_id, "child_id": child_id, "via_ai": via_ai})


def child_or_404(repo: Repo, p: Principal, child_id: str) -> dict:
    from fastapi import HTTPException
    try:
        return repo.get("children", p.org_id, child_id)
    except NotFound:
        raise HTTPException(404, "child not found")
