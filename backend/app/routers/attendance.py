"""Attendance (출결) per scheduled session: one mark per schedule, a daily roll call and monthly summaries."""
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from ..auth import Principal, current_principal, require_write
from ..deps import audit, child_or_404, get_repo
from ..repo.base import NotFound
from ..services.billing import attendance_summary

router = APIRouter(tags=["attendance"])


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


@router.get("/attendance/day")
def day(on: date, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    """Roll call: that day's scheduled sessions with their attendance mark (or null)."""
    from .timetable import sync_schedules
    sync_schedules(repo, p.org_id, on, on)  # the day's classes come from the weekly timetable
    d = on.isoformat()
    marks = {m["schedule_id"]: m for m in repo.list("attendance", p.org_id, date=d)}
    rows = [s for s in repo.list("schedules", p.org_id, date=d) if s.get("status") != "cancelled"]
    return [{"schedule_id": s["id"], "child_id": s["child_id"], "date": d, "start": s["start"], "end": s["end"],
             "therapist": s.get("therapist"), "attendance": marks.get(s["id"])}
            for s in sorted(rows, key=lambda s: s["start"])]


@router.get("/attendance/summary")
def org_summary(month: str = Query(pattern=r"^\d{4}-\d{2}$"), p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    """Per-child monthly summary for the whole organization."""
    from .timetable import sync_month
    sync_month(repo, p.org_id, month)
    marks = [m for m in repo.list("attendance", p.org_id) if m.get("date", "").startswith(month)]
    scheduled = [s for s in repo.list("schedules", p.org_id) if s.get("date", "").startswith(month) and s.get("status") != "cancelled"]
    by_child: dict[str, list[dict]] = {}
    for m in marks:
        by_child.setdefault(m["child_id"], []).append(m)
    children = {s["child_id"] for s in scheduled} | set(by_child)
    return [{"child_id": c, "scheduled": sum(1 for s in scheduled if s["child_id"] == c),
             **attendance_summary(by_child.get(c, []))} for c in sorted(children)]


@router.get("/children/{child_id}/attendance")
def child_attendance(child_id: str, month: str | None = None, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    child_or_404(repo, p, child_id)
    marks = sorted((m for m in repo.list("attendance", p.org_id, child_id=child_id)
                    if not month or m.get("date", "").startswith(month)), key=lambda m: (m["date"], m["start"]))
    return {"records": marks, "summary": attendance_summary(marks)}
