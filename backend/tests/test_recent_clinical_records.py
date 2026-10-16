import json

import pytest

from app.auth import Principal
from app.main import app
from app.routers.chat import get_client
from app.services.ai_tools import ToolRunner
from tests.conftest import H
from tests.test_ai import FakeClient


def test_recent_records_follow_clinical_dates_and_limit_results(repo, child):
    for day in range(1, 13):
        repo.create("parent_consultations", "orgA", {
            "child_id": child["id"], "date": f"2026-10-{day:02}", "summary": f"상담 {day}",
        })
    repo.create("parent_consultations", "orgA", {
        "child_id": child["id"], "date": "2020-01-01", "summary": "늦게 입력한 과거 기록",
    })
    runner = ToolRunner(repo, Principal(uid="u1", org_id="orgA", role="therapist"), child["id"])

    records = runner.run("get_recent_records", {})

    assert len(records) == 10
    assert [record["date"] for record in records] == [f"2026-10-{day:02}" for day in range(12, 2, -1)]


def test_recent_records_limit_each_source_to_the_global_result_limit(repo, child):
    limits = []
    list_latest = repo.list_latest

    def track_limit(collection, org_id, field, limit, **filters):
        limits.append(limit)
        return list_latest(collection, org_id, field, limit, **filters)

    repo.list_latest = track_limit
    runner = ToolRunner(repo, Principal(uid="u1", org_id="orgA", role="therapist"), child["id"])

    assert runner.run("get_recent_records", {}) == []
    assert limits == [10, 10, 10]


def test_recent_records_include_sessions_consultations_and_approved_recordings(repo, child):
    session = repo.create("therapy_sessions", "orgA", {
        "child_id": child["id"], "date": "2026-10-01", "status": "completed", "minutes": 40,
        "activities": [], "utterances": ["두 낱말 요청"], "observed_behaviors": [],
    })
    repo.create("session_notes", "orgA", {
        "child_id": child["id"], "session_id": session["id"], "status": "approved", "text": "승인한 회기 기록",
    })
    repo.create("session_notes", "orgA", {
        "child_id": child["id"], "session_id": session["id"], "status": "draft", "text": "미승인 회기 초안",
    })
    repo.create("parent_consultations", "orgA", {
        "child_id": child["id"], "date": "2026-10-02", "summary": "가정에서 두 낱말 사용",
        "transcript": "원문 녹취 전체",
    })
    repo.create("recording_records", "orgA", {
        "child_id": child["id"], "date": "2026-10-03", "source": "recording_ai_approved",
        "sections": {"child_responses": "자발 요청 증가"}, "transcript": "원문 녹취 전체",
    })
    repo.create("recording_records", "orgA", {
        "child_id": child["id"], "date": "2026-10-04", "status": "draft",
        "sections": {"child_responses": "미승인 녹음 초안"},
    })
    runner = ToolRunner(repo, Principal(uid="u1", org_id="orgA", role="therapist"), child["id"])

    records = runner.run("get_recent_records", {})

    assert [record["record_type"] for record in records] == ["recording", "consultation", "session"]
    text = json.dumps(records, ensure_ascii=False)
    assert all(value in text for value in ("승인한 회기 기록", "가정에서 두 낱말 사용", "자발 요청 증가"))
    assert all(value not in text for value in ("미승인 회기 초안", "미승인 녹음 초안", "원문 녹취 전체"))


def test_clinical_dialogue_reads_only_selected_child_and_redacts_records(client, repo, child):
    for org_id, child_id, summary in [
        ("orgA", child["id"], "테스트아동 010-0000-0000 contact@example.com 최근 상담"),
        ("orgA", "another-child", "다른 아동 비공개 기록"),
        ("orgB", child["id"], "다른 기관 비공개 기록"),
    ]:
        repo.create("parent_consultations", org_id, {"child_id": child_id, "date": "2026-10-12", "summary": summary})
    fake = FakeClient([("get_recent_records", {})])
    app.dependency_overrides[get_client] = lambda: fake

    response = client.post("/ai/dialogue", headers=H(), json={
        "message": "최근 기록을 정리해줘", "mode": "clinical", "child_id": child["id"],
    })

    assert response.status_code == 200
    outputs = [part for part in fake.seen[1]["input"] if isinstance(part, dict) and part.get("type") == "function_call_output"]
    text = json.dumps(outputs, ensure_ascii=False)
    assert "최근 상담" in text
    assert all(value not in text for value in ("테스트아동", "010-0000-0000", "contact@example.com", "비공개 기록"))
    assert repo.list("ai_analyses", "orgA") == []
    assert any(row["action"] == "ai_tool:get_recent_records" for row in repo.list("audit_logs", "orgA"))


