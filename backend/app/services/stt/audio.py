"""ffmpeg/ffprobe helpers. Audio content is validated by decoding it (ffprobe), never by file extension alone."""
import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

ALLOWED_EXTENSIONS = {".m4a", ".mp3", ".wav", ".webm", ".ogg", ".flac", ".mp4", ".mpeg", ".mpga", ".aac"}
GROQ_FILE_LIMIT = 25 * 1024 * 1024
CHUNK_SIZE_LIMIT = 24 * 1024 * 1024  # safety margin under the 25 MB provider limit


class AudioError(ValueError):
    pass


class ToolMissing(RuntimeError):
    pass


def _tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise ToolMissing(f"{name} is not installed on the server")
    return path


@dataclass
class Probe:
    duration: float
    codec: str
    channels: int
    sample_rate: int
    bit_rate: int | None
    format_name: str


def probe(path: Path) -> Probe:
    out = subprocess.run([_tool("ffprobe"), "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
                         capture_output=True, text=True, timeout=120)
    try:
        info = json.loads(out.stdout or "{}")
        audio = next(s for s in info.get("streams", []) if s.get("codec_type") == "audio")
        duration = float(info["format"].get("duration") or audio.get("duration"))
    except (StopIteration, KeyError, TypeError, ValueError, json.JSONDecodeError):
        raise AudioError("오디오 파일을 읽을 수 없습니다. 녹음 파일(m4a, mp3, wav 등)인지 확인해 주세요.")
    if duration <= 0:
        raise AudioError("녹음 길이가 0초입니다.")
    bit_rate = audio.get("bit_rate") or info["format"].get("bit_rate")
    return Probe(duration=duration, codec=audio.get("codec_name", ""), channels=int(audio.get("channels") or 0),
                 sample_rate=int(audio.get("sample_rate") or 0), bit_rate=int(bit_rate) if bit_rate else None,
                 format_name=info["format"].get("format_name", ""))


def needs_reencode(p: Probe, target_kbps: int) -> bool:
    """Skip re-encoding when the source is already a compact mono MP3 at <=16 kHz near the target bitrate."""
    return not (p.codec == "mp3" and p.channels == 1 and p.sample_rate <= 16000
                and p.bit_rate is not None and p.bit_rate <= (target_kbps + 16) * 1000)


def compress(src: Path, dst: Path, kbps: int) -> None:
    """Mono, 16 kHz MP3 at `kbps`. Whisper resamples to 16 kHz mono internally, so this loses nothing it uses."""
    done = subprocess.run([_tool("ffmpeg"), "-nostdin", "-y", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000",
                           "-c:a", "libmp3lame", "-b:a", f"{kbps}k", str(dst)], capture_output=True, text=True, timeout=1800)
    if done.returncode != 0 or not dst.exists() or dst.stat().st_size == 0:
        raise AudioError("오디오 변환에 실패했습니다. 다른 형식으로 저장해 다시 올려 주세요.")


_SILENCE = re.compile(r"silence_(start|end): ([0-9.]+)")


def silences(path: Path, noise_db: int = -35, min_seconds: float = 0.6) -> list[tuple[float, float]]:
    """(start, end) of quiet stretches, used to place chunk boundaries between words."""
    done = subprocess.run([_tool("ffmpeg"), "-nostdin", "-v", "info", "-i", str(path), "-af",
                           f"silencedetect=noise={noise_db}dB:d={min_seconds}", "-f", "null", "-"],
                          capture_output=True, text=True, timeout=1800)
    spans, start = [], None
    for kind, value in _SILENCE.findall(done.stderr):
        if kind == "start":
            start = float(value)
        elif start is not None:
            spans.append((start, float(value)))
            start = None
    return spans


def plan_cuts(duration: float, quiet: list[tuple[float, float]], target: float, window: float = 30.0) -> list[float]:
    """Boundaries near every `target` seconds, moved to the middle of the nearest silence within +/- window.
    Falls back to the exact multiple when no silence is near. Returns [0, ..., duration]."""
    cuts = [0.0]
    t = target
    while t < duration - target * 0.25:  # do not leave a tiny last chunk
        near = [(abs((a + b) / 2 - t), (a + b) / 2) for a, b in quiet if abs((a + b) / 2 - t) <= window and (a + b) / 2 > cuts[-1] + target / 2]
        cut = min(near)[1] if near else t
        cuts.append(round(cut, 3))
        t = cut + target
    cuts.append(round(duration, 3))
    return cuts


def extract(src: Path, start: float, end: float, dst: Path, kbps: int) -> None:
    done = subprocess.run([_tool("ffmpeg"), "-nostdin", "-y", "-v", "error", "-ss", f"{start:.3f}", "-to", f"{end:.3f}",
                           "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", f"{kbps}k", str(dst)],
                          capture_output=True, text=True, timeout=600)
    if done.returncode != 0 or not dst.exists():
        raise AudioError("구간 분할에 실패했습니다.")
