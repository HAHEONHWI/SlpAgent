"""Attendance (출결) per scheduled session: one mark per schedule, a daily roll call and monthly summaries."""
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from datetime import datetime, timedelta
from ..auth import Identity, Principal, current_principal, require_admin, require_site_admin, require_write
from ..deps import audit, child_or_404, child_scope, get_repo, in_scope
from ..repo.base import NotFound
from ..services.accounts import PLATFORM
from .timetable import touch_timetable
from ..services.attendance_state import NOT_HELD, effective
from ..services.billing import attendance_summary, minutes_between


def month_bounds(month: str) -> tuple[str, str]:
    """'YYYY-MM' -> first and last possible date strings, for date-range reads."""
    return f"{month[:7]}-01", f"{month[:7]}-31"


def _plus(hhmm: str, minutes: int) -> str:
    return (datetime.strptime(hhmm, "%H:%M") + timedelta(minutes=minutes)).strftime("%H:%M")

router = APIRouter(tags=["attendance"])


def _scope(repo, p: Principal) -> set[str] | None:
    """출결 관리: everyone but admins sees only their own 담당 아동."""
    return child_scope(repo, p, all_but_admin=True)


def _mine(repo, p: Principal, s: dict) -> dict:
    """Another therapist's class: as if it did not exist."""
    scope = _scope(repo, p)
    if scope is not None and s.get("child_id") not in scope:
        raise HTTPException(404, "schedule not found")
    return s


class AttendanceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["present", "late", "absent", "excused", "makeup"]
    minutes_late: int | None = Field(default=None, ge=0, le=240)
    note: str | None = Field(default=None, max_length=500)


