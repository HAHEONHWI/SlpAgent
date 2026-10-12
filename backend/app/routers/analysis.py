from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from ..auth import Principal, require_write
from ..config import get_settings
from ..deps import audit, child_or_404, get_repo
from ..services import agent, analysis
from ..services.privacy import sanitize_external_value


router = APIRouter(prefix="/children/{child_id}", tags=["analysis"])


class ActivityRequest(BaseModel):
    goal_area: str = Field(min_length=1, max_length=120)
    current_level: str = Field(min_length=1, max_length=1000)
    preferences: list[str] = Field(default_factory=list, max_length=20)
    materials: list[str] = Field(default_factory=list, max_length=30)
    time_minutes: int = Field(ge=1, le=180)
    prompting_level: str = Field(min_length=1, max_length=100)


def get_analysis_client():
    try:
        return agent.make_client()
    except agent.ModelNotConfigured as error:
        raise HTTPException(503, str(error))


def _draft(repo, principal: Principal, child_id: str, kind: str, payload: dict) -> dict:
    proposal = repo.create("ai_analyses", principal.org_id,
                           {"child_id": child_id, "kind": kind, "payload": payload, "status": "draft",
                            "created_by": principal.uid})
    audit(repo, principal, "create", "ai_analyses", proposal["id"], child_id, via_ai=True)
    return {"id": proposal["id"], "kind": kind, "status": "draft", "payload": payload,
            "notice": "AI 출력은 치료사 승인 전 미승인 초안입니다."}


def _generate(client, output_model, instruction: str, context: dict, refs: set[tuple], fields=None) -> dict:
    try:
        return analysis.generate(client, get_settings().openai_model, output_model, instruction, context, refs, fields)
    except ValueError as error:
        raise HTTPException(422, str(error))
    except RuntimeError as error:
        raise HTTPException(503, str(error))


@router.post("/analysis/integrated", status_code=201)
def integrated(child_id: str, p: Principal = Depends(require_write), repo=Depends(get_repo), client=Depends(get_analysis_client)):
    child_or_404(repo, p, child_id)
    context, refs = analysis.child_context(repo, p.org_id, child_id)
    if not context["assessments"]:
        raise HTTPException(422, "assessment records are required")
    payload = _generate(client, analysis.IntegratedAnalysis,
                        "Provide assessment overview, chronological age and test dates, strengths, support needs, shared observations, discrepancies, additional assessment needs, and candidate treatment goals.",
                        context, refs)
    return _draft(repo, p, child_id, "integrated_analysis", payload)


@router.post("/analysis/behavior", status_code=201)
def behavior_analysis(child_id: str, p: Principal = Depends(require_write), repo=Depends(get_repo), client=Depends(get_analysis_client)):
    child_or_404(repo, p, child_id)
    context, refs = analysis.child_context(repo, p.org_id, child_id)
    if not context["behavior_observations"]:
        raise HTTPException(422, "ABC observations are required")
    payload = _generate(client, analysis.BehaviorAnalysis,
                        "Describe repeated ABC patterns, tentative function hypotheses, environmental factors, missing observations, replacement communication candidates, and therapist-review strategies. Label function hypotheses tentative.",
                        context, refs)
    return _draft(repo, p, child_id, "behavior_analysis", payload)


@router.post("/activities/generate", status_code=201)
def generate_activity(child_id: str, body: ActivityRequest, p: Principal = Depends(require_write),
                      repo=Depends(get_repo), client=Depends(get_analysis_client)):
    child = child_or_404(repo, p, child_id)
    age = analysis.age_months(child["birth_date"], date.today())
    request_data = {"age_months": age, **body.model_dump(mode="json")}
    request_data = sanitize_external_value(request_data, [child.get("display_name"), child.get("guardian_contact")])
    request_fields = set(request_data)
    context = {"child_alias": child["alias"], "activity_request": request_data}
    refs = {("user_request", None, field, None) for field in request_fields}
    payload = _generate(client, analysis.ActivityPlan,
                        "Generate purpose, materials, ordered steps, modeling examples, response elicitation, difficulty adjustments, measurement method, and parent linkage. Keep requested time as supplied; do not calculate totals.",
                        context, refs, request_fields)
    payload["requested_time_minutes"] = body.time_minutes
    return _draft(repo, p, child_id, "activity_plan", payload)
