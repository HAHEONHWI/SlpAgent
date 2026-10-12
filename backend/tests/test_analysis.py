from types import SimpleNamespace as NS
from app.main import app
from app.routers.analysis import get_analysis_client
from tests.conftest import H


class ParseClient:
    def __init__(self, payload):
        self.payload = payload
        self.responses = self
        self.calls = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return NS(output_parsed=kwargs["text_format"].model_validate(self.payload))


def test_integrated_analysis_is_evidence_checked_draft_until_approval(client, repo, child):
    client.post(f"/children/{child['id']}/assessments", headers=H(), json={
        "test_code": "SELSI", "assessed_on": "2026-09-01", "examiner": "therapist",
        "items": [{"item_id": "수용-05", "response": "관찰", "note": "테스트아동 010-0000-0000 test@example.com"}]})
    claim = {"text": "평가 기록이 있습니다", "evidence": [{"document": "SELSI", "evaluation_date": "2026-09-01"}]}
    payload = {field: [] for field in ("assessment_overview", "age_and_assessment_dates", "strengths", "support_needs",
                                       "shared_observations", "inconsistencies", "additional_assessment_needs",
                                       "candidate_treatment_goals")}
    payload["assessment_overview"] = [claim]
    fake = ParseClient(payload)
    app.dependency_overrides[get_analysis_client] = lambda: fake
    try:
        response = client.post(f"/children/{child['id']}/analysis/integrated", headers=H())
    finally:
        app.dependency_overrides.pop(get_analysis_client, None)
    assert response.status_code == 201
    proposal = response.json()
    assert proposal["status"] == "draft"
    assert repo.list("clinical_analyses", "orgA") == []
    context = fake.calls[0]["input"]
    assert "테스트아동" not in context and "010-0000-0000" not in context
    assert "test@example.com" not in context
    approved = client.post(f"/proposals/{proposal['id']}/approve", headers=H())
    assert approved.status_code == 200
    assert repo.list("clinical_analyses", "orgA")[0]["status"] == "approved"


def test_analysis_rejects_unrecognized_evidence(client, child):
    client.post(f"/children/{child['id']}/assessments", headers=H(), json={
        "test_code": "SELSI", "assessed_on": "2026-09-01", "examiner": "therapist"})
    claim = {"text": "unsupported", "evidence": [{"document": "SELSI", "evaluation_date": "2020-01-01"}]}
    payload = {field: [] for field in ("assessment_overview", "age_and_assessment_dates", "strengths", "support_needs",
                                       "shared_observations", "inconsistencies", "additional_assessment_needs",
                                       "candidate_treatment_goals")}
    payload["assessment_overview"] = [claim]
    app.dependency_overrides[get_analysis_client] = lambda: ParseClient(payload)
    try:
        response = client.post(f"/children/{child['id']}/analysis/integrated", headers=H())
    finally:
        app.dependency_overrides.pop(get_analysis_client, None)
    assert response.status_code == 422


def test_behavior_and_activity_routes_use_fake_client_and_approval(client, repo, child):
    observation = {"observed_at": "2026-10-01T10:00:00", "antecedent": "전환", "behavior": "자리에서 일어남",
                   "consequence": "휴식", "observer": "therapist"}
    assert client.post(f"/children/{child['id']}/behavior", headers=H(), json=observation).status_code == 201
    behavior_claim = {"text": "반복 관찰이 더 필요합니다", "evidence": [{"document": "ABC 관찰",
                       "evaluation_date": "2026-10-01"}]}
    behavior = {field: [] for field in ("abc_patterns", "tentative_function_hypotheses", "environmental_factors",
                                       "additional_observations_needed", "replacement_communication_candidates",
                                       "therapist_review_strategies")}
    behavior["additional_observations_needed"] = [behavior_claim]
    behavior_client = ParseClient(behavior)
    app.dependency_overrides[get_analysis_client] = lambda: behavior_client
    try:
        result = client.post(f"/children/{child['id']}/analysis/behavior", headers=H())
    finally:
        app.dependency_overrides.pop(get_analysis_client, None)
    assert result.status_code == 201 and result.json()["status"] == "draft"
    assert "tentative" in behavior_client.calls[0]["instructions"]
    approved = client.post(f"/proposals/{result.json()['id']}/approve", headers=H())
    assert approved.status_code == 200 and approved.json()["applied_to"] == "clinical_analyses"

    fields = ("goal_area", "current_level", "preferences", "materials", "time_minutes", "prompting_level", "age_months")
    activity_claims = {field: {"text": f"{field} 적용", "evidence": [{"document": "user_request",
                       "request_field": field}]} for field in fields}
    activity = {"purpose": activity_claims["goal_area"], "materials": [activity_claims["materials"]],
                "sequence": [activity_claims["current_level"]], "modeling_examples": [activity_claims["goal_area"]],
                "response_elicitation": [activity_claims["prompting_level"]],
                "difficulty_adjustments": [activity_claims["current_level"]],
                "measurement": [activity_claims["time_minutes"]], "parent_linkage": [activity_claims["preferences"]]}
    activity_client = ParseClient(activity)
    app.dependency_overrides[get_analysis_client] = lambda: activity_client
    try:
        generated = client.post(f"/children/{child['id']}/activities/generate", headers=H(), json={
        "goal_area": "요구하기", "current_level": "테스트아동 010-0000-0000 현재 수준", "preferences": ["공"], "materials": ["공"],
            "time_minutes": 20, "prompting_level": "모델링"})
    finally:
        app.dependency_overrides.pop(get_analysis_client, None)
    assert generated.status_code == 201 and generated.json()["status"] == "draft"
    assert activity_client.calls[0]["store"] is False
    assert "테스트아동" not in activity_client.calls[0]["input"]
    assert "010-0000-0000" not in activity_client.calls[0]["input"]
    assert '"time_minutes": 20' in activity_client.calls[0]["input"]
    assert generated.json()["payload"]["requested_time_minutes"] == 20
    applied = client.post(f"/proposals/{generated.json()['id']}/approve", headers=H())
    assert applied.status_code == 200 and applied.json()["applied_to"] == "therapy_activities"
