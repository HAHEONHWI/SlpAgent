"""수업 기록 조회: every class of a month (all children, or one child / one therapist) with what happened and the
records written for it — the session record, its approved note and the session recording record."""
import re
from fastapi import APIRouter, Depends, HTTPException
from ..auth import Principal, current_principal
from ..deps import audit, child_scope, get_repo, in_scope
from ..services.attendance_state import effective

router = APIRouter(tags=["class-records"])
UNKNOWN = "확인되지 않음"


def _recording(r: dict) -> dict:
    sec = r.get("sections") or {}
    return {"id": r["id"], "sections": {k: v for k, v in sec.items() if v and v.strip() and v.strip() != UNKNOWN}}


@router.get("/class-records")
def class_records(month: str, child_id: str | None = None, therapist: str | None = None,
                  p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    if not re.match(r"^\d{4}-(0[1-9]|1[0-2])$", month):
        raise HTTPException(422, "month must be YYYY-MM")
    from .timetable import sync_month
    sync_month(repo, p.org_id, month)
    from .attendance import month_bounds
    flt = {"child_id": child_id} if child_id else {}
    in_month = lambda col: repo.list_range(col, p.org_id, "date", *month_bounds(month), **flt)  # only this month is read
    schedules = [s for s in in_month("schedules") if s.get("status") != "cancelled"]
    marks = {m["schedule_id"]: m for m in in_month("attendance")}
    absences = repo.list("absences", p.org_id, **flt)
    sessions = in_month("therapy_sessions")
    notes = {n["session_id"]: n for s in sessions for n in repo.list("session_notes", p.org_id, session_id=s["id"])
             if n.get("status", "approved") == "approved"}
    recordings = in_month("recording_records")  # 회기·상담 녹음 기록
    consultations = in_month("parent_consultations")  # 보호자 상담 = the clinic's 수업 기록

    def records_for(cid: str, day: str) -> dict:
        sess = [s for s in sessions if s["child_id"] == cid and s["date"] == day]
        return {
            "sessions": [{"id": s["id"], "start": s.get("start"), "end": s.get("end"), "minutes": s.get("minutes"),
                          "activities": s.get("activity_accuracy") or [{"name": a.get("name")} for a in s.get("activities", [])],
                          "utterances": s.get("utterances", []), "observed_behaviors": s.get("observed_behaviors", []),
                          "note": (notes.get(s["id"]) or {}).get("text")} for s in sess],
            "recordings": [{**_recording(r), "kind": r.get("kind", "session")} for r in recordings if r["child_id"] == cid and r["date"] == day],
            "consultations": [{k: c.get(k) for k in ("id", "start", "end", "counselor", "participants", "topics", "summary", "session_summary",
                                                     "guidance_given", "follow_up", "home_activities", "parent_concerns")}
                              for c in consultations if c["child_id"] == cid and c["date"] == day],
        }

    rows, seen = [], set()
    for s in schedules:
        seen.add((s["child_id"], s["date"]))
        rows.append({"date": s["date"], "start": s["start"], "end": s["end"], "child_id": s["child_id"],
                     "therapist": s.get("therapist"), "schedule_id": s["id"], "makeup": bool(s.get("moved_from")),
                     "state": effective(s, marks.get(s["id"]), absences), **records_for(s["child_id"], s["date"])})
    for s in sessions + consultations:  # records written for a day that had no class on the schedule
        if (s["child_id"], s["date"]) not in seen:
            seen.add((s["child_id"], s["date"]))
            rows.append({"date": s["date"], "start": s.get("start"), "end": s.get("end"), "child_id": s["child_id"],
                         "therapist": s.get("therapist") or s.get("counselor"), "schedule_id": None, "makeup": False,
                         "state": {"status": "present", "auto": False, "reason": "일정 없이 기록된 수업"}, **records_for(s["child_id"], s["date"])})
    rows = in_scope(rows, child_scope(repo, p))
    if therapist:
        rows = [r for r in rows if (r.get("therapist") or "") == therapist]
    audit(repo, p, "read", "class_records", month, child_id)
    return sorted(rows, key=lambda r: (r["date"], r["start"] or "", r["child_id"]), reverse=True)
