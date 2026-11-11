from uuid import uuid4
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from ..auth import Principal, current_principal, require_write
from ..deps import audit, audit_change, check_class_date, child_or_404, child_scope, get_repo, in_scope, monthly_edit_owner
from ..repo.base import NotFound, RevisionConflict, VersionedChange
from ..services.billing import assign_pay, minutes_between, recording_end

router = APIRouter(prefix="/schedules", tags=["schedules"])


EXTRA = {"voucher": "바우처 수업", "paid": "사비 수업"}


class ScheduleIn(BaseModel):
    child_id: str
    date: date
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$", description="omitted = start + the timetable's class length")
    therapist: str | None = Field(default=None, description="omitted = the child's 담당")
    note: str | None = None
    pay: Literal["voucher", "private"] | None = Field(default=None, description="수업 구분. 미설정은 바우처; 기존 extra=paid 요청은 사비")
    extra: Literal["voucher", "paid"] | None = Field(default=None, description="수업 추가: 바우처 또는 사비")

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


def _day_guard(repo, org_id: str, day: str):
    key = f"{org_id}_{day}"
    try:
        rev = repo.get("schedule_days", org_id, key)["updated_at"]
    except NotFound:
        rev = None
    return VersionedChange("schedule_days", key, rev, {"date": day})


class MonthSlotIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    child_id: str
    date: date
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    therapist: str | None = Field(default=None, max_length=20)


