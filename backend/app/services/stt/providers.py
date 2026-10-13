"""Speech-to-text providers. Only documented endpoints and fields are used:
- Groq:       POST https://api.groq.com/openai/v1/audio/transcriptions  (multipart: file, model, language, prompt,
              response_format=verbose_json, temperature)
- OpenRouter: POST https://openrouter.ai/api/v1/audio/transcriptions    (JSON: model, input_audio{data,format},
              language, response_format, temperature, provider{zdr,data_collection}); response usage.cost in USD"""
import base64
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from pathlib import Path
import httpx

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
OPENROUTER_URL = "https://openrouter.ai/api/v1/audio/transcriptions"
# Domain vocabulary helps Whisper spell clinical terms (Groq caps the prompt at 224 tokens; OpenRouter has no prompt field).
PROMPT = "언어재활 상담. 조음, 발음, 모방, 정반응, 촉진, 표현언어, 수용언어, 어휘, 문장, 회기, 가정 연계 활동."
PRIVACY = {"zdr": True, "data_collection": "deny"}


class SttError(Exception):
    pass


class RateLimited(SttError):
    def __init__(self, retry_after: float | None, detail: str = "rate limited"):
        super().__init__(detail)
        self.retry_after = retry_after


class Unavailable(SttError):
    """Provider down, timed out, or overloaded: retry later or on the fallback."""


class Rejected(SttError):
    """The provider refused this audio (bad input): retrying the same file will not help."""


class NotConfigured(SttError):
    pass


@dataclass
class Result:
    text: str
    segments: list[dict]
    duration: float | None
    cost_usd: float = 0.0
    headers: dict = field(default_factory=dict)


def retry_after_seconds(headers: httpx.Headers) -> float | None:
    value = headers.get("retry-after")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            from datetime import datetime, timezone
            return max(0.0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError):
            return None


def _raise_for(r: httpx.Response) -> None:
    if r.status_code == 429:
        raise RateLimited(retry_after_seconds(r.headers))
    if r.status_code in (500, 502, 503, 504, 524, 529):
        raise Unavailable(f"provider status {r.status_code}")
    if r.status_code >= 400:  # never include the response body: it may echo audio-derived text
        raise Rejected(f"provider status {r.status_code}")


def _segments(data: dict) -> list[dict]:
    return [{"start": float(s.get("start", 0)), "end": float(s.get("end", 0)), "text": s.get("text", ""),
             "no_speech_prob": s.get("no_speech_prob"), "avg_logprob": s.get("avg_logprob")} for s in data.get("segments") or []]


class Groq:
    name = "groq"

    def __init__(self, api_key: str, model: str, http: httpx.Client | None = None):
        if not api_key or not model:
            raise NotConfigured("GROQ_API_KEY / STT_MODEL")
        self.api_key, self.model, self.http = api_key, model, http or httpx.Client(timeout=300)

    def transcribe(self, audio: Path) -> Result:
        try:
            with audio.open("rb") as f:
                r = self.http.post(GROQ_URL, headers={"Authorization": f"Bearer {self.api_key}"},
                                   files={"file": (audio.name, f, "audio/mpeg")},
                                   data={"model": self.model, "language": "ko", "prompt": PROMPT, "response_format": "verbose_json", "temperature": "0"})
        except (httpx.TimeoutException, httpx.TransportError) as e:
            raise Unavailable(type(e).__name__)
        _raise_for(r)
        data = r.json()
        return Result(text=(data.get("text") or "").strip(), segments=_segments(data), duration=data.get("duration"),
                      headers={k: v for k, v in r.headers.items() if k.lower().startswith("x-ratelimit")})


class OpenRouter:
    name = "openrouter"

    def __init__(self, api_key: str, model: str, http: httpx.Client | None = None):
        if not api_key or not model:
            raise NotConfigured("OPENROUTER_API_KEY / OPENROUTER_STT_MODEL")
        self.api_key, self.model, self.http = api_key, model, http or httpx.Client(timeout=300)

    def transcribe(self, audio: Path) -> Result:
        body = {"model": self.model, "input_audio": {"data": base64.b64encode(audio.read_bytes()).decode("ascii"), "format": "mp3"},
                "language": "ko", "response_format": "verbose_json", "temperature": 0, "provider": PRIVACY}
        try:
            r = self.http.post(OPENROUTER_URL, headers={"Authorization": f"Bearer {self.api_key}"}, json=body)
        except (httpx.TimeoutException, httpx.TransportError) as e:
            raise Unavailable(type(e).__name__)
        if r.status_code == 402:
            raise Unavailable("insufficient OpenRouter credits")
        _raise_for(r)
        data = r.json()
        return Result(text=(data.get("text") or "").strip(), segments=_segments(data), duration=data.get("duration"),
                      cost_usd=float((data.get("usage") or {}).get("cost") or 0.0))
