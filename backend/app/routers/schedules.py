from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from ..auth import Principal, current_principal, require_write
from ..deps import audit, child_or_404, child_scope, get_repo, in_scope
from ..repo.base import NotFound
from ..services.billing import minutes_between

router = APIRouter(prefix="/schedules", tags=["schedules"])


EXTRA = {"voucher": "추가(바우처 5회)", "paid": "추가(유료)"}


class ScheduleIn(BaseModel):
    child_id: str
    date: date
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$", description="omitted = start + the timetable's class length")
    therapist: str | None = Field(default=None, description="omitted = the child's 담당")
    note: str | None = None
    extra: Literal["voucher", "paid"] | None = Field(default=None, description="수업 추가: 바우처 5회 (in the voucher form) or 유료 (left out of it)")

    @model_validator(mode="after")
    def _t(self):
        if self.end:
            minutes_between(self.start, self.end)
        return self


def _overlap(a, b) -> bool:
    return a["start"] < b["end"] and b["start"] < a["end"]


@router.post("", status_code=201)
def create(body: ScheduleIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child = child_or_404(repo, p, body.child_id)
    d = body.model_dump(mode="json")
    if not d["end"]:
        from .timetable import _add, _config
        d["end"] = _add(d["start"], _config(repo, p.org_id).session_minutes)
    d["therapist"] = (d["therapist"] or child.get("therapist") or "").strip()
    if not d["therapist"]:
        raise HTTPException(422, "치료사를 입력하세요")
    if d["extra"]:
        d.update(source="extra", note=d["note"] or EXTRA[d["extra"]])
    else:
        d.pop("extra")
    for s in repo.list("schedules", p.org_id, date=d["date"], status="scheduled"):
        if _overlap(s, d) and (s.get("therapist") == d["therapist"] or s["child_id"] == d["child_id"]):
            raise HTTPException(409, f"시간 충돌: {s['start']}–{s['end']} ({s.get('therapist')})")
    doc = repo.create("schedules", p.org_id, {**d, "status": "scheduled"})
    audit(repo, p, "create", "schedules", doc["id"], body.child_id)
    return doc


@router.get("")
def list_(month: str | None = None, child_id: str | None = None, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    if month:
        from .timetable import sync_month
        sync_month(repo, p.org_id, month)  # dated classes follow the weekly timetable automatically
    flt = {"child_id": child_id} if child_id else {}
    if month:
        from .attendance import month_bounds
        rows = repo.list_range("schedules", p.org_id, "date", *month_bounds(month), **flt)
    else:
        rows = repo.list("schedules", p.org_id, **flt)
    rows = in_scope(rows, child_scope(repo, p))
    return sorted(rows, key=lambda r: (r["date"], r["start"]))


@router.post("/{sid}/cancel")
def cancel(sid: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    try:
        s = repo.get("schedules", p.org_id, sid)
    except NotFound:
        raise HTTPException(404)
    audit(repo, p, "cancel", "schedules", sid, s["child_id"])
    return repo.update("schedules", p.org_id, sid, {"status": "cancelled"})
