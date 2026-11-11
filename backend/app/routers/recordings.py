"""Long recordings: create a job (with consent) -> upload the original -> queued compress/split/transcribe/merge/summary
-> therapist edits and approves the draft. The original audio is kept only while the job runs (or for the admin-set
retention period); chunks are deleted after merging."""
import uuid
from datetime import date
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from ..auth import Principal, current_principal, require_write
from ..config import get_settings
from ..deps import audit, child_or_404, get_repo
from ..repo.base import NotFound, now_iso
from ..repo.provider import get_repo as provider_repo
from ..services import billing
from ..services.stt import audio, jobs, providers, queue as stt_queue, store as stt_store

router = APIRouter(tags=["recordings"])
CONSENT_STATEMENT = "녹음 대상자(보호자·아동의 법정대리인 등)에게 녹음과 외부 음성 인식 서비스(미국) 전송에 대한 동의를 받았습니다."


def _llm():
    from ..services import agent
    try:
        return agent.make_client()
    except agent.ModelNotConfigured:
        return None


def build_deps(repo) -> jobs.Deps:
    s = get_settings()
    groq = providers.Groq(s.groq_api_key, s.stt_model) if s.groq_api_key and s.stt_model else None
    fallback = providers.OpenRouter(s.openrouter_api_key, s.openrouter_stt_model) if s.openrouter_api_key and s.openrouter_stt_model else None
    if s.stt_tasks_queue:
        q = stt_queue.CloudTasksQueue(s.stt_tasks_queue, s.service_url, s.stt_tasks_invoker)
    else:
        q = stt_queue.InlineQueue(lambda org, job, step: jobs.run_step(build_deps(provider_repo()), org, job, step))
    return jobs.Deps(repo, stt_store.get_store(), q, s, groq=groq, fallback=fallback, llm=_llm())


def get_stt_deps(repo=Depends(get_repo)) -> jobs.Deps:
    return build_deps(repo)


class RecordingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: str = Field(min_length=1, max_length=200)
    size: int = Field(gt=0)
    content_type: str = Field(default="application/octet-stream", max_length=100)
    kind: Literal["session", "consultation"] = "session"
    date: date
    start: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    end: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    counselor: str = Field(min_length=1, max_length=100)
    consent: bool

    @model_validator(mode="after")
    def _check(self):
        if not self.consent:
            raise ValueError("녹음과 외부 음성 인식 전송에 대한 동의 확인이 필요합니다")
        if (self.start is None) != (self.end is None):
            raise ValueError("start and end must both be given or both be empty")
        if self.start:
            billing.minutes_between(self.start, self.end)
        return self


def _public(job: dict) -> dict:
    keys = ("id", "child_id", "kind", "status", "meta", "filename", "upload_size", "original_size", "compressed_size", "reencoded",
            "bitrate_kbps", "duration_seconds", "chunk_count", "chunks_done", "chunks_failed", "wait_reason", "wait_until",
            "fallback_chunks", "fallback_cost_usd", "error", "draft_id", "created_at", "started_at", "finished_at")
    return {k: job.get(k) for k in keys}


def _get_job(repo, p: Principal, job_id: str) -> dict:
    try:
        job = repo.get("stt_jobs", p.org_id, job_id)
    except NotFound:
        raise HTTPException(404, "recording not found")
    child_or_404(repo, p, job["child_id"])
    return job


@router.post("/children/{child_id}/recordings", status_code=201)
def create_recording(child_id: str, body: RecordingIn, request: Request, p: Principal = Depends(require_write),
                     repo=Depends(get_repo), d: jobs.Deps = Depends(get_stt_deps)):
    child_or_404(repo, p, child_id)
    s = get_settings()
    ext = Path(body.filename).suffix.lower()
    if ext not in audio.ALLOWED_EXTENSIONS:
        raise HTTPException(415, f"지원하지 않는 형식입니다: {ext or '확장자 없음'} (m4a, mp3, wav, webm, ogg, flac 등)")
    if body.size > s.stt_max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"녹음 파일은 {s.stt_max_upload_mb}MB 이하로 올려 주세요.")
    if body.size * 2 > s.stt_tmp_limit_mb * 1024 * 1024:  # original + compressed copy must fit the working space
        raise HTTPException(413, "서버 처리 공간을 넘는 파일입니다. 녹음을 나눠서 올려 주세요.")
    job_id = uuid.uuid4().hex
    key = f"original/{job_id}{ext}"
    job = repo.create("stt_jobs", p.org_id, {
        "child_id": child_id, "kind": body.kind, "status": "uploading", "step": 0, "created_by": p.uid,
        "meta": {"date": body.date.isoformat(), "start": body.start, "end": body.end, "counselor": body.counselor,
                 "minutes": billing.minutes_between(body.start, body.end) if body.start else None},
        "consent": {"by": p.uid, "at": now_iso(), "statement": CONSENT_STATEMENT},
        "filename": body.filename, "content_type": body.content_type, "upload_size": body.size, "original_key": key,
    }, doc_id=job_id)
    audit(repo, p, "create_recording_job", "stt_jobs", job_id, child_id)
    if d.store.kind == "gcs":
        url = d.store.upload_session(key, body.content_type, body.size, request.headers.get("origin"))
        upload = {"kind": "gcs", "url": url}
    else:
        upload = {"kind": "local", "url": f"/recordings/{job_id}/upload"}
    return {"job": _public(job), "upload": upload}


