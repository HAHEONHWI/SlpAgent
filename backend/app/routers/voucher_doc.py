"""발달재활 서비스 제공 기록지 (HWPX) for a child and one or more months.

GET  /children/{id}/voucher-visits?month=YYYY-MM -> the visits the form would contain, for review/editing.
POST /children/{id}/voucher-hwpx                 -> one .hwpx (one month) or a .zip of "이름-n월.hwpx" files.
Visits come from dated schedules that were not cancelled and not marked absent/excused; therapy session records
without a schedule are added. Page-2 text is the approved session note, else the session's recording record."""
import io
import re
import zipfile
from datetime import date, datetime, timedelta
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from ..auth import Principal, current_principal, require_write
from ..deps import audit, child_or_404, get_repo
from ..repo.base import NotFound
from ..services import billing, voucher_hwpx as vh
from ..services.attendance_state import effective, held, other_notes

router = APIRouter(tags=["voucher"])
MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
UNKNOWN = "확인되지 않음"


def _plus(hhmm: str, minutes: int) -> str:
    return (datetime.strptime(hhmm, "%H:%M") + timedelta(minutes=minutes)).strftime("%H:%M")


def _org(repo, org_id: str) -> dict:
    try:
        return repo.get("organizations", org_id, org_id)
    except NotFound:
        return {}


def _service_minutes(repo, org_id: str) -> int:
    """One voucher slot = session + consultation (e.g. 40 + 10), from the weekly timetable settings."""
    try:
        cfg = repo.get("timetable_config", org_id, "default")
        return int(cfg.get("session_minutes", 40)) + int(cfg.get("break_minutes", 10))
    except NotFound:
        return 50


def _content(day: str, notes_by_date: dict[str, str], records_by_date: dict[str, dict],
             consult_by_date: dict[str, str] | None = None) -> tuple[str, str]:
    if notes_by_date.get(day):
        return notes_by_date[day], "session_note"
    if consult_by_date and consult_by_date.get(day):  # 보호자 상담 written after the class
        return consult_by_date[day], "consultation"
    rec = records_by_date.get(day)
    if rec:
        sec = rec.get("sections") or {}
        parts = [sec.get(k, "").strip() for k in ("activities", "child_responses", "spontaneous_speech")]
        text = " ".join(p for p in parts if p and p != UNKNOWN)
        if text:
            return text, "recording"
    return "", "none"


def visits_for(repo, p: Principal, child_id: str, month: str, minutes: int) -> list[dict]:
    return month_data(repo, p, child_id, month, minutes)[0]


def held_visits(schedules: list[dict], marks: dict[str, dict], absences: list[dict], sessions: list[dict], month: str) -> list[dict]:
    """The month's 바우처 visits ({'date','start','therapist','from'}): classes that happened (not moved/cancelled,
    not 결석·사유결석, not in a 장기결강 period; unmarked ones count as held, later days as planned) except
    추가(유료), plus therapy session records on days without such a class. Shared by the form and 정산."""
    voucher = [s for s in schedules if s.get("extra") != "paid" and s["date"].startswith(month)]
    paid_days = {s["date"] for s in schedules if s.get("extra") == "paid"}
    out = [{"date": s["date"], "start": s["start"], "therapist": s.get("therapist", ""), "from": "makeup" if s.get("moved_from") else "schedule"}
           for s in voucher if held(effective(s, marks.get(s["id"]), absences, today="9999-12-31"))]
    for s in sessions:  # session records without a schedule entry
        if s.get("date", "").startswith(month) and s.get("status", "completed") != "cancelled" \
                and s["date"] not in paid_days and not any(v["date"] == s["date"] for v in out):
            out.append({"date": s["date"], "start": s["start"], "therapist": s.get("therapist", ""), "from": "session"})
    return sorted(out, key=lambda v: (v["date"], v["start"]))


def month_data(repo, p: Principal, child_id: str, month: str, minutes: int) -> tuple[list[dict], list[tuple[str, str]]]:
    """(visits, 기타사항 lines) for one child. Reads only that month's records."""
    from .attendance import month_bounds
    from .timetable import sync_month
    sync_month(repo, p.org_id, month)  # classes follow the weekly timetable
    first, last = month_bounds(month)
    marks = {m["schedule_id"]: m for m in repo.list_range("attendance", p.org_id, "date", first, last, child_id=child_id)}
    absences = repo.list("absences", p.org_id, child_id=child_id)
    schedules = repo.list_range("schedules", p.org_id, "date", first, last, child_id=child_id)
    sessions = repo.list_range("therapy_sessions", p.org_id, "date", first, last, child_id=child_id)
    visits = held_visits(schedules, marks, absences, sessions, month)
    notes_by_date: dict[str, str] = {}
    for s in sessions:
        for n in repo.list("session_notes", p.org_id, session_id=s["id"]):
            if n.get("status", "approved") == "approved" and n.get("text"):
                notes_by_date[s["date"]] = n["text"]
    records_by_date = {r["date"]: r for r in repo.list_range("recording_records", p.org_id, "date", first, last, child_id=child_id)}
    consult_by_date = {c["date"]: (c.get("session_summary") or c.get("summary") or "").strip()
                       for c in repo.list_range("parent_consultations", p.org_id, "date", first, last, child_id=child_id)}
    for v in visits:
        v["end"] = _plus(v["start"], minutes)
        v["content"], v["content_source"] = _content(v["date"], notes_by_date, records_by_date, consult_by_date)
    # a class moved to another month: 기타사항 still names where it went
    voucher = [s for s in schedules if s.get("extra") != "paid"]
    have = {s["id"] for s in voucher}
    for s in list(voucher):
        if s.get("moved_to") and s["moved_to"] not in have:
            try:
                voucher.append(repo.get("schedules", p.org_id, s["moved_to"]))
            except NotFound:
                pass
    return visits, other_notes(voucher, marks, absences, month)


