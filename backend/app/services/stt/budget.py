"""Usage ledgers kept server-side (Groq does not report audio-seconds quota in headers).
Docs live in the reserved "_platform" namespace: stt_usage/{provider-hour|day|month-key}."""
from datetime import datetime, timedelta, timezone
from ...repo.base import NotFound

PLATFORM = "_platform"
GROQ_MIN_BILLED_SECONDS = 10.0  # Groq bills at least 10 s per request


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _keys(now: datetime) -> dict:
    return {"hour": now.strftime("%Y%m%d%H"), "day": now.strftime("%Y%m%d"), "month": now.strftime("%Y%m")}


def _get(repo, doc_id: str) -> dict:
    try:
        return repo.get("stt_usage", PLATFORM, doc_id)
    except NotFound:
        return {}


def _add(repo, doc_id: str, **inc) -> None:
    cur = _get(repo, doc_id)
    data = {k: round(float(cur.get(k, 0)) + v, 6) for k, v in inc.items()}
    if cur:
        repo.update("stt_usage", PLATFORM, doc_id, data)
    else:
        repo.create("stt_usage", PLATFORM, data, doc_id=doc_id)


def groq_usage(repo, now: datetime | None = None) -> dict:
    k = _keys(now or _now())
    return {"hour_seconds": _get(repo, f"groq-hour-{k['hour']}").get("seconds", 0.0),
            "day_seconds": _get(repo, f"groq-day-{k['day']}").get("seconds", 0.0),
            "day_requests": _get(repo, f"groq-day-{k['day']}").get("requests", 0.0)}


def groq_wait(repo, settings, seconds: float, now: datetime | None = None) -> float:
    """Seconds to wait before `seconds` more audio fits the configured Groq budget (0 = go now)."""
    now = now or _now()
    billed = max(seconds, GROQ_MIN_BILLED_SECONDS)
    use = groq_usage(repo, now)
    if settings.groq_audio_seconds_per_day and use["day_seconds"] + billed > settings.groq_audio_seconds_per_day:
        tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=5, microsecond=0)
        return (tomorrow - now).total_seconds()
    if settings.groq_audio_seconds_per_hour and use["hour_seconds"] + billed > settings.groq_audio_seconds_per_hour:
        next_hour = (now + timedelta(hours=1)).replace(minute=0, second=5, microsecond=0)
        return (next_hour - now).total_seconds()
    return 0.0


def record_groq(repo, seconds: float, now: datetime | None = None) -> None:
    k, billed = _keys(now or _now()), max(seconds, GROQ_MIN_BILLED_SECONDS)
    _add(repo, f"groq-hour-{k['hour']}", seconds=billed, requests=1)
    _add(repo, f"groq-day-{k['day']}", seconds=billed, requests=1)


def fallback_month(repo, now: datetime | None = None) -> dict:
    d = _get(repo, f"openrouter-month-{_keys(now or _now())['month']}")
    return {"cost_usd": d.get("cost_usd", 0.0), "seconds": d.get("seconds", 0.0), "requests": d.get("requests", 0.0)}


def fallback_rate_per_hour(repo, settings, now: datetime | None = None) -> float:
    """USD per audio hour for estimates: the configured rate or the observed one this month, whichever is higher."""
    m = fallback_month(repo, now)
    observed = m["cost_usd"] / m["seconds"] * 3600 if m["seconds"] else 0.0
    return max(settings.openrouter_stt_usd_per_hour, observed)


def fallback_allowed(repo, settings, platform: dict, seconds: float, now: datetime | None = None) -> tuple[bool, str, float]:
    """(allowed, reason, estimated_usd) for sending `seconds` of audio to the fallback provider."""
    if not platform.get("fallback_enabled"):
        return False, "fallback_disabled", 0.0
    if not (settings.openrouter_api_key and settings.openrouter_stt_model):
        return False, "fallback_not_configured", 0.0
    rate = fallback_rate_per_hour(repo, settings, now)
    if rate <= 0:
        return False, "fallback_rate_unknown", 0.0  # never spend without a cost estimate
    estimate = seconds / 3600 * rate
    cap = float(platform.get("monthly_fallback_cap_usd") or 0)
    if fallback_month(repo, now)["cost_usd"] + estimate > cap:
        return False, "fallback_cap_reached", estimate
    return True, "ok", estimate


def record_fallback(repo, seconds: float, cost_usd: float, now: datetime | None = None) -> None:
    _add(repo, f"openrouter-month-{_keys(now or _now())['month']}", seconds=seconds, cost_usd=cost_usd, requests=1)


DEFAULT_PLATFORM = {"fallback_enabled": False, "monthly_fallback_cap_usd": 0.0, "chunk_minutes": 5.0, "retain_original_days": 0}


def platform_settings(repo) -> dict:
    try:
        return {**DEFAULT_PLATFORM, **repo.get("platform_settings", PLATFORM, "stt")}
    except NotFound:
        return dict(DEFAULT_PLATFORM)
