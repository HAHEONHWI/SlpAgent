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
    openrouter_stt_model: str = ""  # an audio-input model on OpenRouter; must be verified for the account
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
    assessment_data_dir: str = ""  # item banks hold copyrighted item text: keep out of git/images; mount privately in production

    @model_validator(mode="after")
    def _no_dev_auth_in_prod(self):
        if self.env == "production" and (self.auth_mode != "firebase" or self.storage_backend == "memory"):
            raise ValueError("production requires auth_mode=firebase and a persistent storage backend")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
