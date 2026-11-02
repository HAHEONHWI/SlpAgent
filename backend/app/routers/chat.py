import base64
import io
import logging
import re
import tempfile
import zipfile
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.datastructures import UploadFile
from ..auth import Principal, current_principal
from ..config import get_settings
from ..deps import audit, child_or_404, get_repo
from ..repo.base import NotFound, now_iso
from ..services import agent, knowledge
from ..services.ai_tools import READ, WRITE, ToolRunner
from ..services.privacy import sanitize_external_text
from ..services.prompt_safety import is_privilege_override_request

router = APIRouter(prefix="/ai/dialogue", tags=["ai-dialogue"])
logger = logging.getLogger(__name__)
MAX_CHAT_FILES = 4
MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024
MAX_CHAT_TOTAL_BYTES = 20 * 1024 * 1024
MAX_CHAT_REQUEST_BYTES = MAX_CHAT_TOTAL_BYTES + 2 * 1024 * 1024
MAX_ATTACHMENT_TEXT = 80_000


class ChatIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(max_length=12_000)
    conversation_id: str | None = None
    child_id: str | None = None  # set => child-mode; fixed for the conversation
    mode: agent.DialogueMode | None = None
    allow_drafts: bool = Field(default=False, strict=True)


def get_client():
    try:
        return agent.make_client()
    except agent.ModelNotConfigured as e:
        raise HTTPException(503, str(e))


def _title(message: str) -> str:
    compact = " ".join(message.split())
    return compact[:70] + ("…" if len(compact) > 70 else "") or "새 대화"


def _message_view(message: dict) -> dict:
    return {
        "role": message["role"],
        "text": message.get("content", ""),
        "sources": message.get("sources", []),
        "attachments": message.get("attachments", []),
        "reference_status": message.get("reference_status"),
        "created_at": message.get("created_at"),
    }


def _conversation_mode(conversation) -> agent.DialogueMode:
    stored = conversation.get("mode")
    if stored is None:
        return "clinical" if conversation.get("child_id") else "knowledge"
    if stored not in {"knowledge", "clinical"}:
        raise HTTPException(409, "대화 모드를 확인할 수 없습니다. 새 대화를 시작해 주세요.")
    return stored


