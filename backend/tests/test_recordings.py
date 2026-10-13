import io, json, math, shutil, struct, wave
from types import SimpleNamespace as NS
import pytest
from app.main import app
from app.routers.recordings import get_llm_client, get_stt_client
from app.services import transcription
from tests.conftest import H

needs_ffmpeg = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg not installed")


def _wav(seconds=2.0) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"".join(struct.pack("<h", int(3000 * math.sin(2 * math.pi * 440 * i / 16000))) for i in range(int(16000 * seconds))))
    return buf.getvalue()


class FakeStt:
    def __init__(self, text):
        self.text, self.calls = text, []
        self.audio = NS(transcriptions=self)

    def create(self, **kw):
        self.calls.append(kw)
        return NS(text=self.text)


class FakeLlm:
    def __init__(self):
        self.calls = []
        self.responses = self

    def parse(self, **kw):
        self.calls.append(kw)
        return NS(output_parsed=kw["text_format"](summary="가정에서 2음절 모방 연습을 안내함", session_summary="오늘 2음절 모방 4/5",
                  topics=["가정 연계"], parent_concerns=["발음이 느는지"], guidance_given="그림책으로 하루 5분",
                  home_activities=["그림책 읽기"], follow_up="다음 회기 확인", participants=["어머니", "치료사"]))


@pytest.fixture
def fakes():
    stt, llm = FakeStt("테스트아동 어머니: 집에서 발음 연습을 어떻게 하나요? 연락처는 010-1234-5678 입니다."), FakeLlm()
    app.dependency_overrides[get_stt_client] = lambda: stt
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield stt, llm
    app.dependency_overrides.pop(get_stt_client, None)
    app.dependency_overrides.pop(get_llm_client, None)


def _upload(client, child, data=None, name="상담.wav", headers=None, **form):
    fields = {"consult_date": "2026-10-13", "counselor": "김재활", **form}
    return client.post(f"/children/{child['id']}/consultations/recording", headers=headers or H(),
                       files={"file": (name, data if data is not None else _wav(), "audio/wav")}, data=fields)


@needs_ffmpeg
def test_recording_becomes_draft_then_consultation_on_approval(client, repo, child, fakes):
    stt, llm = fakes
    r = _upload(client, child, start="16:00", end="16:20")
    assert r.status_code == 201, r.text
    draft = r.json()
    assert draft["status"] == "draft" and draft["payload"]["minutes"] == 20 and draft["payload"]["duration_seconds"] == 2
    assert stt.calls[0]["language"] == "ko"
    sent = json.loads(llm.calls[0]["input"])["transcript"]
    assert "테스트아동" not in sent and "010-1234-5678" not in sent  # masked before the LLM
    assert "테스트아동" in draft["payload"]["transcript"]  # the stored transcript keeps what was said
    assert repo.list("parent_consultations", "orgA") == []  # nothing saved until approval
    done = client.post(f"/proposals/{draft['id']}/approve", headers=H())
    assert done.json()["applied_to"] == "parent_consultations"
    rec = client.get(f"/children/{child['id']}/consultations", headers=H()).json()[0]
    assert rec["summary"].startswith("가정에서") and rec["home_activities"] == ["그림책 읽기"] and rec["source"] == "recording_ai_approved"


@needs_ffmpeg
def test_non_audio_is_rejected(client, child, fakes):
    assert _upload(client, child, data=b"not audio at all", name="x.m4a").status_code == 415


def test_recording_validation_and_permissions(client, child, fakes, monkeypatch):
    assert _upload(client, child, name="memo.txt").status_code == 415
    monkeypatch.setattr(transcription, "MAX_UPLOAD_BYTES", 100)
    assert _upload(client, child, data=b"x" * 101).status_code == 413
    monkeypatch.undo()
    assert _upload(client, child, start="10:00").status_code == 422
    assert _upload(client, child, headers=H(role="assistant")).status_code == 403
    assert _upload(client, child, headers=H("orgB")).status_code == 404


