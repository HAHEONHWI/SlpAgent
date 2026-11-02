"""발달재활 서비스 제공 기록지 (HWP/HWPX) for a child and one or more months.

GET  /children/{id}/voucher-visits?month=YYYY-MM -> the visits the form would contain, for review/editing.
POST /children/{id}/voucher-hwpx                 -> one HWP/HWPX (one month) or a ZIP (multiple months).
GET  /month-sheet?month=YYYY-MM&therapist=NAME    -> one teacher's 월간 일정표 (실제 classes and 결제 일정); admins pick the teacher.
PUT  /children/{id}/pay-plan?month=YYYY-MM        -> 실제와 동일, or the 결제 날짜·시간 entered by hand.
Visits are the month's 결제 일정: 실제와 동일 (the default) = the first 5 held 바우처 classes (not cancelled, not
absent/excused; therapy session records without a schedule are added); otherwise the entered 결제 날짜·시간.
Page-2 text is the approved session note, else the session's recording record."""
import io
import re
import zipfile
from datetime import date, datetime, timedelta
from typing import Literal, assert_never
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from ..auth import Principal, current_principal, require_write
from ..deps import audit, child_or_404, get_repo, my_therapist_name
from ..repo.base import NotFound
from ..services import billing, hwp, voucher_hwpx as vh
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


def pay_plan(repo, org_id: str, child_id: str, month: str) -> dict | None:
    """The child's saved 결제 일정 for the month; None = 실제와 동일."""
    try:
        return repo.get("pay_plans", org_id, f"{child_id}_{month}")
    except NotFound:
        return None


def pay_plans(repo, org_id: str, month: str) -> dict[str, dict]:
    return {d["child_id"]: d for d in repo.list("pay_plans", org_id, month=month)}


def plan_slots(plan: dict | None) -> list[dict] | None:
    """The entered 결제 날짜·시간 in order, or None when the month is 실제와 동일."""
    if billing.pay_days(plan) is None:
        return None
    return sorted(plan.get("slots", []), key=lambda s: (s["date"], s["start"]))


def month_classes(schedules: list[dict], marks: dict[str, dict], absences: list[dict], sessions: list[dict], month: str) -> list[dict]:
    """One child's classes that happened in the month ({'id','date','start','therapist','from','extra','pay'}): not
    moved/cancelled, not 결석·사유결석, not in a 장기결강 period (unmarked ones count as held, later days as planned),
    plus therapy session records on days without such a class."""
    out = [{"id": s["id"], "date": s["date"], "start": s["start"], "therapist": s.get("therapist", ""), "extra": s.get("extra"),
            "pay": s.get("pay"), "from": "makeup" if s.get("moved_from") else "schedule"}
           for s in schedules if s["date"].startswith(month) and held(effective(s, marks.get(s["id"]), absences, today="9999-12-31"))]
    days = {c["date"] for c in out} | {s["date"] for s in schedules if billing.chosen_other(s)}
    for s in sessions:  # session records without a schedule entry
        if s.get("date", "").startswith(month) and s.get("status", "completed") != "cancelled" and s["date"] not in days:
            out.append({"id": None, "date": s["date"], "start": s["start"], "therapist": s.get("therapist", ""), "extra": None, "pay": None, "from": "session"})
            days.add(s["date"])
    return sorted(out, key=lambda v: (v["date"], v["start"]))


def held_visits(schedules: list[dict], marks: dict[str, dict], absences: list[dict], sessions: list[dict], month: str,
                plan: dict | None = None) -> list[dict]:
    """The form's visits: the entered 결제 날짜·시간 (담당 from that day's class), else the held 바우처 classes."""
    held = month_classes(schedules, marks, absences, sessions, month)
    slots = plan_slots(plan)
    if slots is None:
        return [c for c in billing.assign_pay(held, plan) if c["pay"] == "voucher"]
    by_day = {c["date"]: c for c in held}
    names = [c["therapist"] for c in held if c["therapist"]]
    usual = max(set(names), key=names.count) if names else ""
    return [{"id": None, "date": s["date"], "start": s["start"], "therapist": (by_day.get(s["date"]) or {}).get("therapist") or usual,
             "extra": None, "pay": "voucher", "pay_auto": False, "from": "pay_plan"} for s in slots]