def test_knowledge_dialogue_cannot_read_recent_child_records(client, repo, child):
    repo.create("parent_consultations", "orgA", {
        "child_id": child["id"], "date": "2026-10-12", "summary": "아동 기록 비공개",
    })
    fake = FakeClient([("get_recent_records", {})])
    app.dependency_overrides[get_client] = lambda: fake

    response = client.post("/ai/dialogue", headers=H(), json={"message": "최근 기록을 보여줘"})

    assert response.status_code == 200
    assert len(fake.seen) == 1
    assert fake.seen[0]["tools"] == []
    assert "아동 기록 비공개" not in json.dumps(fake.seen, ensure_ascii=False)


@pytest.mark.parametrize("headers", [H("orgB"), H(uid="unassigned-therapist")])
def test_clinical_dialogue_rejects_inaccessible_child_before_model(client, child, headers):
    fake = FakeClient([("get_recent_records", {})])
    app.dependency_overrides[get_client] = lambda: fake

    response = client.post("/ai/dialogue", headers=headers, json={
        "message": "최근 기록 요약", "mode": "clinical", "child_id": child["id"],
    })

    assert response.status_code == 404
    assert fake.seen == []


def test_recent_records_require_selected_child(repo):
    runner = ToolRunner(repo, Principal(uid="u1", org_id="orgA", role="therapist"), None)

    result = runner.run("get_recent_records", {})

    assert "아동을 선택" in result["error"]


@pytest.mark.parametrize("principal", [
    Principal(uid="u1", org_id="orgB", role="therapist"),
    Principal(uid="unassigned-therapist", org_id="orgA", role="therapist"),
])
def test_recent_tool_itself_rejects_inaccessible_child(repo, child, principal):
    repo.create("parent_consultations", "orgA", {
        "child_id": child["id"], "date": "2026-10-12", "summary": "비공개 상담",
    })
    runner = ToolRunner(repo, principal, child["id"])

    result = runner.run("get_recent_records", {})

    assert result == {"error": "not found"}


def test_saved_consultation_preserves_child_details_and_reaches_next_dialogue(client, repo, child):
    first_fake = FakeClient([("get_recent_records", {})])
    app.dependency_overrides[get_client] = lambda: first_fake
    first = client.post("/ai/dialogue", headers=H(), json={
        "message": "최근 기록 요약", "mode": "clinical", "child_id": child["id"],
    })
    assert first.status_code == 200
    details = {
        "session_summary": "두 낱말 요청 연습",
        "parent_concerns": ["테스트아동이 가정에서는 요청을 어려워함"],
        "home_activities": ["선택 질문으로 요청 기회 제공"],
    }
    saved = client.post(f"/children/{child['id']}/consultations", headers=H(), json={
        "date": "2026-10-15", "counselor": "치료사T", "summary": "보호자가 가정에서의 반응을 보고함",
        "follow_up": "다음 상담에서 가정 활동 확인", **details,
    })
    assert saved.status_code == 201
    assert {key: saved.json().get(key) for key in details} == details
    fake = FakeClient([("get_recent_records", {})])
    app.dependency_overrides[get_client] = lambda: fake

    answer = client.post("/ai/dialogue", headers=H(), json={
        "message": "방금 저장한 보호자 상담을 바탕으로 가정 활동을 알려줘",
        "mode": "clinical", "conversation_id": first.json()["conversation_id"],
    })

    assert answer.status_code == 200
    outputs = [part for part in fake.seen[1]["input"] if isinstance(part, dict) and part.get("type") == "function_call_output"]
    records = json.loads(outputs[0]["output"])
    assert len(records) == 1
    assert records[0]["id"] == saved.json()["id"]
    assert records[0]["content"]["session_summary"] == details["session_summary"]
    assert records[0]["content"]["home_activities"] == details["home_activities"]
    assert "가정에서는 요청을 어려워함" in records[0]["content"]["parent_concerns"][0]
    assert "테스트아동" not in json.dumps(outputs, ensure_ascii=False)
    assert len(repo.list("parent_consultations", "orgA", child_id=child["id"])) == 1
    assert repo.list("therapy_sessions", "orgA", child_id=child["id"]) == []


