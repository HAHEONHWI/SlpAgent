"""발달재활 서비스 제공 기록지 (HWP/HWPX) for a child and one or more months.

GET  /children/{id}/voucher-visits?month=YYYY-MM -> the visits the form would contain, for review/editing.
POST /children/{id}/voucher-hwpx                 -> one HWP/HWPX (one month) or a ZIP (multiple months).
GET  /month-sheet?month=YYYY-MM&therapist=NAME    -> one teacher's 월간 일정표 (실제 classes and 결제 일정); admins pick the teacher.
PUT  /children/{id}/pay-plan?month=YYYY-MM        -> 실제와 동일, or the 결제 날짜·시간 entered by hand.
Visits are the month's 결제 일정: 실제와 동일 (teacher opt-in) = the first 5 held 바우처 classes (not cancelled, not
absent/excused; therapy session records without a schedule are added); otherwise the entered 결제 날짜·시간.
Page-2 content comes from the therapist-approved activities section or activity names in completed therapy session records."""
import io
import re
import zipfile
from datetime import date, datetime, timedelta
from typing import Literal, assert_never
from urllib.parse import quote
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from ..auth import Principal, current_principal, require_write
from ..deps import audit, audit_change, child_or_404, get_repo, linked_therapist_name, monthly_edit_owner, my_therapist_name
from ..repo.base import NotFound, RevisionConflict, VersionedChange
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


def _content(day: str, activity_summaries: dict[str, list[str]],
             activities_by_date: dict[str, list[str]]) -> tuple[str, str]:
    summary = " ".join(dict.fromkeys(activity_summaries.get(day, [])))
    if summary:
        return summary, "activities"
    activities = activities_by_date.get(day, [])
    return (", ".join(dict.fromkeys(activities)), "activities") if activities else ("", "none")


def visits_for(repo, p: Principal, child_id: str, month: str, minutes: int) -> list[dict]:
    return month_data(repo, p, child_id, month, minutes)[0]


# Earlier accounting months were prepared under the implicit first-five rule.
EXPLICIT_PAYMENT_MONTH = "2026-11"


def _current_month() -> str:
    return datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m")


def _auto_in_month(member: dict, month: str) -> bool:
    if month < EXPLICIT_PAYMENT_MONTH:
        return True
    history = member.get("monthly_voucher_defaults") or {}
    last = max((m for m in history if m <= month), default=None)
    return last is not None and history[last] is True


def teacher_auto_for_name(repo, org_id: str, name: str, month: str) -> bool:
    if month < EXPLICIT_PAYMENT_MONTH:
        return True
    from .org import roster
    uid = next((t.get("uid") for t in roster(repo, org_id) if t.get("name") == name), None)
    if not uid:
        return False
    try:
        return _auto_in_month(repo.get("users", org_id, uid), month)
    except NotFound:
        return False


def teacher_auto_for_child(repo, org_id: str, child: dict, month: str) -> bool:
    return teacher_auto_for_name(repo, org_id, (child.get("therapist") or "").strip(), month)


class PaymentSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    same_as_actual: bool
    expected_revision: str | None


def _member_settings(repo, p: Principal):
    org = _org(repo, p.org_id)
    teacher = linked_therapist_name(org, p.uid)
    if not teacher:
        raise HTTPException(403, "치료사 목록에 연결된 본인 계정으로 설정해 주세요")
    try:
        return teacher, repo.get("users", p.org_id, p.uid), org["updated_at"]
    except NotFound:
        raise HTTPException(403, "기관 계정 연결을 확인해 주세요")


@router.get("/me/payment-settings")
def my_payment_settings(p: Principal = Depends(require_write), repo=Depends(get_repo)):
    teacher, member, _ = _member_settings(repo, p)
    return {"therapist": teacher, "same_as_actual": _auto_in_month(member, _current_month()),
            "revision": member["updated_at"]}


