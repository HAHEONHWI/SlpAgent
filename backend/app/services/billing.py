"""All time/count/amount arithmetic lives here. AI never produces these numbers."""
from datetime import datetime
from decimal import Decimal
from fractions import Fraction


def minutes_between(start: str, end: str) -> int:
    s, e = datetime.strptime(start, "%H:%M"), datetime.strptime(end, "%H:%M")
    m = int((e - s).total_seconds() // 60)
    if m <= 0:
        raise ValueError("end must be after start")
    return m


def accuracy(correct: int, trials: int) -> float | None:
    if trials <= 0:
        return None
    if not 0 <= correct <= trials:
        raise ValueError("correct must be within 0..trials")
    return round(correct / trials * 100, 1)


def monthly_summary(sessions: list[dict], unit_price: int | None, voucher_minutes: int | None = None) -> dict:
    """sessions: therapy_sessions docs with 'date','start','end','status'. Only completed sessions count."""
    done = [s for s in sessions if s.get("status") == "completed"]
    total = sum(minutes_between(s["start"], s["end"]) for s in done)
    voucher = min(total, voucher_minutes) if voucher_minutes is not None else None
    extra = total - voucher if voucher is not None else None
    amount = None
    if unit_price is not None:  # per-session unit price is an org setting; never guessed
        amount = int(Decimal(unit_price) * len(done))
    return {"session_count": len(done), "total_minutes": total, "voucher_minutes": voucher,
            "additional_minutes": extra, "total_amount": amount,
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
               day_price: int = DAY_PRICE, night_price: int = NIGHT_PRICE, paid_night_price: int | None = None) -> dict:
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
    paid_amount = None if paid_price is None else int(Decimal(paid_price) * (paid_sessions - paid_night) + Decimal(pn) * paid_night)
    out: dict = {"grade": grade, "day_sessions": day, "night_sessions": night, "paid_sessions": paid_sessions, "paid_night_sessions": paid_night,
                 "copay": None, "copay_charged": None, "copay_refund": None, "voucher_amount": None,
                 "support": None, "over_budget": False, "paid_amount": paid_amount}
    if grade in VOUCHER_COPAY:
        copay = VOUCHER_COPAY[grade]
        amount = day * day_price + night * night_price
        used = min(Fraction(amount, VOUCHER_TOTAL), Fraction(1))
        charged = int(copay * used)
        out.update(copay=copay, copay_charged=charged, copay_refund=copay - charged, voucher_amount=amount,
                   support=min(amount, VOUCHER_TOTAL) - charged, over_budget=amount > VOUCHER_TOTAL)
    out["guardian_total"] = None if paid_sessions and paid_amount is None else (out["copay_charged"] or 0) + (paid_amount or 0)
    return out
