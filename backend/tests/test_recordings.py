"""Long-recording pipeline: real ffmpeg on generated audio, fake STT/LLM providers (no network, no cost)."""
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace as NS
import pytest
from app.main import app
from app.routers.recordings import get_stt_deps
from app.services.stt import audio, budget, jobs, merge, providers
from app.services.stt.queue import RecordingQueue
from app.services.stt.store import LocalStore
from tests.conftest import H

pytestmark = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg not installed")
SITE = H("-", "site_admin", "root")


def make_audio(path: Path, minutes: float, fmt: str = "mp3") -> Path:
    """Tone with a 5-second silent gap every 5 minutes (at 295-300 s), so boundaries can land in silence."""
    seconds = minutes * 60
    codec = ["-c:a", "pcm_s16le"] if fmt == "wav" else ["-c:a", "libmp3lame", "-b:a", "32k"]
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", f"sine=frequency=300:duration={seconds}",
                    "-af", "volume='if(lt(mod(t,300),295),1,0)':eval=frame", "-ac", "1", "-ar", "16000", *codec, str(path)], check=True)
    return path


@pytest.fixture(scope="module")
def clips(tmp_path_factory):
    d = tmp_path_factory.mktemp("clips")
    return {"5": make_audio(d / "five.mp3", 5), "40": make_audio(d / "forty.mp3", 40), "120": make_audio(d / "twohours.mp3", 120),
            "wav15": make_audio(d / "fifteen.wav", 15, "wav")}


class FakeGroq:
    name = "groq"

    def __init__(self):
        self.calls, self.errors, self.logprob = [], {}, -0.2

    def transcribe(self, path):
        n = len(self.calls)
        self.calls.append(path.name)
        err = self.errors.pop(n, None) or self.errors.pop(path.name, None)
        if err:
            self.calls.pop()
            raise err
        dur = audio.probe(path).duration
        return providers.Result(text=f"구간{path.stem}", duration=dur,
                                segments=[{"start": 2.0, "end": dur - 0.5, "text": f"구간{path.stem}", "no_speech_prob": 0.01, "avg_logprob": self.logprob}])


class FakeFallback(FakeGroq):
    name = "openrouter"

    def transcribe(self, path):
        r = super().transcribe(path)
        r.cost_usd = 0.001
        r.text = r.segments[0]["text"] = f"예비{path.stem}"
        return r


class FakeLlm:
    def __init__(self):
        self.calls = []
        self.responses = self

    def parse(self, **kw):
        self.calls.append(kw)
        return NS(output_parsed=kw["text_format"](goals="2음절 모방", activities="그림카드 놀이", child_responses="확인되지 않음",
                  spontaneous_speech="확인되지 않음", therapist_prompting="모델링 제시", parent_communication="가정 연습 안내",
                  home_activities="그림책 5분", next_plan="확인되지 않음"))