@router.put("/schedules/{sid}/attendance")
def mark(sid: str, body: AttendanceIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    try:
        s = repo.get("schedules", p.org_id, sid)
    except NotFound:
        raise HTTPException(404, "schedule not found")
    _mine(repo, p, s)
    if s.get("status") == "cancelled":
        raise HTTPException(409, "cancelled schedules have no attendance")
    data = {**body.model_dump(), "schedule_id": sid, "child_id": s["child_id"], "date": s["date"],
            "start": s["start"], "end": s["end"], "therapist": s.get("therapist"), "marked_by": p.uid}
    if body.status != "late":
        data["minutes_late"] = None
    try:  # one mark per schedule (doc id = schedule id); re-marking replaces it
        doc = repo.update("attendance", p.org_id, sid, data)
    except NotFound:
        doc = repo.create("attendance", p.org_id, data, doc_id=sid)
    audit(repo, p, "mark_attendance", "attendance", sid, s["child_id"])
    return doc


def _absences(repo, org_id: str, child_id: str | None = None) -> list[dict]:
    rows = repo.list("absences", org_id, **({"child_id": child_id} if child_id else {}))
    return sorted(rows, key=lambda a: a["start"])


def _summary(states: list[dict]) -> dict:
    happened = [st for st in states if st["status"] and st["status"] not in NOT_HELD]
    out = attendance_summary(happened)
    out.update(auto=sum(1 for st in happened if st["auto"] and st["status"] == "present"),
               upcoming=sum(1 for st in states if st["status"] is None),
               moved=sum(1 for st in states if st["status"] == "moved"))
    return out


@router.get("/attendance/day")
def day(on: date, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    """Roll call: that day's classes with what happened (explicit mark, 장기결강, or 출석 by default)."""
    from .timetable import sync_month
    sync_month(repo, p.org_id, on.isoformat()[:7])  # the day's classes come from the weekly timetable
    d = on.isoformat()
    marks = {m["schedule_id"]: m for m in repo.list("attendance", p.org_id, date=d)}
    absences = _absences(repo, p.org_id)
    rows = in_scope([s for s in repo.list("schedules", p.org_id, date=d) if s.get("status") != "cancelled"], _scope(repo, p))
    out = []
    for s in sorted(rows, key=lambda s: s["start"]):
        moved_to = None
        if s.get("moved_to"):
            try:
                n = repo.get("schedules", p.org_id, s["moved_to"])
                moved_to = {"schedule_id": n["id"], "date": n["date"], "start": n["start"]}
            except NotFound:
                pass
        out.append({"schedule_id": s["id"], "child_id": s["child_id"], "date": d, "start": s["start"], "end": s["end"],
                    "therapist": s.get("therapist"), "attendance": marks.get(s["id"]),
                    "state": effective(s, marks.get(s["id"]), absences), "moved_to": moved_to, "moved_from": s.get("moved_from"),
                    "source": s.get("source"), "extra": s.get("extra")})
    return out


@router.get("/attendance/summary")
def org_summary(month: str = Query(pattern=r"^\d{4}-\d{2}$"), p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    """Per-child monthly summary. Classes nobody marked count as 출석 once their day has come."""
    from .timetable import sync_month
    sync_month(repo, p.org_id, month)
    first, last = month_bounds(month)
    marks = {m["schedule_id"]: m for m in repo.list_range("attendance", p.org_id, "date", first, last)}
    absences = _absences(repo, p.org_id)
    by_child: dict[str, list[dict]] = {}
    for s in in_scope(repo.list_range("schedules", p.org_id, "date", first, last), _scope(repo, p)):
        if s.get("status") != "cancelled":
            by_child.setdefault(s["child_id"], []).append(effective(s, marks.get(s["id"]), absences))
    return [{"child_id": c, "scheduled": sum(1 for st in states if st["status"] != "moved"), **_summary(states)}
            for c, states in sorted(by_child.items())]


@router.get("/children/{child_id}/attendance")
def child_attendance(child_id: str, month: str | None = None, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    child_or_404(repo, p, child_id)
    if (scope := _scope(repo, p)) is not None and child_id not in scope:
        raise HTTPException(404, "child not found")
    if month:
        from .timetable import sync_month
        sync_month(repo, p.org_id, month)
    first, last = month_bounds(month) if month else ("0000-00-00", "9999-12-31")
    marks = {m["schedule_id"]: m for m in repo.list_range("attendance", p.org_id, "date", first, last, child_id=child_id)}
    absences = _absences(repo, p.org_id, child_id)
    rows = sorted((s for s in repo.list_range("schedules", p.org_id, "date", first, last, child_id=child_id)
                   if s.get("status") != "cancelled"),
                  key=lambda s: (s["date"], s["start"]))
    states = [effective(s, marks.get(s["id"]), absences) for s in rows]
    records = [{"schedule_id": s["id"], "date": s["date"], "start": s["start"], "end": s["end"], "extra": s.get("extra"), **st}
               for s, st in zip(rows, states)]
    return {"records": records, "summary": _summary(states)}


@router.delete("/schedules/{sid}/attendance", status_code=204)
def clear_mark(sid: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    """Back to the default (출석 once the day has come)."""
    try:
        m = repo.get("attendance", p.org_id, sid)
    except NotFound:
        return
    _mine(repo, p, m)
    repo.delete("attendance", p.org_id, sid)
    audit(repo, p, "clear_attendance", "attendance", sid, m.get("child_id"))


# ---- 보강: move a class to another day -------------------------------------------------------------

class MoveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: date
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    reason: str | None = Field(default=None, max_length=200)


def _schedule(repo, p: Principal, sid: str) -> dict:
    try:
        return _mine(repo, p, repo.get("schedules", p.org_id, sid))
    except NotFound:
        raise HTTPException(404, "schedule not found")


@router.post("/schedules/{sid}/move")
def move(sid: str, body: MoveIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    """The class does not happen on its day; a 보강 class is booked instead. Both stay linked so it can be undone."""
    s = _schedule(repo, p, sid)
    if s.get("status") != "scheduled":
        raise HTTPException(409, "이미 옮겼거나 취소된 수업입니다")
    try:
        repo.get("attendance", p.org_id, sid)
        raise HTTPException(409, "출결을 기록한 수업은 옮길 수 없습니다. 기록을 지운 뒤 옮기세요")
    except NotFound:
        pass
    minutes = minutes_between(s["start"], s["end"])
    new = {"child_id": s["child_id"], "date": body.date.isoformat(), "start": body.start, "end": _plus(body.start, minutes),
           "therapist": s.get("therapist"), "note": "보강", "status": "scheduled", "source": "makeup", "moved_from": sid}
    if s.get("extra"):  # a moved 추가 수업 stays the same kind
        new["extra"] = s["extra"]
    from .schedules import busy
    for o in busy(repo, p.org_id, new["date"]):
        if o["start"] < new["end"] and new["start"] < o["end"] and (o.get("therapist") == new["therapist"] or o["child_id"] == new["child_id"]):
            raise HTTPException(409, f"시간 충돌: {o['start']}–{o['end']} ({o.get('therapist')})")
    doc = repo.create("schedules", p.org_id, new)
    repo.update("schedules", p.org_id, sid, {"status": "moved", "moved_to": doc["id"], "move_reason": (body.reason or "").strip() or None})
    audit(repo, p, "move_schedule", "schedules", sid, s["child_id"])
    return {"moved": repo.get("schedules", p.org_id, sid), "makeup": doc}


@router.post("/schedules/{sid}/unmove")
def unmove(sid: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    s = _schedule(repo, p, sid)
    if s.get("status") != "moved":
        raise HTTPException(409, "옮긴 수업이 아닙니다")
    if s.get("moved_to"):
        try:
            repo.get("attendance", p.org_id, s["moved_to"])
            raise HTTPException(409, "보강 수업에 출결이 기록되어 있습니다. 기록을 지운 뒤 되돌리세요")
        except NotFound:
            pass
        try:
            repo.delete("schedules", p.org_id, s["moved_to"])
        except NotFound:
            pass
    audit(repo, p, "unmove_schedule", "schedules", sid, s["child_id"])
    return repo.update("schedules", p.org_id, sid, {"status": "scheduled", "moved_to": None, "move_reason": None})


# ---- 장기결강 ------------------------------------------------------------------------------------------

class AbsenceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    child_id: str
    start: date
    end: date
    reason: str | None = Field(default=None, max_length=200)


@router.get("/absences")
def list_absences(child_id: str | None = None, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    return in_scope(_absences(repo, p.org_id, child_id), _scope(repo, p))


@router.post("/absences", status_code=201)
def create_absence(body: AbsenceIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child_or_404(repo, p, body.child_id)
    if body.end < body.start:
        raise HTTPException(422, "끝 날짜가 시작 날짜보다 빠릅니다")
    if (body.end - body.start).days > 366:
        raise HTTPException(422, "장기결강은 1년까지 정할 수 있습니다")
    for a in _absences(repo, p.org_id, body.child_id):
        if a["start"] <= body.end.isoformat() and body.start.isoformat() <= a["end"]:
            raise HTTPException(409, "이미 등록된 장기결강 기간과 겹칩니다")
    doc = repo.create("absences", p.org_id, {**body.model_dump(mode="json"), "reason": (body.reason or "").strip() or None})
    audit(repo, p, "create", "absences", doc["id"], body.child_id)
    return doc


@router.delete("/absences/{aid}", status_code=204)
def delete_absence(aid: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    try:
        a = repo.get("absences", p.org_id, aid)
    except NotFound:
        raise HTTPException(404, "absence not found")
    child_or_404(repo, p, a["child_id"])
    repo.delete("absences", p.org_id, aid)
    audit(repo, p, "delete", "absences", aid, a["child_id"])


# ---- 기관 휴무일 ---------------------------------------------------------------------------------------

class Holiday(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: date
    name: str = Field(default="휴무", max_length=40)


class HolidaysIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    holidays: list[Holiday] = Field(default_factory=list, max_length=200)


def org_holidays(repo, org_id: str) -> list[dict]:
    try:
        return sorted(repo.get("organizations", org_id, org_id).get("holidays") or [], key=lambda h: h["date"])
    except NotFound:
        return []


def site_holidays(repo) -> list[dict]:
    """전체 휴무일: set by a site admin, closed in every organization."""
    try:
        return sorted(repo.get("settings", PLATFORM, "holidays").get("holidays") or [], key=lambda h: h["date"])
    except NotFound:
        return []


def holidays(repo, org_id: str) -> list[dict]:
    """Every day this organization is closed: 전체 휴무일 (scope "site") and its own 기관 휴무일 (scope "org")."""
    out = {h["date"]: {**h, "scope": "org"} for h in org_holidays(repo, org_id)}
    out.update({h["date"]: {**h, "scope": "site"} for h in site_holidays(repo)})
    return sorted(out.values(), key=lambda h: h["date"])


def _rows(body: HolidaysIn) -> list[dict]:
    return sorted({h.date.isoformat(): {"date": h.date.isoformat(), "name": h.name.strip() or "휴무"} for h in body.holidays}.values(),
                  key=lambda h: h["date"])


def _drop_classes_on(repo, org_id: str, days: set[str]):
    """Classes the timetable already put on those days go away (untouched ones only; they come back if the day is removed)."""
    for d in sorted(days):
        marked = {m["schedule_id"] for m in repo.list("attendance", org_id, date=d)}
        for s in repo.list("schedules", org_id, date=d):
            if s.get("timetable_entry_id") and s.get("status") == "scheduled" and s["id"] not in marked:
                repo.delete("schedules", org_id, s["id"])


@router.get("/org/holidays")
def get_holidays(p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    return holidays(repo, p.org_id)


@router.put("/org/holidays")
def put_holidays(body: HolidaysIn, p: Principal = Depends(require_admin), repo=Depends(get_repo)):
    """This organization's own 기관 휴무일 (전체 휴무일 are the site admin's)."""
    rows = _rows(body)
    try:
        repo.get("organizations", p.org_id, p.org_id)
        repo.update("organizations", p.org_id, p.org_id, {"holidays": rows})
    except NotFound:
        repo.create("organizations", p.org_id, {"name": "", "holidays": rows}, doc_id=p.org_id)
    _drop_classes_on(repo, p.org_id, {h["date"] for h in rows})
    touch_timetable(repo, p.org_id)  # a removed 휴무일 gets its classes back
    audit(repo, p, "update", "organizations", p.org_id)
    return holidays(repo, p.org_id)


@router.get("/platform/holidays")
def get_site_holidays(admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    return site_holidays(repo)


@router.put("/platform/holidays")
def put_site_holidays(body: HolidaysIn, admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    rows = _rows(body)
    import uuid
    data = {"holidays": rows, "rev": uuid.uuid4().hex}  # every organization syncs its classes again
    try:
        repo.get("settings", PLATFORM, "holidays")
        repo.update("settings", PLATFORM, "holidays", data)
    except NotFound:
        repo.create("settings", PLATFORM, data, doc_id="holidays")
    days = {h["date"] for h in rows}
    for org in repo.list("organization_registry", PLATFORM):
        _drop_classes_on(repo, org.get("org_id") or org["id"], days)
    repo.create("audit_logs", PLATFORM, {"actor": admin.uid, "role": "site_admin", "action": "update",
                                         "collection": "settings", "doc_id": "holidays"})
    return rows
