from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from ..auth import Principal, current_principal, require_write
from ..deps import audit, child_or_404, get_repo

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
    return [c for c in repo.list("children", p.org_id) if not c.get("archived")]


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
    return repo.update("children", p.org_id, child_id,
                       {"archived": True, "archived_at": datetime.now(timezone.utc).isoformat()})
