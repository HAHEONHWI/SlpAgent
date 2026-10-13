"""Upload a parent-consultation recording -> transcript (Groq Whisper) -> draft consultation record (LLM).

The result is an unapproved draft in ai_analyses; it becomes a parent_consultations record only when a
therapist approves it via /proposals/{id}/approve."""
import tempfile
from datetime import date
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from ..auth import Principal, require_write
from ..config import get_settings
from ..deps import audit, child_or_404, get_repo
from ..services import agent, billing, transcription
from ..services.privacy import sanitize_external_text

router = APIRouter(tags=["consultations"])


def get_stt_client():
    try:
        return transcription.make_stt_client()
    except transcription.SttNotConfigured as e:
        raise HTTPException(503, str(e))


def get_llm_client():
    try:
        return agent.make_client()
    except agent.ModelNotConfigured as e:
        raise HTTPException(503, str(e))


@router.post("/children/{child_id}/consultations/recording", status_code=201)
async def consultation_from_recording(
        child_id: str, file: UploadFile = File(...), consult_date: date = Form(...),
        start: str | None = Form(default=None, pattern=r"^\d{2}:\d{2}$"), end: str | None = Form(default=None, pattern=r"^\d{2}:\d{2}$"),
        counselor: str = Form(..., min_length=1, max_length=100),
        p: Principal = Depends(require_write), repo=Depends(get_repo),
        stt=Depends(get_stt_client), llm=Depends(get_llm_client)):
    child = child_or_404(repo, p, child_id)
    if (start is None) != (end is None):
        raise HTTPException(422, "start and end must both be given or both be empty")
    minutes = billing.minutes_between(start, end) if start and end else None
    ext = Path(file.filename or "").suffix.lower()
    if ext not in transcription.ALLOWED_EXTENSIONS:
        raise HTTPException(415, f"지원하지 않는 형식입니다: {ext or '확장자 없음'} (m4a, mp3, wav, webm, ogg, flac 등)")
    settings = get_settings()
    with tempfile.TemporaryDirectory(prefix="slp-rec-") as tmp:  # audio never leaves this request
        src, norm = Path(tmp) / f"in{ext}", Path(tmp) / "norm.ogg"
        size = 0
        with src.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > transcription.MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "녹음 파일은 30MB 이하로 올려 주세요.")
                out.write(chunk)
        try:
            seconds = transcription.probe_seconds(src)
            if seconds > transcription.MAX_SECONDS:
                raise HTTPException(413, "녹음은 3시간 이하만 처리할 수 있습니다.")
            transcription.normalize(src, norm)
            transcript = transcription.transcribe(stt, settings.stt_model, norm)
        except transcription.AudioError as e:
            raise HTTPException(415, str(e))
        except transcription.SttNotConfigured as e:
            raise HTTPException(503, str(e))
    if not transcript:
        raise HTTPException(422, "녹음에서 말소리를 찾지 못했습니다.")
    # The transcript keeps what was said; the copy sent to the LLM has the child's name and contacts masked.
    masked = sanitize_external_text(transcript, [child.get("display_name"), child.get("guardian_contact")])
    try:
        summary = transcription.summarize(llm, settings.openai_model, masked)
    except ValueError as e:
        raise HTTPException(502, str(e))
    payload = {"date": consult_date.isoformat(), "start": start, "end": end, "minutes": minutes, "counselor": counselor,
               **summary, "transcript": transcript, "duration_seconds": round(seconds),
               "stt_model": settings.stt_model, "llm_model": settings.openai_model}
    draft = repo.create("ai_analyses", p.org_id, {"kind": "consultation_recording", "child_id": child_id, "payload": payload,
                                                  "status": "draft", "requested_by": p.uid})
    audit(repo, p, "transcribe_consultation", "ai_analyses", draft["id"], child_id, via_ai=True)
    return {"id": draft["id"], "kind": "consultation_recording", "status": "draft", "payload": payload,
            "notice": "AI가 만든 미승인 초안입니다. 녹취록과 대조해 고친 뒤 승인하면 상담 기록으로 저장됩니다."}