def test_missing_stt_configuration_is_reported(client, child, monkeypatch):
    from app import config
    monkeypatch.setattr(transcription, "get_settings", lambda: NS(groq_api_key="", stt_model=""))
    app.dependency_overrides[get_llm_client] = lambda: FakeLlm()
    try:
        r = _upload(client, child)
    finally:
        app.dependency_overrides.pop(get_llm_client, None)
    assert r.status_code == 503 and "GROQ_API_KEY" in r.json()["detail"]


def _rate_limited():
    import httpx, openai
    return openai.RateLimitError("rate limit", response=httpx.Response(429, request=httpx.Request("POST", "https://api.groq.com")), body=None)


class LimitedStt(FakeStt):
    def __init__(self, error):
        super().__init__("")
        self.error = error

    def create(self, **kw):
        self.calls.append(kw)
        raise self.error


class FakeOpenRouter:
    def __init__(self, text="녹음 예비 경로 받아쓰기 결과입니다."):
        self.text, self.calls = text, []
        self.chat = NS(completions=self)

    def create(self, **kw):
        self.calls.append(kw)
        return NS(choices=[NS(message=NS(content=self.text))])


@needs_ffmpeg
def test_groq_rate_limit_falls_back_to_openrouter_with_zdr(client, child, monkeypatch):
    from app.routers.recordings import get_fallback_stt_client
    monkeypatch.setattr(transcription, "get_settings", lambda: NS(groq_api_key="g", stt_model="whisper-large-v3-turbo",
                                                                  openrouter_api_key="o", openrouter_stt_model="audio-model"))
    import app.routers.recordings as rec
    monkeypatch.setattr(rec, "get_settings", lambda: NS(stt_model="whisper-large-v3-turbo", openrouter_stt_model="audio-model", openai_model="m"))
    groq, router, llm = LimitedStt(_rate_limited()), FakeOpenRouter(), FakeLlm()
    app.dependency_overrides.update({get_stt_client: lambda: groq, get_fallback_stt_client: lambda: router, get_llm_client: lambda: llm})
    try:
        r = _upload(client, child)
    finally:
        for dep in (get_stt_client, get_fallback_stt_client, get_llm_client):
            app.dependency_overrides.pop(dep, None)
    assert r.status_code == 201, r.text
    p = r.json()["payload"]
    assert (p["stt_provider"], p["stt_model"]) == ("openrouter", "audio-model") and p["transcript"].startswith("녹음 예비")
    call = router.calls[0]
    assert call["extra_body"] == {"provider": {"zdr": True, "data_collection": "deny"}}  # privacy-restricted routing
    assert call["messages"][0]["content"][1]["type"] == "input_audio"


@needs_ffmpeg
def test_rate_limit_without_fallback_is_a_clear_503(client, child):
    from app.routers.recordings import get_fallback_stt_client
    app.dependency_overrides.update({get_stt_client: lambda: LimitedStt(_rate_limited()), get_fallback_stt_client: lambda: None,
                                     get_llm_client: lambda: FakeLlm()})
    try:
        r = _upload(client, child)
    finally:
        for dep in (get_stt_client, get_fallback_stt_client, get_llm_client):
            app.dependency_overrides.pop(dep, None)
    assert r.status_code == 503 and "한도" in r.json()["detail"]


def test_only_limits_and_outages_trigger_fallback():
    import httpx, openai
    req = httpx.Request("POST", "https://x")
    assert transcription.is_unavailable(_rate_limited())
    assert transcription.is_unavailable(openai.InternalServerError("down", response=httpx.Response(503, request=req), body=None))
    assert transcription.is_unavailable(openai.APITimeoutError(request=req))
    assert not transcription.is_unavailable(openai.BadRequestError("bad audio", response=httpx.Response(400, request=req), body=None))
    assert not transcription.is_unavailable(openai.AuthenticationError("bad key", response=httpx.Response(401, request=req), body=None))
