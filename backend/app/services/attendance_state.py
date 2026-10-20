"""What actually happened to each dated class, in one place for 출결 and the 바우처 서류.

Rules: a class that was moved (보강으로 옮김) or cancelled did not happen on that date; an explicit mark wins;
a class inside the child's 장기결강 period is 사유결석; otherwise a class whose day has come counts as 출석
(nobody has to tick it); later classes are still 예정."""
from datetime import date

NOT_HELD = {"moved", "cancelled"}


def _md(iso: str) -> str:
    y, m, d = iso.split("-")
    return f"{int(m)}/{int(d)}"


def absence_for(absences: list[dict], child_id: str, day: str) -> dict | None:
    return next((a for a in absences if a["child_id"] == child_id and a["start"] <= day <= a["end"]), None)


def effective(s: dict, mark: dict | None, absences: list[dict], today: str | None = None) -> dict:
    """{'status': present|late|absent|excused|makeup|moved|cancelled|None, 'auto': bool, 'reason': str|None}"""
    today = today or date.today().isoformat()
    if s.get("status") in NOT_HELD:
        return {"status": s["status"], "auto": False, "reason": s.get("move_reason") or s.get("cancel_reason")}
    if mark:
        return {"status": mark["status"], "auto": False, "reason": mark.get("note")}
    a = absence_for(absences, s["child_id"], s["date"])
    if a:
        return {"status": "excused", "auto": True, "reason": f"장기결강 {_md(a['start'])}~{_md(a['end'])}" + (f" · {a['reason']}" if a.get("reason") else "")}
    if s["date"] <= today:
        return {"status": "present", "auto": True, "reason": None}
    return {"status": None, "auto": True, "reason": None}


def held(state: dict) -> bool:
    """Counts as a provided session (voucher): everything except moved, cancelled and absences."""
    return state["status"] not in NOT_HELD | {"absent", "excused"}


def other_notes(schedules: list[dict], marks: dict[str, dict], absences: list[dict], month: str) -> list[tuple[str, str]]:
    """The 바우처 기록지 '기타사항' lines for a child's month: (일자, 내용)."""
    by_id = {s["id"]: s for s in schedules}
    out: list[tuple[str, str, str]] = []  # (sort key, 일자, 내용)
    for s in schedules:
        if not s["date"].startswith(month):
            continue
        if s.get("status") == "moved":
            new = by_id.get(s.get("moved_to") or "")
            to = f"{_md(new['date'])} {new['start']}" if new else "다른 날"
            out.append((s["date"], _md(s["date"]), f"수업일 변경 → {to} 보강" + (f" ({s['move_reason']})" if s.get("move_reason") else "")))
        elif s.get("status") == "cancelled" and s.get("closure"):
            out.append((s["date"], _md(s["date"]), "센터 휴강" + (f" ({s['cancel_reason'].removeprefix('휴강 · ')})" if s.get("cancel_reason", "").startswith("휴강 · ") else "")))
        elif (m := marks.get(s["id"])) and m.get("status") in ("absent", "excused") \
                and not absence_for(absences, s["child_id"], s["date"]):
            out.append((s["date"], _md(s["date"]), "결강" + (f" ({m['note']})" if m.get("note") else "")))
    for a in absences:
        if a["start"][:7] <= month <= a["end"][:7]:
            out.append((a["start"], f"{_md(a['start'])}~{_md(a['end'])}", "장기결강" + (f" ({a['reason']})" if a.get("reason") else "")))
    return [(d, t) for _, d, t in sorted(out)]
