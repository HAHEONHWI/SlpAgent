"""정산: per child and month, 발달재활 바우처 (유형별 본인부담금, 덜 쓴 만큼 환불) and 유료 classes.
Class counts come from 출결 (what actually happened); all amounts from services.billing."""
from fastapi import APIRouter, Depends, HTTPException, Query
from ..auth import Principal, current_principal
from ..deps import can_settle, get_repo
from ..repo.base import NotFound
from ..services import billing
from .timetable import sync_month
from .voucher_doc import classify_month, pay_plans, plan_slots



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
    sync_month(repo, p.org_id, month)
    plans = pay_plans(repo, p.org_id, month)
    classes = classify_month(repo, p.org_id, month, plans=plans)  # one read of the month for the whole organization
    rows = []
    for c in repo.list("children", p.org_id):
        if c.get("archived") or (c.get("terminated_on") and c["terminated_on"] <= month + "-01"):
            continue
        mine = classes.get(c["id"], [])
        grade = c.get("voucher_grade")
        if not grade and not mine:
            continue
        pick = lambda pay: [x for x in mine if x["pay"] == pay]
        slots = plan_slots(plans.get(c["id"]))  # 결제 일정 entered: the claimed 바우처 sessions are its dates
        rows.append({"child_id": c["id"], "auto_private": sum(1 for x in mine if x["pay"] == "private" and x["pay_auto"]),
                     **billing.settlement(grade, pick("voucher") if slots is None else slots, pick("private"), paid_price, day_price, night_price,
                                          org.get("paid_night_price"), pick("cognitive"), pick("pending"))})
    return {"month": month, "paid_price": paid_price, "paid_night_price": org.get("paid_night_price"), "rows": rows}
