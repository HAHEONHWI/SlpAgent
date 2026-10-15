"""정산: per child and month, 발달재활 바우처 (유형별 본인부담금, 덜 쓴 만큼 환불) and 유료 classes.
Class counts come from 출결 (what actually happened); all amounts from services.billing."""
from fastapi import APIRouter, Depends, HTTPException, Query
from ..auth import Principal, current_principal
from ..deps import can_settle, get_repo
from ..repo.base import NotFound
from ..services import billing
from ..services.attendance_state import effective, held
from .voucher_doc import _service_minutes, month_data



def settler(p: Principal = Depends(current_principal), repo=Depends(get_repo)) -> Principal:
    """Only admins and 회계 담당 see 정산 (for every child of the organization)."""
    if not can_settle(repo, p):
        raise HTTPException(403, "정산은 기관 관리자와 회계 담당만 볼 수 있습니다")
    return p


router = APIRouter(tags=["settlement"])


@router.get("/settlement/grades")
def grades(p: Principal = Depends(settler)):
    return {"total": billing.VOUCHER_TOTAL, "day_price": billing.DAY_PRICE, "night_price": billing.NIGHT_PRICE,
            "grades": [{"grade": g, "copay": c, "support": billing.VOUCHER_TOTAL - c} for g, c in billing.VOUCHER_COPAY.items()]}


@router.get("/settlement")
def month_settlement(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), p: Principal = Depends(settler), repo=Depends(get_repo)):
    try:
        paid_price = repo.get("organizations", p.org_id, p.org_id).get("paid_price")
    except NotFound:
        paid_price = None
    minutes = _service_minutes(repo, p.org_id)
    absences = repo.list("absences", p.org_id)
    rows = []
    for c in repo.list("children", p.org_id):
        if c.get("archived"):
            continue
        visits, _ = month_data(repo, p, c["id"], month, minutes)  # held classes except 추가(유료); later days count as planned
        marks = {m["schedule_id"]: m for m in repo.list("attendance", p.org_id, child_id=c["id"])}
        paid = sum(1 for s in repo.list("schedules", p.org_id, child_id=c["id"])
                   if s.get("extra") == "paid" and s["date"].startswith(month)
                   and held(effective(s, marks.get(s["id"]), absences, today="9999-12-31")))
        grade = c.get("voucher_grade")
        if not grade and not visits and not paid:
            continue
        # a child without a 바우처 유형 pays for every class at the 유료 price
        voucher, paid = (visits, paid) if grade else ([], paid + len(visits))
        rows.append({"child_id": c["id"], **billing.settlement(grade, voucher, paid, paid_price)})
    return {"month": month, "paid_price": paid_price, "rows": rows}
