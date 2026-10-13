import json
from types import SimpleNamespace as NS
from app.auth import Principal
from app.services import agent
from app.services.ai_tools import READ, WRITE, ToolRunner
from tests.conftest import H


class FakeClient:
    """Scripted Responses API: first turn calls tools, second turn answers."""
    def __init__(self, calls):
        self.calls, self.turn, self.seen = calls, 0, []
        self.responses = self

    def create(self, **kw):
        self.seen.append(kw)
        self.turn += 1
        if self.turn == 1:
            out = [NS(type="function_call", name=n, arguments=json.dumps(a), call_id=f"c{i}") for i, (n, a) in enumerate(self.calls)]
            return NS(output=out, output_text="")
        return NS(output=[NS(type="message")], output_text="최종 답변")


def _setup(client, child):
    client.post(f"/children/{child['id']}/assessments", headers=H(), json={
        "test_code": "SELSI", "assessed_on": "2026-09-01", "examiner": "김", "items": [{"item_id": "5", "response": 1}]})
    return client.get(f"/children/{child['id']}/assessments", headers=H()).json()[0]


def test_write_tool_creates_unapproved_draft_only(client, repo, child):
    P = Principal(uid="u1", org_id="orgA", role="therapist")
    fc = FakeClient([("generate_treatment_plan", {"goals": [{"kind": "short", "text": "t", "measure": "m", "criterion": "c", "basis": "SELSI 2026-09-01"}], "rationale": "r"})])
    res = agent.run_chat(fc, "m", [{"role": "user", "content": "계획"}],
                         ToolRunner(repo, P, child["id"], allowed_tools=frozenset(READ | WRITE)),
                         allow_tools=True, mode="clinical")
    assert res["text"] == "최종 답변" and len(res["proposals"]) == 1
    assert repo.list("treatment_plans", "orgA") == []  # nothing saved
    pid = res["proposals"][0]
    r = client.post(f"/proposals/{pid}/approve", headers=H())
    assert r.json()["applied_to"] == "treatment_plans"
    plan = repo.list("treatment_plans", "orgA")[0]
    assert plan["status"] == "draft"  # approval of the proposal still doesn't activate goals
    assert client.post(f"/proposals/{pid}/approve", headers=H()).status_code == 409
    assert any(a["via_ai"] for a in repo.list("audit_logs", "orgA"))


def test_tools_cannot_cross_child_or_org(client, repo, child):
    a = _setup(client, child)
    other = client.post("/children", json={"alias": "B", "display_name": "b", "birth_date": "2021-01-01"}, headers=H()).json()
    P = Principal(uid="u1", org_id="orgA", role="therapist")
    assert "error" in ToolRunner(repo, P, other["id"]).run("get_assessment_responses", {"assessment_id": a["id"]})
    assert "error" in ToolRunner(repo, Principal(uid="x", org_id="orgB", role="therapist"), child["id"]).run("get_child_profile", {})
    assert "error" in ToolRunner(repo, P, None).run("get_child_profile", {})  # general chat has no child data
    prof = ToolRunner(repo, P, child["id"]).run("get_child_profile", {})
    assert "테스트아동" not in json.dumps(prof, ensure_ascii=False) and "010" not in json.dumps(prof)  # PII not sent to model


def test_chat_endpoint_and_conversation_child_locked(client, repo, child, monkeypatch):
    from app.main import app
    from app.routers.chat import get_client
    fc = FakeClient([("get_child_profile", {})])
    app.dependency_overrides[get_client] = lambda: fc
    r = client.post("/ai/dialogue", headers=H(), json={"message": "테스트아동의 보호자 010-0000-0000 test@example.com 상담", "child_id": child["id"], "mode": "clinical"}).json()
    assert r["text"] == "최종 답변"
    sent = json.dumps(fc.seen[0], ensure_ascii=False, default=lambda value: vars(value))
    assert "테스트아동" not in sent and "010-0000-0000" not in sent and "test@example.com" not in sent
    assert "[개인정보]" in sent and "[이메일]" in sent
    out = [i for i in fc.seen[1]["input"] if isinstance(i, dict) and i.get("type") == "function_call_output"]
    assert json.loads(out[0]["output"])["alias"] == "A-01"
    assert client.post("/ai/dialogue", headers=H("orgB"), json={"message": "x", "conversation_id": r["conversation_id"]}).status_code == 404
    assert client.post("/ai/dialogue", headers=H("orgB"), json={"message": "x", "child_id": child["id"], "mode": "clinical"}).status_code == 404


def test_knowledge_search_cites_page_and_skips_ocr_pages(repo):
    from tests.conftest import grant_license
    grant_license(repo, "orgA", "REVT")
    repo.create("knowledge_documents", "orgA", {"source": "REVT 매뉴얼.pdf", "page": 2, "test_code": "REVT", "text": "검사 시 유의사항 대상자가 틀리게 반응했을 경우라도 격려한다", "needs_ocr": False})
    repo.create("knowledge_documents", "orgA", {"source": "스캔.pdf", "page": 1, "test_code": "REVT", "text": "", "needs_ocr": True})
    from app.services import knowledge
    r = knowledge.search(repo, "orgA", "틀리게 반응했을 때 격려")
    assert r and r[0]["document"] == "REVT 매뉴얼.pdf" and r[0]["page"] == 2
    assert knowledge.search(repo, "orgB", "격려") == []