def classify_month(repo, org_id: str, month: str, child_id: str | None = None,
                   plans: dict[str, dict] | None = None) -> dict[str, list[dict]]:
    """Every child's held classes of the month with their 결제 구분, from one read of the month."""
    from .attendance import month_bounds
    first, last = month_bounds(month)
    flt = {"child_id": child_id} if child_id else {}
    by: dict[str, dict[str, list]] = {}
    for s in repo.list_range("schedules", org_id, "date", first, last, **flt):
        by.setdefault(s["child_id"], {"s": [], "t": []})["s"].append(s)
    for s in repo.list_range("therapy_sessions", org_id, "date", first, last, **flt):
        by.setdefault(s["child_id"], {"s": [], "t": []})["t"].append(s)
    marks = {m["schedule_id"]: m for m in repo.list_range("attendance", org_id, "date", first, last, **flt)}
    absences = repo.list("absences", org_id, **flt)
    plans = pay_plans(repo, org_id, month) if plans is None else plans
    return {cid: billing.assign_pay(month_classes(d["s"], marks, absences, d["t"], month), plans.get(cid))
            for cid, d in by.items()}


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
    plan = pay_plan(repo, p.org_id, child_id, month)
    visits = held_visits(schedules, marks, absences, sessions, month, plan)
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
    # a class moved to another month: 기타사항 still names where it went. With a 결제 일정, only its dates.
    days = billing.pay_days(plan)
    voucher = [s for s in schedules if not billing.chosen_other(s) and (days is None or s["date"] in days)]
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
    return {"month": month, "minutes": minutes, "same_as_actual": plan_slots(pay_plan(repo, p.org_id, child_id, month)) is None, "unit_price": billing.voucher_price(visits, *billing.voucher_prices(org)),
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
    other: list[OtherIn] | None = Field(default=None, max_length=30, description="기타사항 lines; omitted = from 출결")


class VoucherHwpxIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    format: Literal["hwpx", "hwp"] = "hwpx"
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
                               month=mon, visits=visits, unit_price=price, copay=copay,
                               phone=body.phone, other=other)
        try:
            content = vh.render(data)
        except vh.VoucherError as e:
            raise HTTPException(500, f"양식 처리 실패: {e}")
        match body.format:
            case "hwp":
                try:
                    content = hwp.convert(content)
                except hwp.HwpConversionError as error:
                    raise HTTPException(503, str(error)) from error
                media_type = "application/x-hwp"
            case "hwpx":
                media_type = "application/hwp+zip"
            case unreachable:
                assert_never(unreachable)
        name = vh.filename(child["display_name"], mon).removesuffix(".hwpx") + f".{body.format}"
        files.append((name, content))
    names = [n for n, _ in files]
    if len(set(names)) != len(names):  # same month number in two years -> keep them apart
        files = [(n.removesuffix(f".{body.format}") + f"({m.month[:4]}).{body.format}", c)
                 for (n, c), m in zip(files, body.months)]
    audit(repo, p, "export", f"voucher_{body.format}", ",".join(m.month for m in body.months), child_id)
    if len(files) == 1:
        name, content = files[0]
        return Response(content, media_type=media_type, headers={"Content-Disposition": _content_disposition(name)})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files:
            z.writestr(name, content)
    span = f"{body.months[0].month[5:].lstrip('0')}-{body.months[-1].month[5:].lstrip('0')}월"
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": _content_disposition(f"{child['display_name']}-{span}.zip")})


class PaySlot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: date
    start: str = Field(pattern=HHMM)


class PayPlanIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    same_as_actual: bool = True
    slots: list[PaySlot] = Field(default_factory=list, max_length=31)


@router.get("/month-sheet")
def month_sheet(month: str, therapist: str | None = None, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    """월간 수업일정표 of one teacher: their classes (실제) and their children's 결제 일정 (실제와 동일 = the first 5
    held 바우처 classes, shown where that teacher teaches them). Admins pick the teacher; everyone else sees only their own."""
    if not re.match(MONTH, month):
        raise HTTPException(422, "month must be YYYY-MM")
    from .attendance import month_bounds
    from .org import roster
    from .timetable import sync_month
    sync_month(repo, p.org_id, month)
    rows = [s for s in repo.list_range("schedules", p.org_id, "date", *month_bounds(month)) if s.get("status") not in ("cancelled", "moved")]
    therapists = None
    if p.role == "admin":
        therapists = sorted({t["name"].strip() for t in roster(repo, p.org_id) if t.get("name", "").strip()}
                            | {(s.get("therapist") or "").strip() for s in rows} - {""})
        name = therapist if therapist is not None else (my_therapist_name(repo, p) or (therapists[0] if therapists else ""))
    else:
        name = my_therapist_name(repo, p)
    mine = [s for s in rows if name and (s.get("therapist") or "").strip() == name]
    kids = {s["child_id"] for s in mine}
    plans = {cid: plan for cid, plan in pay_plans(repo, p.org_id, month).items() if cid in kids}
    classes = classify_month(repo, p.org_id, month, plans=plans) if kids else {}
    taught = {(s["child_id"], s["date"], s["start"]) for s in mine}
    out = []
    for cid in sorted(kids):
        slots = plan_slots(plans.get(cid))
        if slots is None:
            slots = [{"date": c["date"], "start": c["start"]} for c in classes.get(cid, [])
                     if c["pay"] == "voucher" and (cid, c["date"], c["start"]) in taught]
        out.append({"child_id": cid, "same_as_actual": billing.pay_days(plans.get(cid)) is None, "slots": slots})
    names = {c["id"]: c["display_name"] for c in repo.list("children", p.org_id) if c["id"] in kids}
    return {"therapist": name, "therapists": therapists, "names": names,
            "classes": [{"child_id": s["child_id"], "date": s["date"], "start": s["start"]} for s in sorted(mine, key=lambda s: (s["date"], s["start"]))],
            "plans": out}


@router.put("/children/{child_id}/pay-plan")
def put_pay_plan(child_id: str, month: str, body: PayPlanIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    if not re.match(MONTH, month):
        raise HTTPException(422, "month must be YYYY-MM")
    child_or_404(repo, p, child_id)
    slots = sorted({(s.date.isoformat(), s.start) for s in body.slots})
    if any(not d.startswith(month) for d, _ in slots):
        raise HTTPException(422, f"{month}에 다른 달 날짜가 섞여 있습니다")
    doc = {"child_id": child_id, "month": month, "same_as_actual": body.same_as_actual,
           "slots": [] if body.same_as_actual else [{"date": d, "start": t} for d, t in slots]}
    pid = f"{child_id}_{month}"
    try:
        saved = repo.update("pay_plans", p.org_id, pid, doc)
    except NotFound:
        saved = repo.create("pay_plans", p.org_id, doc, doc_id=pid)
    audit(repo, p, "update", "pay_plans", pid, child_id)
    return saved