def settings(**kw):
    base = dict(stt_max_minutes=180, stt_bitrate_kbps=48, stt_retry_bitrate_kbps=64, stt_overlap_seconds=1.5,
                stt_min_request_interval_seconds=0, openai_model="m", groq_audio_seconds_per_hour=0, groq_audio_seconds_per_day=0,
                openrouter_api_key="", openrouter_stt_model="", openrouter_stt_usd_per_hour=0.0)
    return NS(**{**base, **kw})


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    """Quota windows depend on the time of day; pin it so results do not change near the top of the hour."""
    from datetime import datetime, timezone
    now = datetime(2026, 10, 13, 10, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(jobs, "_now", lambda: now)
    monkeypatch.setattr(budget, "_now", lambda: now)
    return now


@pytest.fixture
def deps(repo, tmp_path):
    d = jobs.Deps(repo, LocalStore(str(tmp_path / "store")), RecordingQueue(), settings(), groq=FakeGroq(), fallback=None, llm=FakeLlm())
    app.dependency_overrides[get_stt_deps] = lambda: d
    yield d
    app.dependency_overrides.pop(get_stt_deps, None)


def drive(d, limit=500):
    """Run queued steps in order until the queue is empty or the pipeline schedules a real wait (as a queue would)."""
    for _ in range(limit):
        if not d.queue.items or d.queue.items[0][3] >= 1:
            d.queue.items.clear()
            return
        org, job, step, _delay = d.queue.items.pop(0)
        jobs.run_step(d, org, job, step)
    raise AssertionError("pipeline did not settle")


def upload(client, child, path: Path, parts: int = 1, **form):
    body = {"filename": f"녹음{path.suffix}", "size": path.stat().st_size, "content_type": "audio/mpeg", "kind": "session",
            "date": "2026-10-13", "counselor": "김재활", "consent": True, **form}
    r = client.post(f"/children/{child['id']}/recordings", headers=H(), json=body)
    assert r.status_code == 201, r.text
    job, url = r.json()["job"], r.json()["upload"]["url"]
    data, total = path.read_bytes(), path.stat().st_size
    step = -(-total // parts)
    for i in range(0, total, step):
        chunk = data[i:i + step]
        rr = client.put(url, headers={**H(), "Content-Range": f"bytes {i}-{i + len(chunk) - 1}/{total}"}, content=chunk)
        assert rr.status_code in (200, 308)
    assert client.post(f"/recordings/{job['id']}/complete", headers=H()).status_code == 200
    return job["id"]


def test_five_minutes_end_to_end_with_resumed_upload(client, repo, child, deps, clips):
    path = clips["5"]
    body = {"filename": "a.mp3", "size": path.stat().st_size, "content_type": "audio/mpeg", "date": "2026-10-13", "counselor": "김", "consent": True}
    r = client.post(f"/children/{child['id']}/recordings", headers=H(), json=body).json()
    url, jid, data = r["upload"]["url"], r["job"]["id"], path.read_bytes()
    half = len(data) // 2
    client.put(url, headers={**H(), "Content-Range": f"bytes 0-{half - 1}/{len(data)}"}, content=data[:half])
    assert client.post(f"/recordings/{jid}/complete", headers=H()).status_code == 409  # interrupted upload is not accepted
    status = client.put(url, headers={**H(), "Content-Range": f"bytes */{len(data)}"})
    assert status.status_code == 308 and status.headers["range"] == f"bytes=0-{half - 1}"  # resume point
    client.put(url, headers={**H(), "Content-Range": f"bytes {half}-{len(data) - 1}/{len(data)}"}, content=data[half:])
    assert client.post(f"/recordings/{jid}/complete", headers=H()).status_code == 200
    drive(deps)
    job = client.get(f"/recordings/{jid}", headers=H()).json()
    assert job["status"] == "draft_ready" and job["chunk_count"] == 1 and job["chunks_done"] == 1
    assert job["compressed_size"] and job["original_size"]
    # the LLM got the transcript and the 8 sections; unknown parts say "확인되지 않음"
    assert "구간000" in json.loads(deps.llm.calls[0]["input"])["transcript"]
    draft = repo.get("ai_analyses", "orgA", job["draft_id"])
    assert draft["kind"] == "recording_summary" and draft["payload"]["sections"]["next_plan"] == "확인되지 않음"
    assert client.post(f"/proposals/{draft['id']}/approve", headers=H()).json()["applied_to"] == "recording_records"
    rec = client.get(f"/children/{child['id']}/recording-records", headers=H()).json()[0]
    assert rec["sections"]["goals"] == "2음절 모방" and rec["transcript"].startswith("구간000")
    settled = client.get(f"/recordings/{jid}", headers=H()).json()
    assert settled["status"] == "approved"  # no longer shown as 검토 대기
    assert client.post(f"/recordings/{jid}/cancel", headers=H()).status_code == 409
    # originals and chunks are gone after the job
    assert not list(Path(deps.store.root).rglob("*.mp3"))


def test_forty_minutes_splits_at_silences_in_order(client, repo, child, deps, clips):
    jid = upload(client, child, clips["40"])
    drive(deps)
    chunks = sorted(repo.list("stt_chunks", "orgA", job_id=jid), key=lambda c: c["index"])
    assert len(chunks) == 8
    for prev, c in zip(chunks, chunks[1:]):
        assert 290 <= c["cut_start"] % 300 or c["cut_start"] % 300 <= 5  # boundary inside the 295-300 s silence
        assert c["start"] == pytest.approx(c["cut_start"] - 1.5)          # 1.5 s overlap with the previous chunk
        assert prev["cut_end"] == c["cut_start"]
        assert c["size"] < audio.CHUNK_SIZE_LIMIT
    assert deps.groq.calls == [f"{i:03d}.mp3" for i in range(8)]  # processed sequentially, in time order
    text = repo.get("stt_transcripts", "orgA", jid)["text"]
    assert [l for l in text.splitlines() if l.startswith("구간")] == [f"구간{i:03d}" for i in range(8)]


def test_over_25mb_original_is_compressed_and_split(client, repo, child, deps, clips):
    path = clips["wav15"]
    assert path.stat().st_size > 25 * 1024 * 1024
    jid = upload(client, child, path, parts=3)
    drive(deps)
    job = repo.get("stt_jobs", "orgA", jid)
    assert job["status"] == "draft_ready" and job["reencoded"] and job["compressed_size"] < job["original_size"] / 5
    assert all(c["size"] < audio.CHUNK_SIZE_LIMIT for c in repo.list("stt_chunks", "orgA", job_id=jid))


def test_two_hours_waits_on_groq_quota_then_uses_capped_fallback(client, repo, child, deps, clips):
    deps.settings.groq_audio_seconds_per_hour = 3600  # one hour of audio per hour
    jid = upload(client, child, clips["120"])
    drive(deps)
    job = repo.get("stt_jobs", "orgA", jid)
    assert job["chunk_count"] == 24 and job["status"] == "waiting" and job["wait_reason"] == "groq_quota"
    assert 11 <= job["chunks_done"] <= 12 and job["fallback_blocked"] == "fallback_disabled"
    # admin enables the fallback with a cost cap; configured rate gives an estimate before any spend
    repo.create("platform_settings", "_platform", {"fallback_enabled": True, "monthly_fallback_cap_usd": 0.05, "chunk_minutes": 5}, doc_id="stt")
    deps.settings.openrouter_api_key, deps.settings.openrouter_stt_model, deps.settings.openrouter_stt_usd_per_hour = "k", "m", 0.04
    deps.fallback = FakeFallback()
    deps.queue.items.clear()
    assert client.post(f"/recordings/{jid}/retry", headers=H()).status_code == 200
    drive(deps)
    job = repo.get("stt_jobs", "orgA", jid)
    assert job["status"] == "draft_ready" and job["fallback_chunks"] >= 1
    assert budget.fallback_month(repo)["cost_usd"] <= 0.05
    text = repo.get("stt_transcripts", "orgA", jid)["text"]
    assert "예비" in text and text.index("구간000") < text.index("예비")  # fallback chunks stay in time order


def test_fallback_blocked_by_monthly_cap_keeps_job_waiting(client, repo, child, deps, clips):
    deps.settings.groq_audio_seconds_per_hour = 10
    repo.create("platform_settings", "_platform", {"fallback_enabled": True, "monthly_fallback_cap_usd": 0.0}, doc_id="stt")
    deps.settings.openrouter_api_key, deps.settings.openrouter_stt_model, deps.settings.openrouter_stt_usd_per_hour = "k", "m", 0.04
    deps.fallback = FakeFallback()
    jid = upload(client, child, clips["5"])
    drive(deps)
    job = repo.get("stt_jobs", "orgA", jid)
    assert job["status"] == "waiting" and job["fallback_blocked"] == "fallback_cap_reached" and not deps.fallback.calls


def test_429_retry_after_and_network_failure_backoff(client, repo, child, deps, clips):
    deps.groq.errors = {0: providers.RateLimited(42.0)}
    jid = upload(client, child, clips["5"])
    drive(deps)
    job = repo.get("stt_jobs", "orgA", jid)
    assert job["status"] == "waiting" and job["wait_reason"] == "groq_rate_limited"
    c = repo.list("stt_chunks", "orgA", job_id=jid)[0]
    assert c["attempts"] == 1 and c["next_try_at"]
    assert 40 <= (jobs.datetime.fromisoformat(c["next_try_at"]) - jobs._now()).total_seconds() <= 43  # header honored
    repo.update("stt_chunks", "orgA", c["id"], {"next_try_at": None})  # time passes
    deps.groq.errors = {0: providers.Unavailable("timeout")}
    jobs.schedule(deps, "orgA", jid)
    drive(deps)
    c = repo.list("stt_chunks", "orgA", job_id=jid)[0]
    assert c["attempts"] == 2 and repo.get("stt_jobs", "orgA", jid)["wait_reason"] == "groq_unavailable"
    repo.update("stt_chunks", "orgA", c["id"], {"next_try_at": None})
    jobs.schedule(deps, "orgA", jid)
    drive(deps)
    assert repo.get("stt_jobs", "orgA", jid)["status"] == "draft_ready"
    assert 1 <= jobs.backoff(0) <= 6 and jobs.backoff(10) <= 601  # jittered and capped


def test_partial_failure_marks_gap_and_retries_only_that_chunk(client, repo, child, deps, clips):
    deps.groq.errors = {"002.mp3": providers.Rejected("bad chunk")}
    jid = upload(client, child, clips["40"])
    drive(deps)
    job = repo.get("stt_jobs", "orgA", jid)
    assert job["status"] == "draft_ready" and job["chunks_failed"] == 1
    assert "[인식 실패 " in repo.get("stt_transcripts", "orgA", jid)["text"]


def test_retry_failed_chunk_only_before_cleanup(client, repo, child, deps, clips):
    deps.groq.errors = {"001.mp3": providers.Rejected("bad chunk")}
    jid = upload(client, child, clips["40"])
    # stop before merging: run until the failed chunk is recorded
    for _ in range(50):
        org, job, step, _ = deps.queue.items.pop(0)
        jobs.run_step(deps, org, job, step)
        if any(c["status"] == "failed" for c in repo.list("stt_chunks", "orgA", job_id=jid)):
            break
    deps.queue.items.clear()
    calls_before = list(deps.groq.calls)
    assert client.post(f"/recordings/{jid}/retry", headers=H()).status_code == 200
    drive(deps)
    retried = deps.groq.calls[len(calls_before):]
    assert retried[0] == "001.mp3" and "000.mp3" not in retried  # the good chunks are not transcribed again
    assert repo.get("stt_jobs", "orgA", jid)["chunks_failed"] == 0


def test_low_confidence_chunk_is_retried_at_64kbps(client, repo, child, deps, clips):
    deps.groq.logprob = -1.6
    jid = upload(client, child, clips["5"])
    for _ in range(6):  # prepare + first transcription (low confidence -> rebuilt)
        if not deps.queue.items:
            break
        org, job, step, _ = deps.queue.items.pop(0)
        jobs.run_step(deps, org, job, step)
        c = repo.list("stt_chunks", "orgA", job_id=jid)[0]
        if c["kbps"] == 64:
            break
    assert c["kbps"] == 64 and c["status"] == "pending"
    deps.groq.logprob = -0.3
    drive(deps)
    assert repo.get("stt_jobs", "orgA", jid)["status"] == "draft_ready"


def test_cancel_removes_files_and_stops(client, repo, child, deps, clips):
    jid = upload(client, child, clips["40"])
    org, job, step, _ = deps.queue.items.pop(0)
    jobs.run_step(deps, org, job, step)  # prepared: chunks exist on disk
    assert list(Path(deps.store.root).rglob("*.mp3"))
    assert client.post(f"/recordings/{jid}/cancel", headers=H()).json()["status"] == "cancelled"
    assert not list(Path(deps.store.root).rglob("*.mp3"))
    drive(deps)  # queued steps are no-ops now
    assert not deps.groq.calls


def test_edit_transcript_resummarizes_with_edited_text(client, repo, child, deps, clips):
    jid = upload(client, child, clips["5"])
    drive(deps)
    first = repo.get("stt_jobs", "orgA", jid)["draft_id"]
    assert client.put(f"/recordings/{jid}/transcript", headers=H(), json={"text": "치료사가 고친 녹취록"}).status_code == 200
    drive(deps)
    assert json.loads(deps.llm.calls[-1]["input"])["transcript"] == "치료사가 고친 녹취록"
    assert repo.get("ai_analyses", "orgA", first)["status"] == "replaced"


def test_child_name_is_masked_before_llm(client, repo, child, deps, clips):
    deps.groq.transcribe = lambda p: providers.Result(text="x", duration=60, segments=[{"start": 1, "end": 5, "text": "테스트아동 어머니 010-1234-5678"}])
    jid = upload(client, child, clips["5"])
    drive(deps)
    sent = json.loads(deps.llm.calls[0]["input"])["transcript"]
    assert "테스트아동" not in sent and "010-1234-5678" not in sent
    assert "테스트아동" in repo.get("stt_transcripts", "orgA", jid)["text"]  # stored transcript keeps what was said


def test_validation_consent_and_permissions(client, child, deps, clips, tmp_path):
    base = {"filename": "a.mp3", "size": 1000, "date": "2026-10-13", "counselor": "김", "consent": True}
    url = f"/children/{child['id']}/recordings"
    assert client.post(url, headers=H(), json={**base, "consent": False}).status_code == 422
    assert client.post(url, headers=H(), json={**base, "filename": "a.exe"}).status_code == 415
    assert client.post(url, headers=H(), json={**base, "size": 10 ** 12}).status_code == 413
    assert client.post(url, headers=H(role="assistant"), json=base).status_code == 403
    assert client.post(url, headers=H("orgB"), json=base).status_code == 404
    fake = tmp_path / "fake.mp3"
    fake.write_bytes(b"this is not audio" * 100)
    jid = upload(client, child, fake)
    drive(deps)
    job = client.get(f"/recordings/{jid}", headers=H()).json()
    assert job["status"] == "failed" and job["error"]["reason"] == "invalid_audio"
    assert client.get(f"/recordings/{jid}", headers=H("orgB")).status_code == 404


def test_merge_removes_overlap_duplicates_and_marks_gaps():
    chunks = [
        {"cut_start": 0, "cut_end": 300, "start": 0, "status": "done", "segments": [
            {"start": 10, "end": 20, "text": "첫 문장"}, {"start": 290, "end": 299.5, "text": "경계 문장입니다"}]},
        {"cut_start": 300, "cut_end": 600, "start": 298.5, "status": "done", "segments": [
            {"start": 0.0, "end": 1.4, "text": "경계 문장입니다"},       # inside the overlap -> dropped
            {"start": 1.6, "end": 4, "text": "경계 문장입니다."},         # repeated sentence at the seam -> dropped
            {"start": 4, "end": 10, "text": "시청해주셔서 감사합니다", "no_speech_prob": 0.9},  # silence hallucination -> dropped
            {"start": 60, "end": 70, "text": "다음 문장"}]},
        {"cut_start": 600, "cut_end": 900, "start": 598.5, "status": "failed", "segments": []},
    ]
    m = merge.merge(chunks)
    assert [s["text"] for s in m["segments"]] == ["첫 문장", "경계 문장입니다", "다음 문장"]
    assert [s["start"] for s in m["segments"]] == sorted(s["start"] for s in m["segments"])
    kinds = [(x["type"], x["start"]) for x in m["markers"]]
    assert ("failed", 600) in kinds and ("silence", 20) in kinds
    assert "[인식 실패 10:00–15:00]" in m["text"]


def test_plan_cuts_prefers_silence_and_bounds():
    cuts = audio.plan_cuts(1500, [(296, 299), (590, 600)], 300)
    assert cuts[0] == 0 and cuts[-1] == 1500 and cuts[1] == 297.5 and cuts[2] == 595
    assert audio.plan_cuts(900, [], 300) == [0, 300, 600, 900]


def test_provider_errors_classification(monkeypatch):
    import httpx
    def resp(code, headers=None):
        return httpx.Response(code, headers=headers or {}, request=httpx.Request("POST", "https://x"))
    for code, cls in [(429, providers.RateLimited), (503, providers.Unavailable), (524, providers.Unavailable), (400, providers.Rejected)]:
        with pytest.raises(cls):
            providers._raise_for(resp(code))
    try:
        providers._raise_for(resp(429, {"retry-after": "17"}))
    except providers.RateLimited as e:
        assert e.retry_after == 17


def test_site_admin_stt_settings_and_stats_contain_no_content(client, repo, child, deps, clips):
    jid = upload(client, child, clips["5"])
    drive(deps)
    assert client.get("/platform/stt/stats", headers=H(role="admin")).status_code == 403
    stats = client.get("/platform/stt/stats", headers=SITE).json()
    blob = json.dumps(stats, ensure_ascii=False)
    assert "녹음" not in blob and "구간" not in blob and "테스트아동" not in blob  # no file names or transcript text
    r = client.put("/platform/stt/settings", headers=SITE, json={"fallback_enabled": True, "monthly_fallback_cap_usd": 5,
                                                                  "chunk_minutes": 11, "retain_original_days": 0})
    assert r.status_code == 422  # chunk length must be 3-10 minutes
    assert client.put("/platform/stt/settings", headers=SITE, json={"fallback_enabled": True, "monthly_fallback_cap_usd": 5,
                                                                    "chunk_minutes": 4, "retain_original_days": 7}).status_code == 200
    assert client.get("/platform/stt/settings", headers=SITE).json()["chunk_minutes"] == 4


def test_internal_step_requires_queue_configuration(client):
    assert client.post("/internal/stt/step", json={"org_id": "orgA", "job_id": "x", "step": 1}).status_code == 404


def test_compact_sources_are_not_inflated():
    phone = audio.Probe(duration=600, codec="aac", channels=1, sample_rate=44100, bit_rate=33_000, format_name="mov")
    assert not audio.needs_reencode(phone, 48) and audio.chunk_kbps(phone, 48) == 40   # cut directly, 40 kbps chunks
    wav = audio.Probe(duration=600, codec="pcm_s16le", channels=1, sample_rate=16000, bit_rate=256_000, format_name="wav")
    assert audio.needs_reencode(wav, 48) and audio.chunk_kbps(wav, 48) == 48
    stereo = audio.Probe(duration=600, codec="aac", channels=2, sample_rate=48000, bit_rate=128_000, format_name="mov")
    assert audio.needs_reencode(stereo, 48)
    tiny = audio.Probe(duration=600, codec="mp3", channels=1, sample_rate=8000, bit_rate=16_000, format_name="mp3")
    assert audio.chunk_kbps(tiny, 48) == audio.MIN_KBPS  # floor protects recognition quality