@router.put("/recordings/{job_id}/upload")
async def local_upload(job_id: str, request: Request, content_range: str | None = Header(default=None),
                       p: Principal = Depends(require_write), repo=Depends(get_repo), d: jobs.Deps = Depends(get_stt_deps)):
    """Development stand-in for the resumable upload: same Content-Range protocol (308 + Range to resume)."""
    if d.store.kind != "local":
        raise HTTPException(404)
    job = _get_job(repo, p, job_id)
    if job["status"] != "uploading":
        raise HTTPException(409, "upload already finished")
    total = job["upload_size"]
    have = d.store.size(job["original_key"]) or 0
    if content_range and content_range.startswith("bytes */"):  # status query
        return Response(status_code=308, headers={"Range": f"bytes=0-{have - 1}"} if have else {})
    data = await request.body()
    offset = int(content_range.split(" ")[1].split("-")[0]) if content_range else 0
    if offset + len(data) > total:
        raise HTTPException(413, "업로드 크기가 신고한 크기보다 큽니다.")
    try:
        have = d.store.write_range(job["original_key"], offset, data)
    except ValueError:
        return Response(status_code=308, headers={"Range": f"bytes=0-{have - 1}"} if have else {})
    if have < total:
        return Response(status_code=308, headers={"Range": f"bytes=0-{have - 1}"})
    return {"received": have}


@router.post("/recordings/{job_id}/complete")
def complete_upload(job_id: str, p: Principal = Depends(require_write), repo=Depends(get_repo), d: jobs.Deps = Depends(get_stt_deps)):
    job = _get_job(repo, p, job_id)
    if job["status"] != "uploading":
        raise HTTPException(409, f"recording is {job['status']}")
    size = d.store.size(job["original_key"])
    if size != job["upload_size"]:
        raise HTTPException(409, "업로드가 끝나지 않았습니다. 다시 올려 주세요.")
    repo.update("stt_jobs", p.org_id, job_id, {"status": "queued", "queued_at": now_iso(), "original_size": size})
    jobs.schedule(d, p.org_id, job_id)
    return _public(repo.get("stt_jobs", p.org_id, job_id))


