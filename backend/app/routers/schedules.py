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


def busy(repo, org_id: str, day: str) -> list[dict]:
    """Classes that take up a therapist's and a child's time that day: a class marked 결석·사유결석 (or in a
    장기결강 period) frees the slot, so another class can be added there."""
    from ..services.attendance_state import effective
    rows = repo.list("schedules", org_id, date=day, status="scheduled")
    if not rows:
        return []
    marks = {m["schedule_id"]: m for m in repo.list("attendance", org_id, date=day)}
    absences = [a for a in repo.list("absences", org_id) if a["start"] <= day <= a["end"]]
    return [s for s in rows if effective(s, marks.get(s["id"]), absences, today="9999-12-31")["status"] not in ("absent", "excused")]


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
    for s in busy(repo, p.org_id, d["date"]):
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


class ScheduleEdit(BaseModel):
    date: date
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$", description="omitted = keep the class length")
    extra: Literal["voucher", "paid"] | None = Field(default=None, description="omitted = keep the kind")


@router.put("/{sid}")
def edit(sid: str, body: ScheduleEdit, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    """Fix an added class (수업 추가 or 보강) entered with the wrong day or time. Timetable classes follow the
    weekly timetable and are changed there."""
    try:
        s = repo.get("schedules", p.org_id, sid)
    except NotFound:
        raise HTTPException(404, "schedule not found")
    child_or_404(repo, p, s["child_id"])  # another therapist's class: as if it did not exist
    if s.get("timetable_entry_id"):
        raise HTTPException(409, "시간표 수업은 주간 시간표에서 바꾸세요")
    if s.get("status") != "scheduled":
        raise HTTPException(409, "옮겼거나 취소된 수업은 고칠 수 없습니다")
    from .timetable import _add
    end = body.end or _add(body.start, minutes_between(s["start"], s["end"]))
    try:
        minutes_between(body.start, end)
    except ValueError:
        raise HTTPException(422, "끝 시간이 시작 시간보다 빨라요")
    d = {"date": body.date.isoformat(), "start": body.start, "end": end}
    for o in busy(repo, p.org_id, d["date"]):
        if o["id"] != sid and _overlap(o, d) and (o.get("therapist") == s.get("therapist") or o["child_id"] == s["child_id"]):
            raise HTTPException(409, f"시간 충돌: {o['start']}–{o['end']} ({o.get('therapist')})")
    if s.get("extra") and body.extra and body.extra != s["extra"]:
        d["extra"] = body.extra
        if s.get("note") in EXTRA.values():  # the default note follows the kind
            d["note"] = EXTRA[body.extra]
    try:  # an attendance mark keeps a copy of the day and time
        repo.update("attendance", p.org_id, sid, {k: d[k] for k in ("date", "start", "end")})
    except NotFound:
        pass
    audit(repo, p, "update", "schedules", sid, s["child_id"])
    return repo.update("schedules", p.org_id, sid, d)


class PayIn(BaseModel):
    pay: Literal["voucher", "private", "cognitive"] | None = Field(default=None, description="결제 구분; None = 자동 (바우처 26만원까지, 넘으면 사비)")


@router.put("/{sid}/pay")
def set_pay(sid: str, body: PayIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    """Choose how one class is paid: 바우처, 사비 or 인지 (인지치료, 사비 단가로 따로 집계). None goes back to automatic."""
    try:
        s = repo.get("schedules", p.org_id, sid)
    except NotFound:
        raise HTTPException(404, "schedule not found")
    child_or_404(repo, p, s["child_id"])
    audit(repo, p, "update", "schedules", sid, s["child_id"])
    return repo.update("schedules", p.org_id, sid, {"pay": body.pay})
