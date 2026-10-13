from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from ..auth import Principal, current_principal, require_admin, require_write
from ..config import get_settings
from ..deps import audit, child_or_404, get_repo
from ..services.child_purge import purge_child

router = APIRouter(prefix="/children", tags=["children"])


class ChildIn(BaseModel):
    alias: str = Field(min_length=1, max_length=40, description="가명/내부 코드. AI에는 이것만 전달")
    display_name: str = Field(min_length=1, max_length=40)
    birth_date: date
    sex: str | None = None
    guardian_contact: str | None = None
    notes: str | None = None


def age_months(birth: str, on: date | None = None) -> int:
    b, d = date.fromisoformat(birth), on or date.today()
    return (d.year - b.year) * 12 + d.month - b.month - (1 if d.day < b.day else 0)


@router.post("", status_code=201)
def create_child(body: ChildIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    doc = repo.create("children", p.org_id, {**body.model_dump(mode="json"), "archived": False})
    audit(repo, p, "create", "children", doc["id"], doc["id"])
    return doc


@router.get("")
def list_children(p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    # age_months is derived on read (never stored) so it is always current
    return [{**c, "age_months": age_months(c["birth_date"])} for c in repo.list("children", p.org_id) if not c.get("archived")]


@router.get("/archived")
def list_archived(p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    """삭제된 아동 (trash): restorable until an admin deletes them permanently."""
    rows = [c for c in repo.list("children", p.org_id) if c.get("archived")]
    return sorted(rows, key=lambda c: c.get("archived_at") or "", reverse=True)


@router.get("/{child_id}")
def get_child(child_id: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    c = child_or_404(repo, p, child_id)
    audit(repo, p, "read", "children", child_id, child_id)
    return {**c, "age_months": age_months(c["birth_date"])}


@router.post("/{child_id}/archive")
def archive(child_id: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child = child_or_404(repo, p, child_id)
    if child.get("archived"):
        return child
    audit(repo, p, "archive", "children", child_id, child_id)
    today = date.today().isoformat()
    for s in repo.list("schedules", p.org_id, child_id=child_id):  # upcoming sessions no longer happen
        if s.get("status") == "scheduled" and s["date"] >= today:
            repo.update("schedules", p.org_id, s["id"], {"status": "cancelled", "cancel_reason": "child archived"})
    return repo.update("children", p.org_id, child_id,
                       {"archived": True, "archived_at": datetime.now(timezone.utc).isoformat()})


@router.post("/{child_id}/restore")
def restore(child_id: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child = child_or_404(repo, p, child_id)
    if not child.get("archived"):
        return child
    audit(repo, p, "restore", "children", child_id, child_id)
    return repo.update("children", p.org_id, child_id, {"archived": False, "archived_at": None})


class PurgeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm_name: str = Field(description="the child's display name, typed by the admin")


@router.post("/{child_id}/purge")
def purge(child_id: str, body: PurgeIn, p: Principal = Depends(require_admin), repo=Depends(get_repo)):
    """영구 삭제: only for a child already in the trash, and only by an organization admin."""
    child = child_or_404(repo, p, child_id)
    if not child.get("archived"):
        raise HTTPException(409, "삭제(보관)한 아동만 영구 삭제할 수 있습니다")
    if body.confirm_name.strip() != child.get("display_name", "").strip():
        raise HTTPException(422, "아동 이름이 일치하지 않습니다")
    purge_child(repo, p.org_id, child_id, p.uid, p.role, get_settings())
    return {"id": child_id, "purged": True}
