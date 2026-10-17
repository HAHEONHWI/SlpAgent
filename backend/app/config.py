from functools import lru_cache
from pathlib import Path
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parent.parent / ".env", extra="ignore")

    env: str = "development"  # development | test | production
    auth_mode: str = "firebase"  # firebase | dev (dev is rejected in production)
    storage_backend: str = "firestore"  # firestore | memory
    openai_api_key: str = ""  # from Secret Manager in production
    openai_model: str = ""  # must be set to a model the account supports
    groq_api_key: str = ""  # speech-to-text; from Secret Manager in production
    stt_model: str = ""  # e.g. whisper-large-v3-turbo; must be a model the Groq account supports
    openrouter_api_key: str = ""  # speech-to-text fallback when Groq is rate-limited or down
    openrouter_stt_model: str = ""  # OpenRouter STT model (e.g. openai/whisper-large-v3-turbo); verify for the account
    openrouter_stt_usd_per_hour: float = 0.0  # cost estimate before using the fallback (actual cost is recorded per call)
    # Long recordings
    recordings_bucket: str = ""  # private GCS bucket for originals/chunks; empty -> local directory
    local_recordings_dir: str = "/tmp/slp-agent-recordings"
    stt_max_upload_mb: int = Field(default=200, ge=1, le=2000)
    stt_tmp_limit_mb: int = Field(default=1200, ge=50, le=10000)  # working space per job (original + compressed + chunks)
    stt_max_minutes: int = Field(default=180, ge=1, le=600)
    stt_bitrate_kbps: int = Field(default=48, ge=24, le=128)
    stt_retry_bitrate_kbps: int = Field(default=64, ge=24, le=128)
    stt_overlap_seconds: float = Field(default=1.5, ge=0, le=5)
    stt_min_request_interval_seconds: float = Field(default=3.0, ge=0, le=120)
    # Groq audio quota (not exposed in response headers): seconds of audio per hour / day. 0 = not enforced locally.
    groq_audio_seconds_per_hour: int = Field(default=0, ge=0)
    groq_audio_seconds_per_day: int = Field(default=0, ge=0)
    # Queue: Cloud Tasks queue path (projects/.../locations/.../queues/...); empty -> in-process queue (dev)
    stt_tasks_queue: str = ""
    service_url: str = ""  # public Cloud Run URL: target and OIDC audience for queued steps
    stt_tasks_invoker: str = ""  # service account the queue signs requests with
    openai_embedding_model: str = ""
    openai_allow_reference_embedding_upload: bool = False
    cors_origins: str = "http://localhost:5173"
    gcs_bucket: str = ""
    local_documents_dir: str = "/tmp/slp-agent-documents"
    document_url_signing_key: str = ""
    pdf_font_path: str = ""
    hwpx_template_path: str = ""
    rate_limit_requests: int = Field(default=120, ge=1, le=10000)
    rate_limit_window_seconds: int = Field(default=60, ge=1, le=3600)
    dev_seed: bool = False
    # Development + memory storage only: load locally extracted 검사 서류 (../extracted) as AI knowledge at startup.
    # Relative paths resolve from backend/. Extracted text is copyrighted and never leaves this machine.
    local_knowledge_dir: str = ""
    local_knowledge_orgs: str = "orgA,demo"  # dev orgs that receive the pages and a license for their tests

    @model_validator(mode="after")
    def _no_dev_auth_in_prod(self):
        if self.env == "production" and (self.auth_mode != "firebase" or self.storage_backend == "memory"):
            raise ValueError("production requires auth_mode=firebase and a persistent storage backend")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
