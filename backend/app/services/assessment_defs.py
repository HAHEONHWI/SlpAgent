"""Registry of supported tests. Item banks/norms are NOT invented: they are added only from supplied
reference material. `derived_scores` is always unavailable unless an official norm table is loaded."""
import json
from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic import BaseModel


class AssessmentDef(BaseModel):
    code: str
    name: str
    domain_hint: str
    source_files: list[str]
    source_kind: Literal["text_pdf", "image_pdf", "none"]
    norm_tables_loaded: bool = False
    item_bank_loaded: bool = False
    notes: str = ""


DEFS: dict[str, AssessmentDef] = {d.code: d for d in [
    AssessmentDef(code="K-SNAP", name="영유아 언어 및 의사소통 발달검사", domain_hint="언어·의사소통", source_files=["영유아 언어 및 의사소통 발달검사(k-snap).pdf"], source_kind="image_pdf", notes="이미지 PDF: OCR/육안 검수 필요"),
    AssessmentDef(code="ESDM", name="덴버모델 발달 체크리스트", domain_hint="발달 전반", source_files=["영유아 자폐아동을 위한 덴버모델 발달 체크리스트(esdm).pdf"], source_kind="image_pdf", notes="이미지 PDF 22쪽: OCR/육안 검수 필요. 선별·진단 결과 자동 산출 금지"),
    AssessmentDef(code="EASIC", name="EASIC 의사소통 기술 평가", domain_hint="언어이전~의사소통", source_files=["EASIC검사지.pdf", "EASIC자극제시방법.pdf", "EASIC-언어이전단계.pdf"], source_kind="text_pdf", notes="언어이전단계 기록지는 이미지 PDF"),
    AssessmentDef(code="K-MB-CDI-I", name="K-MB-CDI 영아용", domain_hint="어휘·제스처", source_files=["K-MB-CDI 영아용 검사지.pdf"], source_kind="image_pdf"),
    AssessmentDef(code="K-MB-CDI-T", name="K-MB-CDI 유아용", domain_hint="어휘·문법", source_files=["K-MB-CDI 유아용 검사지.pdf"], source_kind="image_pdf"),
    AssessmentDef(code="REVT", name="수용·표현 어휘력 검사", domain_hint="수용어휘/표현어휘", source_files=["REVT 매뉴얼.pdf", "REVT 검사지.PDF"], source_kind="text_pdf", notes="매뉴얼은 텍스트, 검사지는 이미지 PDF. 규준표 미제공"),
    AssessmentDef(code="SELSI", name="영·유아 언어발달 검사", domain_hint="수용/표현 언어", source_files=["검사지 - 영,유아 언어발달 검사(SELSI).pdf"], source_kind="text_pdf", notes="등가연령·백분위는 지침서 표 34~37 필요(미제공)"),
    AssessmentDef(code="PRES", name="취학전 아동의 수용언어 및 표현언어 발달 척도", domain_hint="수용/표현/통합", source_files=["pres검사지.pdf"], source_kind="text_pdf", notes="언어발달연령·백분위는 지침서 100-104쪽 필요(미제공). 수용 25/15/6, 표현 16/22/8 문항(인지·의미/구문·음운/화용)"),
    AssessmentDef(code="KOSECT", name="구문의미 이해력 검사", domain_hint="구문의미 이해", source_files=["구문의미 이해력 검사.pdf"], source_kind="text_pdf", notes="백분위·규준 미제공"),
    AssessmentDef(code="K-CDI", name="아동발달검사(K-CDI)", domain_hint="발달 전반", source_files=["K-CDI_%EC%95%84%EB%8F%99%EB%B0%9C%EB%8B%AC%EA%B2%80%EC%82%AC_%EA%B8%B0%EB%A1%9D%EC%A7%80_%EC%A0%84%EC%B2%B4.pdf"], source_kind="image_pdf", notes="이미지 PDF: OCR/육안 검수 필요"),
]}

DEFAULT_ITEM_BANK_DIR = Path(__file__).resolve().parents[1] / "data" / "assessments"


def item_bank_dir() -> Path:
    """Item banks contain item text from licensed tests, so they are never committed or baked into the
    image. Locally they live in the git-ignored default dir; production mounts private storage here."""
    from ..config import get_settings
    configured = get_settings().assessment_data_dir
    return Path(configured) if configured else DEFAULT_ITEM_BANK_DIR


@lru_cache(maxsize=None)
def load_item_bank(code: str) -> list[dict]:
    if code not in DEFS:
        return []
    path = item_bank_dir() / f"{code}.json"
    try:
        bank = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    items = bank.get("items") if bank.get("test_code") == code else None
    if not isinstance(items, list):
        return []
    required = {"item_id", "domain", "age_range", "prompt", "response_options", "source", "needs_review"}
    if any(not isinstance(item, dict) or not required <= item.keys() for item in items):
        return []
    return items


def licensed_codes(repo, org_id: str) -> set[str]:
    """Tests this organization is licensed to use, set by a site admin. Item text and source excerpts of a
    test are served only to licensed organizations."""
    from ..repo.base import NotFound
    try:
        org = repo.get("organizations", org_id, org_id)
    except NotFound:
        return set()
    return {c for c in org.get("licensed_assessments") or [] if c in DEFS}


def public_definitions(licensed: set[str] | None = None) -> list[dict]:
    licensed = licensed or set()
    return [definition.model_copy(update={"item_bank_loaded": code in licensed and bool(load_item_bank(code))}).model_dump()
            | {"licensed": code in licensed} for code, definition in DEFS.items()]


def derived_scores(code: str) -> dict:
    d = DEFS[code]
    if d.norm_tables_loaded:
        raise NotImplementedError("norm lookup must be implemented per test from the official table")
    return {"standard_score": None, "developmental_age": None, "percentile": None,
            "status": "norm_unavailable", "message": "공식 규준표가 로드되지 않아 점수·발달연령·백분위를 산출하지 않았습니다."}
