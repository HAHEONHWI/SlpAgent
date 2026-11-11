"""All time/count/amount arithmetic lives here. AI never produces these numbers."""
from datetime import datetime, timedelta
from decimal import Decimal
from fractions import Fraction


def minutes_between(start: str, end: str) -> int:
    s, e = datetime.strptime(start, "%H:%M"), datetime.strptime(end, "%H:%M")
    m = int((e - s).total_seconds() // 60)
    if m <= 0:
        raise ValueError("end must be after start")
    return m


def recording_end(start: str | None) -> str | None:
    """Suggest a 40-minute recording interval within the record's single date."""
    if not isinstance(start, str) or len(start) != 5:
        return None
    try:
        begins = datetime.strptime(start, "%H:%M")
    except ValueError:
        return None
    ends = begins + timedelta(minutes=40)
    return ends.strftime("%H:%M") if ends.date() == begins.date() else None


def accuracy(correct: int, trials: int) -> float | None:
    if trials <= 0:
        return None
    if not 0 <= correct <= trials:
        raise ValueError("correct must be within 0..trials")
    return round(correct / trials * 100, 1)


def monthly_summary(sessions: list[dict], unit_price: int | None) -> dict:
    """sessions: therapy_sessions docs with 'date','start','end','status'. Only completed sessions count."""
    done = [s for s in sessions if s.get("status") == "completed"]
    total = sum(minutes_between(s["start"], s["end"]) for s in done)
    amount = None
    if unit_price is not None:  # per-session unit price is an org setting; never guessed
        amount = int(Decimal(unit_price) * len(done))
    return {"session_count": len(done), "total_minutes": total, "voucher_minutes": total,
            "additional_minutes": 0, "total_amount": amount,
            "amount_note": None if amount is not None else "단가 미설정: 기관 설정에서 입력 필요",
            "approval_numbers": "수기 입력 전용(AI 생성 불가)"}


ATTENDANCE_STATUSES = ("present", "late", "absent", "excused", "makeup")


def attendance_summary(marks: list[dict]) -> dict:
    """marks: attendance docs with 'status'. Excused absences are not counted against the rate; a make-up
    session counts as attended. Rate is attended / (sessions expected to be attended)."""
    counts = {s: sum(1 for m in marks if m.get("status") == s) for s in ATTENDANCE_STATUSES}
    attended = counts["present"] + counts["late"] + counts["makeup"]
    expected = attended + counts["absent"]
    return {**counts, "marked": sum(counts.values()), "attended": attended,
            "rate_pct": round(attended / expected * 100, 1) if expected else None}



# 발달재활서비스 (보건복지부 안내, 최종수정 2026-04-02). 기준이 바뀌면 여기만 고칩니다.
# 바우처 지원금 + 본인부담금 = 월 26만원은 모든 유형이 같고, 유형마다 본인부담금만 다릅니다.
VOUCHER_TOTAL = 260_000
VOUCHER_COPAY: dict[str, int] = {
    "다": 0,       # 기초생활수급자 (면제)
    "가": 20_000,  # 차상위 계층
    "나": 40_000,  # 차상위 초과 ~ 기준 중위소득 65% 이하
    "라": 60_000,  # 기준 중위소득 65% 초과 ~ 120% 이하
    "마": 80_000,  # 기준 중위소득 120% 초과 ~ 180% 이하
}
# 일반 수업은 월 5회, 야간 수업(19:00 이후 시작 또는 토요일)은 월 4회로 26만원: 서류상 회당 단가.
# 기본값이고, 기관 설정에 바우처 단가·야간 바우처 단가가 있으면 그 값을 씁니다.
DAY_SESSIONS, NIGHT_SESSIONS = 5, 4
DAY_PRICE, NIGHT_PRICE = VOUCHER_TOTAL // DAY_SESSIONS, VOUCHER_TOTAL // NIGHT_SESSIONS  # 52,000 / 65,000


def voucher_prices(org: dict) -> tuple[int, int]:
    """(일반, 야간) 회당 바우처 단가 from 기관 설정 (unit_price, night_price); unset = 52,000 / 65,000."""
    day, night = org.get("unit_price"), org.get("night_price")
    return (DAY_PRICE if day is None else day), (NIGHT_PRICE if night is None else night)


def is_night(day: str, start: str) -> bool:
    """야간 수업: 19:00 이후 시작이거나 토요일 (시간표의 회색 칸)."""
    return start >= "19:00" or datetime.strptime(day, "%Y-%m-%d").isoweekday() == 6


def voucher_price(classes: list[dict], day_price: int = DAY_PRICE, night_price: int = NIGHT_PRICE) -> int:
    """서류상 회당 단가 for a month: the 야간 price when most of its classes are 야간, else the 일반 price."""
    night = sum(1 for c in classes if is_night(c["date"], c["start"]))
    return night_price if classes and night * 2 > len(classes) else day_price


def settlement(grade: str | None, voucher_classes: list[dict], paid_classes: list[dict] | int, paid_price: int | None,
               day_price: int = DAY_PRICE, night_price: int = NIGHT_PRICE, paid_night_price: int | None = None,
               cognitive_classes: list[dict] = (), pending_classes: list[dict] = ()) -> dict:
    """One child's month. voucher_classes / paid_classes: held classes ({'date','start'}); a bare count of paid
    classes counts them all as 일반. 야간 유료 classes cost paid_night_price (unset = the 일반 유료 price).
    본인부담금 is monthly and used in proportion to the voucher spent (사용액 ÷ 월 26만원; with the default prices
    each 일반 class is 1/5 and each 야간 class 1/4); what is not used is refunded."""
    day = sum(1 for c in voucher_classes if not is_night(c["date"], c["start"]))
    night = len(voucher_classes) - day
    paid = [{"date": "2000-01-03", "start": "00:00"}] * paid_classes if isinstance(paid_classes, int) else paid_classes
    paid_sessions = len(paid)
    paid_night = sum(1 for c in paid if is_night(c["date"], c["start"]))
    pn = paid_price if paid_night_price is None else paid_night_price
    cost = lambda cs: None if paid_price is None else int(sum(Decimal(pn if is_night(c["date"], c["start"]) else paid_price) for c in cs))
    paid_amount = cost(paid)
    cognitive_amount = cost(cognitive_classes)  # 인지: same prices as 사비, counted apart
    out: dict = {"grade": grade, "day_sessions": day, "night_sessions": night, "pending_sessions": len(pending_classes), "paid_sessions": paid_sessions, "paid_night_sessions": paid_night,
                 "cognitive_sessions": len(cognitive_classes), "cognitive_amount": cognitive_amount,
                 "copay": None, "copay_charged": None, "copay_refund": None, "voucher_amount": None,
                 "support": None, "over_budget": False, "paid_amount": paid_amount}
    copay = VOUCHER_COPAY.get(grade)
    out["copay"] = copay
    if copay is not None and not pending_classes:
        amount = day * day_price + night * night_price
        used = min(Fraction(amount, VOUCHER_TOTAL), Fraction(1))
        charged = int(copay * used)
        out.update(copay=copay, copay_charged=charged, copay_refund=copay - charged, voucher_amount=amount,
                   support=min(amount, VOUCHER_TOTAL) - charged, over_budget=amount > VOUCHER_TOTAL)
    unpriced = (paid_sessions or cognitive_classes) and paid_price is None
    ungraded = bool(voucher_classes) and grade not in VOUCHER_COPAY
    out["guardian_total"] = None if unpriced or ungraded or pending_classes else (out["copay_charged"] or 0) + (paid_amount or 0) + (cognitive_amount or 0)
    return out


# ---- 결제 구분: 바우처 / 사비 / 인지 ------------------------------------------------------------------------

PAY = ("voucher", "private", "cognitive")  # 바우처, 사비(유료), 인지(인지치료: 사비 단가, 따로 집계)


def chosen_other(c: dict) -> bool:
    """사비·인지 chosen for this class (or a legacy 추가(유료) class): never counted as 바우처."""
    return c.get("pay") in ("private", "cognitive") or (c.get("pay") is None and c.get("extra") == "paid")


def pay_days(plan: dict | None) -> set[str] | None:
    """Claim dates for a resolved plan. None selects first-five, including historical defaults."""
    if plan is None or plan.get("same_as_actual", True):
        return None
    return {s["date"] for s in plan.get("slots", [])}


def assign_pay(classes: list[dict], plan: dict | None = None) -> list[dict]:
    """Give each held class of one child's month a 결제 구분 ({'pay', 'pay_auto'}).
    사비·인지 (and legacy 추가(유료)) chosen per class always win. The other classes are 바우처 or 사비 by the month's
    결제 일정 (plan): 실제와 동일 = the first 5 in date order are 바우처, later ones 사비; otherwise a class on a
    결제 날짜 is 바우처 and the rest 사비. pay_auto marks a 구분 that was not chosen as is."""
    days = pay_days(plan)
    used = 0
    out = []
    for c in sorted(classes, key=lambda c: (c["date"], c["start"])):
        if chosen_other(c):
            out.append({**c, "pay": c.get("pay") or "private", "pay_auto": False})
            continue
        if plan and plan.get("mode") == "unset":
            out.append({**c, "pay": "pending", "pay_auto": False})
            continue
        voucher = c["date"] in days if days is not None else used < DAY_SESSIONS
        used += voucher
        out.append({**c, "pay": "voucher" if voucher else "private", "pay_auto": not (voucher and c.get("pay") == "voucher")})
    return out
