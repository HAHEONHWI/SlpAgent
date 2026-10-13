import re
import unicodedata
from typing import Final


OVERRIDE_PATTERNS: Final = (
    re.compile(r"^\s*(?:ignore|disregard|forget)\b.{0,60}\b(?:instructions?|rules?|system|developer|prompts?)\b", re.I | re.S),
    re.compile(r"^\s*(?:이전|앞선|모든|시스템|개발자).{0,40}(?:지시|규칙|프롬프트).{0,20}(?:무시|잊|해제)", re.S),
    re.compile(r"^\s*(?:reveal|print|show|dump)\b.{0,40}\b(?:system|developer)\s+(?:prompt|instructions?)\b", re.I | re.S),
    re.compile(r"^\s*(?:시스템|개발자)\s*(?:프롬프트|지시문).{0,20}(?:보여|공개|출력)", re.S),
)


def is_privilege_override_request(text: str) -> bool:
    normalized = unicodedata.normalize("NFKC", text)
    visible = "".join(character for character in normalized if unicodedata.category(character) != "Cf")
    return any(pattern.search(visible) for pattern in OVERRIDE_PATTERNS)