@router.put("/me/payment-settings")
def save_payment_settings(body: PaymentSettingsIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    teacher, member, org_revision = _member_settings(repo, p)
    month = _current_month()
    if body.expected_revision != member["updated_at"]:
        raise HTTPException(409, "설정이 변경되었습니다. 새로고침 후 다시 확인해 주세요")
    history = {**(member.get("monthly_voucher_defaults") or {}), month: body.same_as_actual}
    try:
        member = repo.save_versioned("users", p.org_id, p.uid, {"monthly_voucher_defaults": history}, body.expected_revision,
                                     also=(VersionedChange("organizations", p.org_id, org_revision),
                                           audit_change(p, "update_payment_settings", "users", p.uid)))
    except RevisionConflict:
        raise HTTPException(409, "설정이 변경되었습니다. 새로고침 후 다시 확인해 주세요")
    return {"therapist": teacher, "same_as_actual": body.same_as_actual, "revision": member["updated_at"]}


def _resolved_plan(raw: dict | None, auto: bool) -> dict:
    manual = raw is not None and raw.get("same_as_actual") is False
    return {"mode": "manual" if manual else "actual" if auto else "unset",
            "same_as_actual": auto and not manual, "slots": raw.get("slots", []) if manual else [],
            "revision": raw.get("updated_at") if raw else None}


def pay_plan(repo, org_id: str, child_id: str, month: str) -> dict:
    try:
        raw = repo.get("pay_plans", org_id, f"{child_id}_{month}")
    except NotFound:
        raw = None
    if month < EXPLICIT_PAYMENT_MONTH or (raw and raw.get("same_as_actual") is False):
        return _resolved_plan(raw, month < EXPLICIT_PAYMENT_MONTH)
    child = repo.get("children", org_id, child_id)
    return _resolved_plan(raw, teacher_auto_for_child(repo, org_id, child, month))


def pay_plans(repo, org_id: str, month: str) -> dict[str, dict]:
    from .org import roster
    saved = {d["child_id"]: d for d in repo.list("pay_plans", org_id, month=month)}
    if month < EXPLICIT_PAYMENT_MONTH:
        return {cid: _resolved_plan(raw, True) for cid, raw in saved.items()}
    members = {u["uid"]: u for u in repo.list("users", org_id)}
    auto = {t["name"] for t in roster(repo, org_id) if _auto_in_month(members.get(t.get("uid"), {}), month)}
    return {c["id"]: _resolved_plan(saved.get(c["id"]), (c.get("therapist") or "").strip() in auto)
            for c in repo.list("children", org_id)}


def plan_slots(plan: dict | None) -> list[dict] | None:
    """The entered 결제 날짜·시간 in order, or None when the month is 실제와 동일."""
    if billing.pay_days(plan) is None:
        return None
    return sorted(plan.get("slots", []), key=lambda s: (s["date"], s["start"]))


def without_chosen_other(slots: list[dict], schedules: list[dict]) -> list[dict]:
    excluded = {(s["date"], s["start"]) for s in schedules if billing.chosen_other(s)}
    return [slot for slot in slots if (slot["date"], slot["start"]) not in excluded]


def month_classes(schedules: list[dict], marks: dict[str, dict], absences: list[dict], sessions: list[dict], month: str) -> list[dict]:
    """One child's classes that happened in the month ({'id','date','start','therapist','from','extra','pay'}): not
    moved/cancelled, not 결석·사유결석, not in a 장기결강 period (unmarked ones count as held, later days as planned),
    plus therapy session records on days without such a class."""
    out = [{"id": s["id"], "date": s["date"], "start": s["start"], "therapist": s.get("therapist", ""), "extra": s.get("extra"),
            "pay": s.get("pay"), "from": "makeup" if s.get("moved_from") else "schedule"}
           for s in schedules if s["date"].startswith(month) and held(effective(s, marks.get(s["id"]), absences, today="9999-12-31"))]
    days = {c["date"] for c in out} | {s["date"] for s in schedules if billing.chosen_other(s) or s.get("cancel_reason") == "아동 종결"}
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
    slots = without_chosen_other(slots, schedules)
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
    cutoffs = {c["id"]: c["terminated_on"] for c in repo.list("children", org_id) if c.get("terminated_on")}
    return {cid: billing.assign_pay(month_classes(d["s"], marks, absences,
                       [s for s in d["t"] if s["date"] < cutoffs.get(cid, "9999")], month), plans.get(cid))
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
    cutoff = child_or_404(repo, p, child_id).get("terminated_on")
    if cutoff:
        sessions = [s for s in sessions if s["date"] < cutoff]
    plan = pay_plan(repo, p.org_id, child_id, month)
    visits = held_visits(schedules, marks, absences, sessions, month, plan)
    activities_by_date: dict[str, list[str]] = {}
    activity_summaries: dict[str, list[str]] = {}
    for record in repo.list_range("recording_records", p.org_id, "date", first, last, child_id=child_id):
        if record.get("source") != "recording_ai_approved":
            continue
        text = ((record.get("sections") or {}).get("activities") or "").strip()
        if text and not any(marker in text for marker in ("확인되지", "확인 불가", "미확인", "보고됨", "녹취", "녹음", "전사")):
            activity_summaries.setdefault(record["date"], []).append(text)
    for s in sessions:
        if s.get("status") != "completed":
            continue
        for activity in s.get("activities") or s.get("activity_accuracy") or []:
            name = activity.get("name") if isinstance(activity, dict) else None
            if isinstance(name, str) and name.strip() and UNKNOWN not in name and "녹취" not in name:
                activities_by_date.setdefault(s["date"], []).append(name.strip())
    for v in visits:
        v["end"] = _plus(v["start"], minutes)
        v["content"], v["content_source"] = _content(v["date"], activity_summaries, activities_by_date)
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
    plan = pay_plan(repo, p.org_id, child_id, month)
    return {"month": month, "minutes": minutes, "mode": plan["mode"], "same_as_actual": plan["same_as_actual"], "unit_price": billing.voucher_price(visits, *billing.voucher_prices(org)),
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
    same_as_actual: bool
    slots: list[PaySlot] = Field(default_factory=list, max_length=31)
    expected_revision: str | None = Field(default=None, max_length=128)


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
    own_name = my_therapist_name(repo, p)
    therapists = None
    if p.role == "admin":
        therapists = sorted({t["name"].strip() for t in roster(repo, p.org_id) if t.get("name", "").strip()}
                            | {(s.get("therapist") or "").strip() for s in rows} - {""})
        name = therapist if therapist is not None else (own_name or (therapists[0] if therapists else ""))
    else:
        name = own_name
    can_edit = bool(name and p.can_write and (name in (therapists or []) if p.role == "admin" else own_name == name))
    children = {c["id"]: c for c in repo.list("children", p.org_id)
                if p.role == "admin" or (own_name and (c.get("therapist") or "").strip() == own_name)}
    editable = {cid for cid, c in children.items()
                if can_edit and not c.get("archived") and not c.get("terminated_on")
                and (p.role == "admin" or (c.get("therapist") or "").strip() == own_name)}
    mine = [s for s in rows if name and (s.get("therapist") or "").strip() == name and s["child_id"] in children]
    hidden = [s for s in rows if can_edit and (s.get("therapist") or "").strip() == name and s["child_id"] not in children]
    reserved = []
    if hidden:
        marks = {m["schedule_id"]: m for m in repo.list_range("attendance", p.org_id, "date", *month_bounds(month))}
        absences = repo.list("absences", p.org_id)
        reserved = [{k: s[k] for k in ("date", "start", "end")} for s in hidden
                    if held(effective(s, marks.get(s["id"]), absences))]
    taught_kids = {s["child_id"] for s in mine}
    kids = {cid for cid, c in children.items() if name and (c.get("therapist") or "").strip() == name
            and ((not c.get("archived") and not c.get("terminated_on")) or cid in taught_kids)}
    plans = {cid: plan for cid, plan in pay_plans(repo, p.org_id, month).items() if cid in kids}
    classes = classify_month(repo, p.org_id, month, plans=plans) if mine else {}
    payments = {c["id"]: c["pay"] for rows_for_child in classes.values() for c in rows_for_child if c.get("id")}
    explicit_other = {(s["child_id"], s["date"], s["start"]) for s in rows if billing.chosen_other(s)}
    taught = {(s["child_id"], s["date"], s["start"]) for s in mine}
    out = []
    for cid in sorted(kids):
        plan = plans.get(cid) or _resolved_plan(None, month < EXPLICIT_PAYMENT_MONTH)
        slots = plan_slots(plan)
        if slots is None:
            slots = [{"date": c["date"], "start": c["start"]} for c in classes.get(cid, [])
                     if c["pay"] == "voucher" and (cid, c["date"], c["start"]) in taught]
        else:
            slots = [s for s in slots if (cid, s["date"], s["start"]) not in explicit_other]
        out.append({"child_id": cid, "mode": plan["mode"], "same_as_actual": plan["same_as_actual"], "slots": slots,
                    "can_edit": cid in editable, "revision": plan["revision"]})
    names = {cid: children[cid]["display_name"] for cid in sorted(kids | taught_kids)}
    lessons = [{**{field: s.get(field) for field in ("id", "child_id", "date", "start", "end")},
                "pay": payments.get(s["id"], s.get("pay") or ("private" if s.get("extra") == "paid" else "voucher")),
                "revision": s["updated_at"],
                "note": s.get("note") if s["child_id"] in kids else None,
                "can_edit": s["child_id"] in editable and s.get("status") == "scheduled"}
               for s in sorted(mine, key=lambda s: (s["date"], s["start"]))]
    return {"therapist": name, "therapists": therapists, "can_edit": can_edit, "names": names, "aliases": {cid: children[cid].get("alias") for cid in editable}, "reserved": reserved,
            "default_same_as_actual": teacher_auto_for_name(repo, p.org_id, name, month), "classes": lessons, "plans": out}


@router.put("/children/{child_id}/pay-plan")
def put_pay_plan(child_id: str, month: str, body: PayPlanIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    if not re.match(MONTH, month):
        raise HTTPException(422, "month must be YYYY-MM")
    teacher, guards = monthly_edit_owner(repo, p, child_id)
    slots = sorted({(s.date.isoformat(), s.start) for s in body.slots})
    if any(not d.startswith(month) for d, _ in slots):
        raise HTTPException(422, f"{month}에 다른 달 날짜가 섞여 있습니다")
    if not body.same_as_actual and not slots:
        raise HTTPException(422, "결제 날짜를 한 개 이상 입력하세요")
    if body.same_as_actual and month >= EXPLICIT_PAYMENT_MONTH:
        from .org import roster
        uid = next((t.get("uid") for t in roster(repo, p.org_id) if t.get("name") == teacher), None)
        try:
            member = repo.get("users", p.org_id, uid) if uid else {}
        except NotFound:
            member = {}
        if not _auto_in_month(member, month):
            raise HTTPException(409, "담당 치료사의 내 설정에서 실제 일정과 동일을 먼저 체크하고 저장하세요")
        guards += (VersionedChange("users", uid, member["updated_at"]),)
    doc = {"child_id": child_id, "month": month, "same_as_actual": body.same_as_actual,
           "slots": [] if body.same_as_actual else [{"date": d, "start": t} for d, t in slots]}
    pid = f"{child_id}_{month}"
    try:
        saved = repo.save_versioned("pay_plans", p.org_id, pid, doc, body.expected_revision,
                                   also=(*guards, audit_change(p, "update", "pay_plans", pid, child_id)))
    except RevisionConflict:
        raise HTTPException(409, "결제 일정이 변경되었습니다. 다시 열어 확인하세요")
    return saved