def test_approved_consultation_recording_automatically_reaches_clinical_dialogue(client, repo, child):
    draft = repo.create("ai_analyses", "orgA", {
        "child_id": child["id"], "kind": "recording_summary", "status": "draft",
        "payload": {"kind": "consultation", "job_id": "synthetic-consultation-job", "date": "2026-10-15", "sections": {
            "parent_communication": "보호자가 가정에서 두 낱말 사용을 보고함",
            "home_activities": "그림책을 보며 선택 질문 사용",
        }},
    })
    runner = ToolRunner(repo, Principal(uid="u1", org_id="orgA", role="therapist"), child["id"])
    assert runner.run("get_recent_records", {}) == []
    approved = client.post(f"/proposals/{draft['id']}/approve", headers=H())
    assert approved.status_code == 200
    fake = FakeClient([("get_recent_records", {})])
    app.dependency_overrides[get_client] = lambda: fake

    answer = client.post("/ai/dialogue", headers=H(), json={
        "message": "보호자 상담에서 확인한 가정 반응은?", "mode": "clinical", "child_id": child["id"],
    })

    assert answer.status_code == 200
    outputs = [part for part in fake.seen[1]["input"] if isinstance(part, dict) and part.get("type") == "function_call_output"]
    records = json.loads(outputs[0]["output"])
    assert len(records) == 1
    assert records[0]["record_type"] == "recording"
    assert records[0]["content"]["kind"] == "consultation"
    assert records[0]["content"]["sections"]["home_activities"] == "그림책을 보며 선택 질문 사용"
    assert client.post(f"/proposals/{draft['id']}/approve", headers=H()).status_code == 409
    assert len(repo.list("recording_records", "orgA", child_id=child["id"])) == 1


def test_clinical_consultation_is_provided_when_model_only_requests_observations(client, repo, child):
    repo.create("recording_records", "orgA", {
        "child_id": child["id"], "date": "2026-10-14", "kind": "consultation",
        "source": "recording_ai_approved", "sections": {
            "parent_communication": "테스트아동이 가정에서 두 낱말을 사용했다는 보호자 보고",
        },
    })
    fake = FakeClient([("get_child_profile", {}), ("get_behavior_observations", {})])
    app.dependency_overrides[get_client] = lambda: fake

    response = client.post("/ai/dialogue", headers=H(), json={
        "message": "관찰 기록을 바탕으로 초기 임상 의견 초안을 작성해줘",
        "mode": "clinical", "child_id": child["id"],
    })

    assert response.status_code == 200
    context = next(json.loads(part["content"]) for part in fake.seen[0]["input"]
                   if isinstance(part, dict) and part.get("role") == "user"
                   and isinstance(part.get("content"), str) and part["content"].startswith('{"kind"'))
    assert context["kind"] == "untrusted_clinical_records"
    assert context["records"][0]["content"]["kind"] == "consultation"
    assert "보호자 보고" in json.dumps(context, ensure_ascii=False)
    assert "테스트아동" not in json.dumps(fake.seen, ensure_ascii=False, default=vars)
    assert "가정에서 두 낱말을 사용했다는 보호자 보고" not in fake.seen[0]["instructions"]
    assert any(row["action"] == "ai_tool:get_recent_records" for row in repo.list("audit_logs", "orgA"))


def test_clinical_attachment_does_not_auto_read_child_records(client, repo, child):
    repo.create("recording_records", "orgA", {
        "child_id": child["id"], "date": "2026-10-14", "kind": "consultation",
        "sections": {"parent_communication": "PRIVATE_CONSULTATION_MARKER"},
    })
    fake = FakeClient([])
    app.dependency_overrides[get_client] = lambda: fake

    response = client.post("/ai/dialogue", headers=H(), data={
        "message": "첨부 내용 설명", "mode": "clinical", "child_id": child["id"], "privacy_confirmed": "true",
    }, files={"files": ("synthetic.txt", b"synthetic text", "text/plain")})

    assert response.status_code == 200
    assert fake.seen[0]["tools"] == []
    assert "PRIVATE_CONSULTATION_MARKER" not in json.dumps(fake.seen, ensure_ascii=False, default=vars)
    assert not any(row["action"] == "ai_tool:get_recent_records" for row in repo.list("audit_logs", "orgA"))
