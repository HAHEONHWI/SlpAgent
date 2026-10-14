from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from ..auth import Principal, current_principal, require_write
from ..deps import audit, child_or_404, child_scope, get_repo, in_scope
from ..repo.base import NotFound
from ..services.billing import minutes_between

router = APIRouter(prefix="/schedules", tags=["schedules"])


class ScheduleIn(BaseModel):
    child_id: str
    date: date
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$")
    therapist: str
    note: str | None = None

    @model_validator(mode="after")
    def _t(self):
        minutes_between(self.start, self.end)
        return self


def _overlap(a, b) -> bool:
    return a["start"] < b["end"] and b["start"] < a["end"]


@router.post("", status_code=201)
def create(body: ScheduleIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child_or_404(repo, p, body.child_id)
    d = body.model_dump(mode="json")
    for s in repo.list("schedules", p.org_id, date=d["date"], status="scheduled"):
        if _overlap(s, d) and (s["therapist"] == d["therapist"] or s["child_id"] == d["child_id"]):
            raise HTTPException(409, f"시간 충돌: {s['start']}–{s['end']} ({s['therapist']})")
    doc = repo.create("schedules", p.org_id, {**d, "status": "scheduled"})
    audit(repo, p, "create", "schedules", doc["id"], body.child_id)
    return doc


@router.get("")
def list_(month: str | None = None, child_id: str | None = None, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    if month:
        from .timetable import sync_month
        sync_month(repo, p.org_id, month)  # dated classes follow the weekly timetable automatically
    rows = repo.list("schedules", p.org_id, **({"child_id": child_id} if child_id else {}))
    rows = in_scope([r for r in rows if not month or r["date"].startswith(month)], child_scope(repo, p))
    return sorted(rows, key=lambda r: (r["date"], r["start"]))


@router.post("/{sid}/cancel")
def cancel(sid: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    try:
        s = repo.get("schedules", p.org_id, sid)
    except NotFound:
        raise HTTPException(404)
    audit(repo, p, "cancel", "schedules", sid, s["child_id"])
    return repo.update("schedules", p.org_id, sid, {"status": "cancelled"})
