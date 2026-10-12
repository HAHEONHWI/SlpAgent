from fastapi import APIRouter, Depends, Query
from ..auth import Principal, require_admin
from ..deps import audit, get_repo


router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/audit-logs")
def audit_logs(limit: int = Query(default=100, ge=1, le=500), child_id: str | None = None,
               p: Principal = Depends(require_admin), repo=Depends(get_repo)):
    filters = {"child_id": child_id} if child_id else {}
    rows = repo.list("audit_logs", p.org_id, **filters)
    rows.sort(key=lambda row: row.get("created_at", ""), reverse=True)
    audit(repo, p, "read", "audit_logs", "query", child_id)
    return rows[:limit]