@router.get("/recordings/{job_id}")
def get_recording(job_id: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    return _public(_get_job(repo, p, job_id))


@router.get("/children/{child_id}/recordings")
def list_recordings(child_id: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    child_or_404(repo, p, child_id)
    rows = repo.list("stt_jobs", p.org_id, child_id=child_id)
    return [_public(j) for j in sorted(rows, key=lambda j: j.get("created_at", ""), reverse=True)]


@router.get("/recordings/{job_id}/transcript")
def get_transcript(job_id: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    _get_job(repo, p, job_id)
    try:
        t = repo.get("stt_transcripts", p.org_id, job_id)
    except NotFound:
        raise HTTPException(404, "transcript not ready")
    return {k: t.get(k) for k in ("text", "edited_text", "segments", "markers")}


class TranscriptEdit(BaseModel):
    text: str = Field(min_length=1, max_length=400_000)
    resummarize: bool = True


@router.put("/recordings/{job_id}/transcript")
def edit_transcript(job_id: str, body: TranscriptEdit, p: Principal = Depends(require_write), repo=Depends(get_repo),
                    d: jobs.Deps = Depends(get_stt_deps)):
    job = _get_job(repo, p, job_id)
    editable = job["status"] == "draft_ready" or (
        job["status"] == "failed" and (job.get("error") or {}).get("reason") in ("summary_failed", "no_speech", "llm_not_configured"))
    if not editable:
        raise HTTPException(409, "transcript can be edited after transcription finishes")
    try:
        repo.update("stt_transcripts", p.org_id, job_id, {"edited_text": body.text, "edited_by": p.uid, "edited_at": now_iso()})
    except NotFound:
        raise HTTPException(409, "transcript not ready")
    audit(repo, p, "edit_transcript", "stt_transcripts", job_id, job["child_id"])
    if body.resummarize:
        repo.update("stt_jobs", p.org_id, job_id, {"status": "summarizing", "error": None})
        jobs.schedule(d, p.org_id, job_id)
    return _public(repo.get("stt_jobs", p.org_id, job_id))


@router.post("/recordings/{job_id}/retry")
def retry(job_id: str, p: Principal = Depends(require_write), repo=Depends(get_repo), d: jobs.Deps = Depends(get_stt_deps)):
    """Retry only what failed: failed chunks are re-transcribed (others are kept); a failed summary is redone."""
    job = _get_job(repo, p, job_id)
    failed = [c for c in repo.list("stt_chunks", p.org_id, job_id=job_id) if c["status"] == "failed"]
    if failed and all(c.get("key") for c in failed):
        for c in failed:
            repo.update("stt_chunks", p.org_id, c["id"], {"status": "pending", "attempts": 0, "next_try_at": None, "error": None})
        repo.update("stt_jobs", p.org_id, job_id, {"status": "transcribing", "error": None, "wait_reason": None})
    elif job["status"] == "failed" and (job.get("error") or {}).get("reason") in ("summary_failed", "llm_not_configured"):
        repo.update("stt_jobs", p.org_id, job_id, {"status": "summarizing", "error": None})
    elif job["status"] == "waiting":
        repo.update("stt_jobs", p.org_id, job_id, {"status": "transcribing"})  # e.g. after enabling the fallback
    else:
        raise HTTPException(409, "nothing to retry")
    audit(repo, p, "retry_recording", "stt_jobs", job_id, job["child_id"])
    jobs.schedule(d, p.org_id, job_id)
    return _public(repo.get("stt_jobs", p.org_id, job_id))


@router.post("/recordings/{job_id}/cancel")
def cancel(job_id: str, p: Principal = Depends(require_write), repo=Depends(get_repo), d: jobs.Deps = Depends(get_stt_deps)):
    job = _get_job(repo, p, job_id)
    if job["status"] in ("draft_ready", "approved", "rejected", "cancelled"):
        raise HTTPException(409, f"recording is {job['status']}")
    repo.update("stt_jobs", p.org_id, job_id, {"status": "cancelled", "cancelled_at": now_iso()})
    jobs.cleanup_files(d, p.org_id, repo.get("stt_jobs", p.org_id, job_id))
    audit(repo, p, "cancel_recording", "stt_jobs", job_id, job["child_id"])
    return _public(repo.get("stt_jobs", p.org_id, job_id))


@router.get("/children/{child_id}/recording-records")
def recording_records(child_id: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    child_or_404(repo, p, child_id)
    rows = repo.list("recording_records", p.org_id, child_id=child_id)
    return sorted(rows, key=lambda r: (r.get("date", ""), r.get("created_at", "")), reverse=True)


@router.delete("/recording-records/{record_id}", status_code=204)
def delete_recording_record(record_id: str, p: Principal = Depends(require_write), repo=Depends(get_repo),
                            d: jobs.Deps = Depends(get_stt_deps)):
    try:
        record = repo.get("recording_records", p.org_id, record_id)
    except NotFound:
        raise HTTPException(404, "record not found")
    child_id, job_id = record.get("child_id"), record.get("job_id")
    if not child_id:
        raise HTTPException(404, "record not found")
    child_or_404(repo, p, child_id)

    if job_id and not any(r["id"] != record_id for r in repo.list("recording_records", p.org_id, job_id=job_id)):
        try:
            job = repo.get("stt_jobs", p.org_id, job_id)
        except NotFound:
            job = None
        if job and job.get("child_id") != child_id:
            raise HTTPException(404, "record not found")
        chunks = repo.list("stt_chunks", p.org_id, job_id=job_id)
        if job:
            jobs.cleanup_files(d, p.org_id, job)
            draft_ids = [job["draft_id"]] if job.get("draft_id") else []
        else:
            for chunk in chunks:
                if chunk.get("key"):
                    d.store.delete(chunk["key"])
            draft_ids = [draft["id"] for draft in repo.list("ai_analyses", p.org_id, child_id=child_id)
                         if draft.get("kind") == "recording_summary" and draft.get("result") == record_id
                         and draft.get("payload", {}).get("job_id") == job_id]
        for draft_id in draft_ids:
            try:
                draft = repo.get("ai_analyses", p.org_id, draft_id)
                if (draft.get("kind") == "recording_summary" and draft.get("child_id") == child_id
                        and draft.get("result") == record_id and draft.get("payload", {}).get("job_id") == job_id):
                    repo.delete("ai_analyses", p.org_id, draft["id"])
            except NotFound:
                pass
        try:
            repo.delete("stt_transcripts", p.org_id, job_id)
        except NotFound:
            pass
        for chunk in chunks:
            repo.delete("stt_chunks", p.org_id, chunk["id"])
        if job:
            repo.delete("stt_jobs", p.org_id, job_id)

    repo.delete("recording_records", p.org_id, record_id)
    audit(repo, p, "delete_recording_record", "recording_records", record_id, child_id)


class StepIn(BaseModel):
    org_id: str
    job_id: str
    step: int


@router.post("/internal/stt/step", include_in_schema=False)
def queued_step(body: StepIn, authorization: str | None = Header(default=None), repo=Depends(get_repo)):
    """Called only by the Cloud Tasks queue with a Google-signed OIDC token for the configured invoker account."""
    s = get_settings()
    if not s.stt_tasks_queue:
        raise HTTPException(404)
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401)
    from google.auth.transport.requests import Request as GoogleRequest
    from google.oauth2 import id_token
    try:
        claims = id_token.verify_oauth2_token(authorization[7:], GoogleRequest(), audience=s.service_url.rstrip("/"))
    except ValueError:
        raise HTTPException(401)
    if claims.get("email") != s.stt_tasks_invoker or not claims.get("email_verified"):
        raise HTTPException(403)
    jobs.run_step(build_deps(repo), body.org_id, body.job_id, body.step)
    return {"ok": True}
