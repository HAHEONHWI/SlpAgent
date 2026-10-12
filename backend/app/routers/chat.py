from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..auth import Principal, current_principal
from ..config import get_settings
from ..deps import child_or_404, get_repo
from ..repo.base import NotFound
from ..services import agent
from ..services.ai_tools import ToolRunner
from ..services.privacy import sanitize_external_text

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatIn(BaseModel):
    message: str
    conversation_id: str | None = None
    child_id: str | None = None  # set => child-mode; fixed for the conversation


def get_client():
    try:
        return agent.make_client()
    except agent.ModelNotConfigured as e:
        raise HTTPException(503, str(e))


@router.post("")
def chat(body: ChatIn, p: Principal = Depends(current_principal), repo=Depends(get_repo), client=Depends(get_client)):
    child = None
    if body.conversation_id:
        try:
            conv = repo.get("chat_conversations", p.org_id, body.conversation_id)
        except NotFound:
            raise HTTPException(404)
        if conv["user_id"] != p.uid:
            raise HTTPException(404)
        child_id = conv.get("child_id")  # cannot be switched mid-conversation
    else:
        child_id = body.child_id
        if child_id:
            child = child_or_404(repo, p, child_id)
        conv = repo.create("chat_conversations", p.org_id, {"user_id": p.uid, "child_id": child_id})
    if child_id and child is None:
        child = child_or_404(repo, p, child_id)
    sensitive_values = [child.get("display_name"), child.get("guardian_contact")] if child_id else []
    prior = sorted(repo.list("chat_messages", p.org_id, conversation_id=conv["id"]), key=lambda m: m["created_at"])
    history = [{"role": m["role"], "content": sanitize_external_text(m["content"], sensitive_values)} for m in prior]
    history.append({"role": "user", "content": sanitize_external_text(body.message, sensitive_values)})
    repo.create("chat_messages", p.org_id, {"conversation_id": conv["id"], "role": "user", "content": body.message})
    result = agent.run_chat(client, get_settings().openai_model, history, ToolRunner(repo, p, child_id))
    repo.create("chat_messages", p.org_id, {"conversation_id": conv["id"], "role": "assistant", "content": result["text"],
                                            "proposal_ids": result["proposals"]})
    return {"conversation_id": conv["id"], **result, "notice": "AI 출력은 미승인 초안입니다."}
