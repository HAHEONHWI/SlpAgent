"""All time/count/amount arithmetic lives here. AI never produces these numbers."""
from datetime import datetime
from decimal import Decimal


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