@router.get("/children/{child_id}/voucher-visits")
def voucher_visits(child_id: str, month: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    if not re.match(MONTH, month):
        raise HTTPException(422, "month must be YYYY-MM")
    child = child_or_404(repo, p, child_id)
    minutes = _service_minutes(repo, p.org_id)
    org = _org(repo, p.org_id)
    visits, other = month_data(repo, p, child_id, month, minutes)
    grade = child.get("voucher_grade")
    return {"month": month, "minutes": minutes, "unit_price": billing.voucher_price(visits, *billing.voucher_prices(org)),
            "copay": billing.VOUCHER_COPAY.get(grade or ""), "visits": visits,
            "other": [{"date": d, "text": t} for d, t in other]}


class VisitIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    date: date
    start: str = Field(pattern=HHMM)
    end: str = Field(pattern=HHMM)
    therapist: str = Field(default="", max_length=20)
    content: str = Field(default="", max_length=2000)


class OtherIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    date: str = Field(default="", max_length=20)
    text: str = Field(default="", max_length=300)


class MonthIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    month: str = Field(pattern=MONTH)
    visits: list[VisitIn] | None = Field(default=None, max_length=40, description="edited visits; omitted = from records")
    written_on: date | None = None
    other: list[OtherIn] | None = Field(default=None, max_length=30, description="기타사항 lines; omitted = from 출결")


class VoucherHwpxIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    months: list[MonthIn] = Field(min_length=1, max_length=12)
    unit_price: int | None = Field(default=None, ge=0)
    copay: int | None = Field(default=None, ge=0)
    phone: str | None = Field(default=None, max_length=30)


def _content_disposition(name: str) -> str:
    ascii_name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"


@router.post("/children/{child_id}/voucher-hwpx")
def voucher_hwpx(child_id: str, body: VoucherHwpxIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child = child_or_404(repo, p, child_id)
    org = _org(repo, p.org_id)
    minutes = _service_minutes(repo, p.org_id)
    grade = child.get("voucher_grade")
    copay = body.copay if body.copay is not None else billing.VOUCHER_COPAY.get(grade or "")
    birth = date.fromisoformat(child["birth_date"]) if child.get("birth_date") else None
    files: list[tuple[str, bytes]] = []
    for m in body.months:
        year, mon = int(m.month[:4]), int(m.month[5:])
        auto_rows, auto_other = month_data(repo, p, child_id, m.month, minutes)
        rows = [v.model_dump(mode="json") for v in m.visits] if m.visits is not None else auto_rows
        other = [(o.date, o.text) for o in m.other if o.text.strip()] if m.other is not None else auto_other
        visits = [vh.Visit(day=date.fromisoformat(v["date"]) if isinstance(v["date"], str) else v["date"],
                           start=v["start"], end=v["end"], therapist=v.get("therapist", ""), content=v.get("content", ""))
                  for v in rows]
        if any((v.day.year, v.day.month) != (year, mon) for v in visits):
            raise HTTPException(422, f"{m.month}에 다른 달 날짜가 섞여 있습니다")
        # 서류상 단가: entered, else 52,000 (일반) / 65,000 (야간) for a 바우처 child, else the organization's price
        price = body.unit_price if body.unit_price is not None else billing.voucher_price(rows, *billing.voucher_prices(org))
        data = vh.VoucherInput(org_name=org.get("name", ""), child_name=child["display_name"], birth_date=birth, year=year,
                               month=mon, visits=visits, written_on=m.written_on, unit_price=price, copay=copay,
                               phone=body.phone, other=other)
        try:
            content = vh.render(data)
        except vh.VoucherError as e:
            raise HTTPException(500, f"양식 처리 실패: {e}")
        files.append((vh.filename(child["display_name"], mon), content))
    names = [n for n, _ in files]
    if len(set(names)) != len(names):  # same month number in two years -> keep them apart
        files = [(n.replace(".hwpx", f"({m.month[:4]}).hwpx"), c) for (n, c), m in zip(files, body.months)]
    audit(repo, p, "export", "voucher_hwpx", ",".join(m.month for m in body.months), child_id)
    if len(files) == 1:
        name, content = files[0]
        return Response(content, media_type="application/hwp+zip", headers={"Content-Disposition": _content_disposition(name)})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files:
            z.writestr(name, content)
    span = f"{body.months[0].month[5:].lstrip('0')}-{body.months[-1].month[5:].lstrip('0')}월"
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": _content_disposition(f"{child['display_name']}-{span}.zip")})
