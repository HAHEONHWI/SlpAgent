from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..auth import Principal, current_principal, require_write
from ..deps import audit, child_or_404, get_repo, owned_or_404
from ..repo.base import NotFound

router = APIRouter(tags=["plans"])


class Goal(BaseModel):
    kind: Literal["long", "short"]
    text: str
    measure: str  # 측정 방법
    criterion: str  # 수행 기준 (예: 3회기 연속 80%)
    basis: str | None = None  # 근거 (검사명/문항/평가일)


class PlanIn(BaseModel):
    goals: list[Goal]
    rationale: str | None = None


def create_plan_version(repo, p: Principal, child_id: str, goals: list[dict], rationale, source: str, via_ai=False) -> dict:
    version = 1 + max([x["version"] for x in repo.list("treatment_plans", p.org_id, child_id=child_id)] or [0])
    plan = repo.create("treatment_plans", p.org_id, {"child_id": child_id, "version": version, "status": "draft",
                                                     "goals": [{**g, "status": "draft"} for g in goals],
                                                     "rationale": rationale, "source": source})
    audit(repo, p, "create", "treatment_plans", plan["id"], child_id, via_ai)
    return plan


@router.post("/children/{child_id}/plans", status_code=201)
def create_plan(child_id: str, body: PlanIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child_or_404(repo, p, child_id)
    return create_plan_version(repo, p, child_id, [g.model_dump() for g in body.goals], body.rationale, "therapist")


@router.get("/children/{child_id}/plans")
def list_plans(child_id: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    child_or_404(repo, p, child_id)
    return sorted(repo.list("treatment_plans", p.org_id, child_id=child_id), key=lambda x: x["version"])


@router.post("/plans/{plan_id}/approve")
def approve_plan(plan_id: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    if not p.can_approve:
        raise HTTPException(403)
    try:
        plan = repo.get("treatment_plans", p.org_id, plan_id)
    except NotFound:
        raise HTTPException(404)
    owned_or_404(repo, p, plan)
    if plan["status"] != "draft":
        raise HTTPException(409, f"plan is {plan['status']}")
    for old in repo.list("treatment_plans", p.org_id, child_id=plan["child_id"], status="active"):
        repo.update("treatment_plans", p.org_id, old["id"], {"status": "superseded"})  # preserved, not deleted
    goals = [{**g, "status": "active", "approved_by": p.uid} for g in plan["goals"]]
    out = repo.update("treatment_plans", p.org_id, plan_id, {"status": "active", "goals": goals, "approved_by": p.uid})
    audit(repo, p, "approve", "treatment_plans", plan_id, plan["child_id"])
    return out