@router.post("/month-sheet", status_code=201)
def create_month_slot(body: MonthSlotIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    from .timetable import sync_month
    teacher, guards = monthly_edit_owner(repo, p, body.child_id)
    if body.therapist and body.therapist != teacher:
        from .org import roster
        if p.role != "admin" or body.therapist not in {t["name"] for t in roster(repo, p.org_id)}:
            raise HTTPException(404, "therapist not found")
        teacher = body.therapist
    sync_month(repo, p.org_id, body.date.strftime("%Y-%m"))
    return _create(ScheduleIn(**{**body.model_dump(), "therapist": teacher}), p, repo, guards)


@router.post("", status_code=201)
def create(body: ScheduleIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    return _create(body, p, repo)


def _create(body, p, repo, guards=()):
    child = child_or_404(repo, p, body.child_id)
    check_class_date(child, body.date.isoformat())
    d = body.model_dump(mode="json")
    d["pay"] = d["pay"] or ("private" if d["extra"] == "paid" else "voucher")
    if not d["end"]:
        from .timetable import _add, _config
        d["end"] = _add(d["start"], _config(repo, p.org_id).session_minutes)
    d["therapist"] = (d["therapist"] or child.get("therapist") or "").strip()
    if not d["therapist"]:
        raise HTTPException(422, "치료사를 입력하세요")
    if d["extra"]:
        d["extra"] = "paid" if d["pay"] == "private" else "voucher"
        d.update(source="extra", note=d["note"] or EXTRA[d["extra"]])
    else:
        d.pop("extra")
    slot_guard = _day_guard(repo, p.org_id, d["date"])
    for s in busy(repo, p.org_id, d["date"]):
        if _overlap(s, d) and (s.get("therapist") == d["therapist"] or s["child_id"] == d["child_id"]):
            raise HTTPException(409, f"시간 충돌: {s['start']}–{s['end']} ({s.get('therapist')})")
    sid = uuid4().hex
    if not guards:
        guards = (VersionedChange("children", body.child_id, child["updated_at"]),)
    try:
        return repo.save_versioned("schedules", p.org_id, sid, {**d, "status": "scheduled"}, None,
                                   also=(*guards, slot_guard, audit_change(p, "create", "schedules", sid, body.child_id)))
    except RevisionConflict:
        raise HTTPException(409, "일정 또는 담당 정보가 변경되었습니다. 다시 확인하세요")


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
    rows = [{**s, "recording_end": recording_end(s.get("start"))} for s in in_scope(rows, child_scope(repo, p))
            if s.get("cancel_reason") != "아동 종결"]
    own = lambda s: {**s, "pay": s.get("pay") or ("private" if s.get("extra") == "paid" else "voucher"), "pay_auto": not s.get("pay")}
    if not month:
        return [own(s) for s in sorted(rows, key=lambda s: (s["date"], s["start"]))]
    # 바우처 vs 사비 depends on the child's month (결제 일정, or the first 5 held classes): classify each child's held classes
    from .attendance import month_bounds
    from .voucher_doc import month_classes, pay_plans
    marks = {m["schedule_id"]: m for m in repo.list_range("attendance", p.org_id, "date", *month_bounds(month), **flt)}
    absences = repo.list("absences", p.org_id, **flt)
    plans = pay_plans(repo, p.org_id, month)
    by_child: dict[str, list[dict]] = {}
    for s in rows:
        by_child.setdefault(s["child_id"], []).append(s)
    pays = {c["id"]: c for cid, ss in by_child.items()
            for c in assign_pay(month_classes(ss, marks, absences, [], month), plans.get(cid))}
    return [{**s, "pay": pays[s["id"]]["pay"], "pay_auto": pays[s["id"]]["pay_auto"]} if s["id"] in pays else own(s)
            for s in sorted(rows, key=lambda s: (s["date"], s["start"]))]


@router.post("/{sid}/cancel")
def cancel(sid: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    try:
        s = repo.get("schedules", p.org_id, sid)
    except NotFound:
        raise HTTPException(404)
    child_or_404(repo, p, s["child_id"])
    audit(repo, p, "cancel", "schedules", sid, s["child_id"])
    return repo.update("schedules", p.org_id, sid, {"status": "cancelled"})


@router.post("/{sid}/restore")
def restore(sid: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    try:
        s = repo.get("schedules", p.org_id, sid)
    except NotFound:
        raise HTTPException(404, "schedule not found")
    child = child_or_404(repo, p, s["child_id"])
    if s.get("status") != "cancelled" or s.get("cancel_reason") or s.get("closure"):
        raise HTTPException(409, "직접 취소한 일정만 되돌릴 수 있습니다")
    if child.get("archived"):
        raise HTTPException(409, "보관된 아동 일정은 되돌릴 수 없습니다")
    check_class_date(child, s["date"])

    try:
        mark = repo.get("attendance", p.org_id, sid)
    except NotFound:
        mark = None
    slot_guard = _day_guard(repo, p.org_id, s["date"])
    from ..services.attendance_state import effective
    state = effective({**s, "status": "scheduled"}, mark, repo.list("absences", p.org_id, child_id=s["child_id"]), today="9999-12-31")
    if state["status"] not in ("absent", "excused"):
        clash = next((o for o in busy(repo, p.org_id, s["date"])
                      if _overlap(o, s) and (o.get("therapist") == s.get("therapist") or o["child_id"] == s["child_id"])), None)
        if clash:
            raise HTTPException(409, f"시간 충돌: {clash['start']}–{clash['end']} ({clash.get('therapist')})")

    try:
        return repo.save_versioned("schedules", p.org_id, sid, {"status": "scheduled"}, s["updated_at"],
                                   also=(VersionedChange("children", s["child_id"], child["updated_at"]),
                                         slot_guard,
                                         audit_change(p, "restore", "schedules", sid, s["child_id"])))
    except RevisionConflict:
        raise HTTPException(409, "일정 또는 담당 정보가 변경되었습니다. 새로고침 후 다시 시도하세요")


class ScheduleEdit(BaseModel):
    date: date
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$", description="omitted = keep the class length")
    extra: Literal["voucher", "paid"] | None = Field(default=None, description="omitted = keep the kind")
    pay: Literal["voucher", "private", "cognitive", "pending"] | None = Field(default=None, description="Older clients echo the calculated 'pending' status. It leaves stored payment unchanged.")
    note: str | None = Field(default=None, max_length=500)


class MonthlyScheduleEdit(ScheduleEdit):
    expected_revision: str = Field(min_length=1, max_length=128)


@router.put("/{sid}")
def edit(sid: str, body: ScheduleEdit, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    """Edit one dated class, keeping the recurring timetable and other dates unchanged."""
    return _edit_schedule(sid, body, p, repo)


@router.put("/{sid}/month-sheet")
def edit_month_class(sid: str, body: MonthlyScheduleEdit, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    """Edit the time or note of a class on the caller's own monthly timetable."""
    if {"pay", "extra"} & body.model_fields_set:
        raise HTTPException(422, "월간 실제 일정에서는 수업 날짜·시간·메모만 수정할 수 있습니다")
    return _edit_schedule(sid, body, p, repo, expected_revision=body.expected_revision)


def _editable_schedule(repo, p: Principal, sid: str, monthly: bool):
    try:
        s = repo.get("schedules", p.org_id, sid)
    except NotFound:
        raise HTTPException(404, "schedule not found")
    guards = ()
    if monthly:
        teacher, guards = monthly_edit_owner(repo, p, s["child_id"])
        if p.role != "admin" and (s.get("therapist") or "").strip() != teacher:
            raise HTTPException(404, "schedule not found")
    else:
        child_or_404(repo, p, s["child_id"])
    if s.get("status") != "scheduled":
        raise HTTPException(409, "옮겼거나 취소된 수업은 고칠 수 없습니다")
    return s, guards


def _edit_schedule(sid: str, body: ScheduleEdit, p: Principal, repo, *, expected_revision: str | None = None):
    monthly = expected_revision is not None
    s, guards = _editable_schedule(repo, p, sid, monthly)
    check_class_date(child_or_404(repo, p, s["child_id"]), body.date.isoformat())
    from .timetable import sync_month
    if monthly:  # recurring sync can replace, reassign, or remove the dated class
        if expected_revision != s["updated_at"]:
            raise HTTPException(409, "수업 또는 담당 정보가 변경되었습니다. 다시 열어 확인하세요")
        sync_month(repo, p.org_id, body.date.isoformat()[:7])
        s, guards = _editable_schedule(repo, p, sid, monthly)
    from .timetable import _add
    end = body.end or _add(body.start, minutes_between(s["start"], s["end"]))
    try:
        minutes_between(body.start, end)
    except ValueError:
        raise HTTPException(422, "끝 시간이 시작 시간보다 빨라요")
    d = {"date": body.date.isoformat(), "start": body.start, "end": end}
    if not monthly:
        sync_month(repo, p.org_id, d["date"][:7])
    slot_guard = _day_guard(repo, p.org_id, d["date"])
    for o in busy(repo, p.org_id, d["date"]):
        if o["id"] != sid and _overlap(o, d) and (o.get("therapist") == s.get("therapist") or o["child_id"] == s["child_id"]):
            raise HTTPException(409, f"시간 충돌: {o['start']}–{o['end']} ({o.get('therapist')})")
    pay = body.pay or ({"voucher": "voucher", "paid": "private"}[body.extra] if body.extra else None)
    if pay is not None and pay != "pending":
        d["pay"] = pay
    if s.get("extra") and pay in ("voucher", "private"):
        d["extra"] = "paid" if pay == "private" else "voucher"
        if s.get("note") in (*EXTRA.values(), "추가(바우처 5회)", "추가(유료)"):
            d["note"] = EXTRA[d["extra"]]
    if "note" in body.model_fields_set:
        d["note"] = body.note
    if s.get("timetable_entry_id"):
        d["timetable_date"] = s.get("timetable_date") or s["date"]
    times = {k: d[k] for k in ("date", "start", "end")}
    if not guards:
        child = child_or_404(repo, p, s["child_id"])
        check_class_date(child, d["date"])
        guards = (VersionedChange("children", s["child_id"], child["updated_at"]),)
    try:
        mark = repo.get("attendance", p.org_id, sid)
        attendance = VersionedChange("attendance", sid, mark["updated_at"], times)
    except NotFound:
        attendance = VersionedChange("attendance", sid, None)
    try:
        return repo.save_versioned("schedules", p.org_id, sid, d, expected_revision or s["updated_at"],
                                   also=(*guards, slot_guard, attendance, audit_change(p, "update", "schedules", sid, s["child_id"])))
    except RevisionConflict:
        raise HTTPException(409, "수업 또는 담당 정보가 변경되었습니다. 다시 열어 확인하세요")


class PayIn(BaseModel):
    pay: Literal["voucher", "private", "cognitive"] | None = Field(default=None, description="결제 구분; None = 기본 바우처 (기존 추가 사비 수업은 사비)")


@router.put("/{sid}/pay")
def set_pay(sid: str, body: PayIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    """Choose how one class is paid: 바우처, 사비 or 인지 (인지치료, 사비 단가로 따로 집계). None restores the default."""
    try:
        s = repo.get("schedules", p.org_id, sid)
    except NotFound:
        raise HTTPException(404, "schedule not found")
    child_or_404(repo, p, s["child_id"])
    if body.pay == "voucher":
        from .voucher_doc import pay_plan
        if pay_plan(repo, p.org_id, s["child_id"], s["date"][:7])["mode"] == "unset":
            raise HTTPException(409, "바우처 분류를 위해 담당 치료사가 내 결제 설정을 저장하거나, 월간 일정표에서 이 아동의 결제 날짜를 지정해 주세요")
    audit(repo, p, "update", "schedules", sid, s["child_id"])
    return repo.update("schedules", p.org_id, sid, {"pay": body.pay})