@router.get("/conversations")
def conversations(p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    rows = repo.list_latest("chat_conversations", p.org_id, "updated_at", 50, user_id=p.uid)
    result = []
    for row in rows:
        title = row.get("title")
        if not title:
            messages = repo.list_earliest("chat_messages", p.org_id, "created_at", 1,
                                          conversation_id=row["id"], role="user")
            first_user = messages[0] if messages else None
            title = _title(sanitize_external_text(first_user.get("content", ""))) if first_user else "새 대화"
        result.append({"id": row["id"], "title": title, "child_id": row.get("child_id"),
                       "mode": _conversation_mode(row),
                       "updated_at": row.get("updated_at"), "created_at": row.get("created_at")})
    return result


def _safe_filename(value: str, sensitive_values: list[str | None]) -> str:
    name = (value or "첨부파일").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()[:180] or "첨부파일"
    return sanitize_external_text(name, sensitive_values)


def _docx_text(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 500 or sum(entry.file_size for entry in entries) > 25 * 1024 * 1024:
                raise HTTPException(413, "압축 해제 파일이 너무 큽니다.")
            if "word/document.xml" not in archive.namelist():
                raise HTTPException(415, "DOCX 파일을 읽을 수 없습니다.")
        from docx import Document
        document = Document(io.BytesIO(data))
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(415, "유효한 DOCX 파일이 아닙니다.") from error
    content = [paragraph.text for paragraph in document.paragraphs if paragraph.text]
    content.extend(" | ".join(cell.text for cell in row.cells) for table in document.tables for row in table.rows)
    return "\n".join(content)[:MAX_ATTACHMENT_TEXT]


def _hwp_text(data: bytes, extension: str) -> str:
    if extension == ".hwpx":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries = archive.infolist()
                if len(entries) > 500 or sum(entry.file_size for entry in entries) > 25 * 1024 * 1024:
                    raise HTTPException(413, "압축 해제 파일이 너무 큽니다.")
                if not any(re.fullmatch(r"Contents/section\d+\.xml", entry.filename) for entry in entries):
                    raise HTTPException(415, "유효한 HWPX 파일이 아닙니다.")
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(415, "유효한 HWPX 파일이 아닙니다.") from error
    try:
        import syhwp
    except ImportError as error:
        raise HTTPException(503, "HWP 문서 처리 dependency를 사용할 수 없습니다.") from error
    try:
        with tempfile.NamedTemporaryFile(suffix=extension) as source:
            source.write(data)
            source.flush()
            content = syhwp.extract_markdown(source.name)
    except Exception as error:
        raise HTTPException(415, "읽을 수 있는 HWP 문서가 아닙니다.") from error
    if not content.strip():
        raise HTTPException(422, "문서에서 읽을 수 있는 텍스트를 찾지 못했습니다.")
    return content[:MAX_ATTACHMENT_TEXT]


async def _prepare_attachments(files: list[UploadFile], sensitive_values: list[str | None]) -> tuple[list[dict], list[dict]]:
    if len(files) > MAX_CHAT_FILES:
        raise HTTPException(413, f"파일은 한 번에 {MAX_CHAT_FILES}개까지 첨부할 수 있습니다.")
    total_bytes = 0
    parts, metadata = [], []
    for index, upload in enumerate(files, start=1):
        raw = await upload.read(MAX_CHAT_FILE_BYTES + 1)
        if len(raw) > MAX_CHAT_FILE_BYTES:
            raise HTTPException(413, "파일 하나는 10MB 이하여야 합니다.")
        total_bytes += len(raw)
        if total_bytes > MAX_CHAT_TOTAL_BYTES:
            raise HTTPException(413, "첨부 파일 전체 크기는 20MB 이하여야 합니다.")
        name = _safe_filename(upload.filename or "첨부파일", sensitive_values)
        extension = Path(name).suffix.lower()
        if extension == ".pdf":
            if not raw.startswith(b"%PDF-"):
                raise HTTPException(415, "유효한 PDF 파일이 아닙니다.")
            try:
                import fitz
                with fitz.open(stream=raw, filetype="pdf") as pdf:
                    if pdf.needs_pass:
                        raise HTTPException(422, "암호화된 PDF는 첨부할 수 없습니다.")
                    if pdf.page_count > 40:
                        raise HTTPException(413, "PDF는 40페이지 이하로 나누어 첨부해 주세요.")
            except HTTPException:
                raise
            except Exception as error:
                raise HTTPException(415, "PDF 파일을 열 수 없습니다.") from error
            encoded = base64.b64encode(raw).decode("ascii")
            parts.append({"type": "input_file", "filename": name,
                          "file_data": f"data:application/pdf;base64,{encoded}"})
            file_type = "PDF"
        elif extension in {".png", ".jpg", ".jpeg", ".webp"}:
            image_types = {
                ".png": ("image/png", raw.startswith(b"\x89PNG\r\n\x1a\n")),
                ".jpg": ("image/jpeg", raw.startswith(b"\xff\xd8\xff")),
                ".jpeg": ("image/jpeg", raw.startswith(b"\xff\xd8\xff")),
                ".webp": ("image/webp", len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"),
            }
            mime_type, valid_image = image_types[extension]
            if not valid_image:
                raise HTTPException(415, "이미지 파일 형식이 확장자와 일치하지 않습니다.")
            encoded = base64.b64encode(raw).decode("ascii")
            parts.append({"type": "input_image", "image_url": f"data:{mime_type};base64,{encoded}", "detail": "high"})
            file_type = "이미지"
        elif extension in {".txt", ".md", ".csv"}:
            try:
                content = raw.decode("utf-8-sig")[:MAX_ATTACHMENT_TEXT]
            except UnicodeDecodeError as error:
                raise HTTPException(415, "텍스트 파일은 UTF-8 형식이어야 합니다.") from error
            content = sanitize_external_text(content, sensitive_values)
            parts.append({"type": "input_text", "text": f"[첨부 {index}: {name}]\n{content}"})
            file_type = "텍스트"
        elif extension == ".docx":
            content = sanitize_external_text(_docx_text(raw), sensitive_values)
            parts.append({"type": "input_text", "text": f"[첨부 {index}: {name}]\n{content}"})
            file_type = "DOCX"
        elif extension in {".hwp", ".hwpx"}:
            content = sanitize_external_text(_hwp_text(raw, extension), sensitive_values)
            parts.append({"type": "input_text", "text": f"[첨부 {index}: {name}]\n{content}"})
            file_type = "HWP"
        else:
            raise HTTPException(415, "지원 형식: PDF, PNG, JPG, WEBP, TXT, MD, CSV, DOCX, HWP, HWPX")
        metadata.append({"name": name, "type": file_type})
    return parts, metadata


async def _request_body(request: Request) -> tuple[ChatIn, list[UploadFile], bool]:
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_CHAT_REQUEST_BYTES:
        raise HTTPException(413, "요청 크기는 22MB 이하여야 합니다.")
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form(max_files=MAX_CHAT_FILES, max_fields=6, max_part_size=64 * 1024)
        if set(form.keys()) - {"message", "conversation_id", "child_id", "mode", "allow_drafts", "privacy_confirmed", "files"}:
            raise HTTPException(422, "허용되지 않은 메시지 필드입니다.")
        if form.get("allow_drafts", "false") not in {"true", "false"}:
            raise HTTPException(422, "초안 생성 허용 값을 확인해 주세요.")
        files = [value for value in form.getlist("files") if isinstance(value, UploadFile)]
        try:
            body = ChatIn.model_validate({"message": str(form.get("message", "")),
                                          "conversation_id": form.get("conversation_id") or None,
                                          "child_id": form.get("child_id") or None,
                                          "mode": form.get("mode") or None,
                                          "allow_drafts": form.get("allow_drafts") == "true"})
        except ValidationError as error:
            raise HTTPException(422, "메시지 입력을 확인해 주세요.") from error
        return body, files, form.get("privacy_confirmed") == "true"
    try:
        body = ChatIn.model_validate(await request.json())
    except (ValidationError, ValueError) as error:
        raise HTTPException(422, "메시지 입력을 확인해 주세요.") from error
    return body, [], False


@router.get("/conversations/{conversation_id}")
def conversation(conversation_id: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    try:
        conv = repo.get("chat_conversations", p.org_id, conversation_id)
    except NotFound:
        raise HTTPException(404)
    if conv.get("user_id") != p.uid:
        raise HTTPException(404)
    messages = sorted(repo.list("chat_messages", p.org_id, conversation_id=conversation_id),
                      key=lambda message: message.get("created_at", ""))
    return {"id": conv["id"], "title": conv.get("title") or "새 대화", "child_id": conv.get("child_id"),
            "mode": _conversation_mode(conv),
            "messages": [_message_view(message) for message in messages]}


@router.post("")
async def chat(request: Request, p: Principal = Depends(current_principal), repo=Depends(get_repo), client=Depends(get_client)):
    body, uploads, privacy_confirmed = await _request_body(request)
    if is_privilege_override_request(body.message):
        raise HTTPException(422, "시스템 규칙 변경·공개 요청은 처리할 수 없습니다. 언어치료 질문을 입력해 주세요.")
    if not body.message.strip() and not uploads:
        raise HTTPException(422, "메시지나 첨부 파일을 입력해 주세요.")
    if uploads and not privacy_confirmed:
        raise HTTPException(422, "파일 속 아동 이름과 연락처를 가명 처리한 뒤 확인해 주세요.")
    if not body.message.strip():
        body.message = "첨부한 자료를 요약하고 언어재활 관련 핵심 내용을 알려 주세요."
    child = None
    if body.conversation_id:
        try:
            conv = repo.get("chat_conversations", p.org_id, body.conversation_id)
        except NotFound:
            raise HTTPException(404)
        if conv["user_id"] != p.uid:
            raise HTTPException(404)
        mode = _conversation_mode(conv)
        if body.mode is not None and body.mode != mode:
            raise HTTPException(422, "대화 중 모드를 바꿀 수 없습니다. 새 대화를 시작해 주세요.")
        child_id = conv.get("child_id")  # cannot be switched mid-conversation
    else:
        mode = body.mode or "knowledge"
        if mode == "knowledge" and body.child_id:
            raise HTTPException(422, "아동 기록은 임상 모드에서만 사용할 수 있습니다.")
        child_id = body.child_id
        if child_id:
            child = child_or_404(repo, p, child_id)
    if child_id and child is None:
        child = child_or_404(repo, p, child_id)
    if mode == "knowledge" and child_id:
        raise HTTPException(409, "지식 대화에 아동 기록이 연결되어 있습니다. 새 대화를 시작해 주세요.")
    if body.allow_drafts and (mode != "clinical" or not child_id):
        raise HTTPException(422, "초안 생성은 아동을 선택한 임상 모드에서만 허용할 수 있습니다.")
    if body.allow_drafts and not p.can_write:
        raise HTTPException(403, "read-only role")
    sensitive_values = [child.get("display_name"), child.get("guardian_contact")] if child_id else []
    if uploads:
        attachment_parts, attachments = await _prepare_attachments(uploads, sensitive_values)
    else:
        attachment_parts, attachments = [], []
    if not body.conversation_id:
        conv = repo.create("chat_conversations", p.org_id, {
            "user_id": p.uid, "child_id": child_id, "mode": mode,
            "title": _title(sanitize_external_text(body.message, sensitive_values)),
        })
        audit(repo, p, "create", "chat_conversations", conv["id"], child_id)
    prior = (sorted(repo.list("chat_messages", p.org_id, conversation_id=conv["id"]), key=lambda m: m["created_at"])
             if body.conversation_id else [])
    clean_message = sanitize_external_text(body.message, sensitive_values)
    history = []
    for message in prior:
        content = sanitize_external_text(message["content"], sensitive_values)
        previous_files = message.get("attachments", [])
        if previous_files:
            names = ", ".join(item["name"] for item in previous_files)
            content += f"\n[이전 첨부 원문은 현재 대화에서 다시 참조할 수 없음: {names}]"
        history.append({"role": message["role"], "content": content})
    user_content = [{"type": "input_text", "text": clean_message}, *attachment_parts] if attachment_parts else clean_message
    history.append({"role": "user", "content": user_content})
    user_message = repo.create("chat_messages", p.org_id, {"conversation_id": conv["id"], "role": "user",
                                                            "content": body.message, "attachments": attachments})
    audit(repo, p, "create", "chat_messages", user_message["id"], child_id)
    conv_patch = {"last_message_at": now_iso()}
    if not conv.get("title"):
        conv_patch["title"] = _title(clean_message)
    repo.update("chat_conversations", p.org_id, conv["id"], conv_patch)
    audit(repo, p, "update", "chat_conversations", conv["id"], child_id)

    search_status = "ok"
    try:
        matches = knowledge.search(repo, p.org_id, clean_message, k=4)
    except Exception:
        logger.exception("knowledge search failed for organization %s", p.org_id)
        search_status = "error"
        matches = []
    sources = [{"citation": f"자료 {index}", "document": match["document"], "page": match["page"],
                "test_code": match.get("test_code"), "item_ids": match.get("item_ids", [])}
               for index, match in enumerate(matches, start=1)]
    excerpts = []
    for source, match in zip(sources, matches):
        excerpt = sanitize_external_text(match["text"], sensitive_values)
        if excerpt.strip():
            excerpts.append(f"[{source['citation']}] {source['document']} p.{source['page']}\n{excerpt}")
    reference_context = "\n\n".join(excerpts)
    reference_status = "used" if reference_context else "error" if search_status == "error" else "not_found"
    allowed_tools = frozenset(READ | (WRITE if body.allow_drafts else set())) if mode == "clinical" else frozenset()
    runner = ToolRunner(repo, p, child_id, allowed_tools=allowed_tools, sensitive_values=tuple(sensitive_values))
    result = agent.run_chat(client, get_settings().openai_model, history, runner, mode=mode,
                            reference_context=reference_context,
                            allow_tools=mode == "clinical" and not bool(attachment_parts))
    result["text"] = sanitize_external_text(result["text"], sensitive_values)
    assistant_message = repo.create("chat_messages", p.org_id, {"conversation_id": conv["id"], "role": "assistant", "content": result["text"],
                                                                 "proposal_ids": result["proposals"], "sources": sources,
                                                                 "reference_status": reference_status})
    audit(repo, p, "create", "chat_messages", assistant_message["id"], child_id, via_ai=True)
    return {"conversation_id": conv["id"], "mode": mode, **result, "sources": sources, "attachments": attachments,
            "reference_status": reference_status, "reference_context_used": bool(reference_context),
            "notice": "AI 출력은 미승인 초안입니다."}
