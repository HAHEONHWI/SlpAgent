"""Combine per-chunk transcripts into one time-ordered transcript without overlap duplicates."""
from difflib import SequenceMatcher

NO_SPEECH_THRESHOLD = 0.6   # Whisper's own estimate that a segment is not speech (silence "hallucinations")
SEAM_SECONDS = 3.0          # overlap duplicates can only appear right after a chunk boundary
LONG_SILENCE_SECONDS = 20.0


def clock(seconds: float) -> str:
    s = int(round(seconds))
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60:02d}:{s % 60:02d}"


def _norm(text: str) -> str:
    return "".join(ch for ch in text if ch.isalnum())


def _same(a: str, b: str) -> bool:
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return False
    return a in b or b in a or SequenceMatcher(None, a, b).ratio() >= 0.9


def merge(chunks: list[dict]) -> dict:
    """chunks: ordered dicts with cut_start, cut_end, start (audio offset incl. overlap), status, segments
    [{start, end, text, no_speech_prob?}] relative to `start`. Returns {segments, markers, text}."""
    kept: list[dict] = []
    markers: list[dict] = []
    for i, ch in enumerate(sorted(chunks, key=lambda c: c["cut_start"])):
        if ch.get("status") != "done":
            markers.append({"type": "failed", "start": ch["cut_start"], "end": ch["cut_end"]})
            continue
        first = True
        for seg in ch.get("segments") or []:
            text = (seg.get("text") or "").strip()
            if not text or (seg.get("no_speech_prob") or 0) > NO_SPEECH_THRESHOLD:
                continue
            start, end = ch["start"] + float(seg["start"]), ch["start"] + float(seg["end"])
            if i > 0 and (start + end) / 2 < ch["cut_start"]:
                continue  # inside the overlap: the previous chunk already covers it
            if first and kept and start < ch["cut_start"] + SEAM_SECONDS and _same(kept[-1]["text"], text):
                first = False
                continue  # same sentence repeated across the boundary
            first = False
            kept.append({"start": round(start, 2), "end": round(end, 2), "text": text})
    for a, b in zip(kept, kept[1:]):
        if b["start"] - a["end"] >= LONG_SILENCE_SECONDS:
            markers.append({"type": "silence", "start": a["end"], "end": b["start"]})
    markers.sort(key=lambda m: m["start"])
    events = [(s["start"], s["text"]) for s in kept] + [
        (m["start"], f"[{'인식 실패' if m['type'] == 'failed' else '긴 무음'} {clock(m['start'])}–{clock(m['end'])}]") for m in markers]
    events.sort(key=lambda e: e[0])
    return {"segments": kept, "markers": markers, "text": "\n".join(t for _, t in events)}
