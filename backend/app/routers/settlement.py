"""정산: per child and month, 발달재활 바우처 (유형별 본인부담금, 덜 쓴 만큼 환불) and 유료 classes.
Class counts come from 출결 (what actually happened); all amounts from services.billing."""
from fastapi import APIRouter, Depends, HTTPException, Query
from ..auth import Principal, current_principal
from ..deps import can_settle, get_repo
from ..repo.base import NotFound
from ..services import billing
from ..services.attendance_state import effective, held
from .attendance import month_bounds
from .timetable import sync_month
from .voucher_doc import held_visits



def settler(p: Principal = Depends(current_principal), repo=Depends(get_repo)) -> Principal:
    """Only admins and 회계 담당 see 정산 (for every child of the organization)."""
    if not can_settle(repo, p):
        raise HTTPException(403, "정산은 기관 관리자와 회계 담당만 볼 수 있습니다")
    return p


router = APIRouter(tags=["settlement"])


def _org(repo, org_id: str) -> dict:
    try:
        return repo.get("organizations", org_id, org_id)
    except NotFound:
        return {}


@router.get("/settlement/grades")
def grades(p: Principal = Depends(settler), repo=Depends(get_repo)):
    day, night = billing.voucher_prices(_org(repo, p.org_id))
    return {"total": billing.VOUCHER_TOTAL, "day_price": day, "night_price": night,
            "grades": [{"grade": g, "copay": c, "support": billing.VOUCHER_TOTAL - c} for g, c in billing.VOUCHER_COPAY.items()]}


@router.get("/settlement")
def month_settlement(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), p: Principal = Depends(settler), repo=Depends(get_repo)):
    org = _org(repo, p.org_id)
    paid_price, (day_price, night_price) = org.get("paid_price"), billing.voucher_prices(org)
    # one read of the month for the whole organization, then split per child (not one pass per child)
    sync_month(repo, p.org_id, month)
    first, last = month_bounds(month)
    by_child: dict[str, dict[str, list]] = {}
    def bucket(cid: str) -> dict[str, list]:
        return by_child.setdefault(cid, {"schedules": [], "sessions": []})
    for s in repo.list_range("schedules", p.org_id, "date", first, last):
        bucket(s["child_id"])["schedules"].append(s)
    for s in repo.list_range("therapy_sessions", p.org_id, "date", first, last):
        bucket(s["child_id"])["sessions"].append(s)
    marks = {m["schedule_id"]: m for m in repo.list_range("attendance", p.org_id, "date", first, last)}
    absences = repo.list("absences", p.org_id)
    rows = []
    for c in repo.list("children", p.org_id):
        if c.get("archived"):
            continue
        data = by_child.get(c["id"], {"schedules": [], "sessions": []})
        visits = held_visits(data["schedules"], marks, absences, data["sessions"], month)  # 추가(유료) excluded
        paid = [s for s in data["schedules"] if s.get("extra") == "paid"
                and held(effective(s, marks.get(s["id"]), absences, today="9999-12-31"))]
        grade = c.get("voucher_grade")
        if not grade and not visits and not paid:
            continue
        # a child without a 바우처 유형 pays for every class at the 유료 price
        voucher, paid = (visits, paid) if grade else ([], paid + visits)
        rows.append({"child_id": c["id"], **billing.settlement(grade, voucher, paid, paid_price, day_price, night_price, org.get("paid_night_price"))})
    return {"month": month, "paid_price": paid_price, "paid_night_price": org.get("paid_night_price"), "rows": rows}
