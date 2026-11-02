"""Child-scoped records: behavior observations, vocabulary, sessions."""
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from ..auth import Principal, current_principal, require_write
from ..deps import audit, child_or_404, get_repo, owned_or_404
from ..repo.base import NotFound
from ..services import billing

router = APIRouter(tags=["records"])


def _list(col, child_id, p, repo):
    child_or_404(repo, p, child_id)
    return sorted(repo.list(col, p.org_id, child_id=child_id), key=lambda d: d.get("created_at", ""))


def _create(col, child_id, body: BaseModel, p, repo, extra=None):
    child_or_404(repo, p, child_id)
    doc = repo.create(col, p.org_id, {**body.model_dump(mode="json"), **(extra or {}), "child_id": child_id})
    audit(repo, p, "create", col, doc["id"], child_id)
    return doc


# ---- behavior (ABC) ----
class BehaviorIn(BaseModel):
    observed_at: str  # ISO datetime
    antecedent: str
    behavior: str = Field(description="관찰 가능한 행동만 기술")
    consequence: str
    setting: str | None = None
    activity: str | None = None
    people_present: list[str] = []
    frequency: int | None = Field(default=None, ge=0)
    duration_sec: int | None = Field(default=None, ge=0)
    intensity: int | None = None  # org-defined scale
    observer: str
    memo: str | None = None


@router.post("/children/{child_id}/behavior", status_code=201)
def create_behavior(child_id: str, body: BehaviorIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child_or_404(repo, p, child_id)
    if body.intensity is not None:
        try:
            org = repo.get("organizations", p.org_id, p.org_id)
        except NotFound:
            org = {}
        sc = org.get("behavior_scale")
        if not sc:
            raise HTTPException(422, "기관 설정에 강도 척도(behavior_scale)가 없습니다")
        if not sc["min"] <= body.intensity <= sc["max"]:
            raise HTTPException(422, f"intensity must be {sc['min']}..{sc['max']}")
    return _create("behavior_observations", child_id, body, p, repo)


@router.get("/children/{child_id}/behavior")
def list_behavior(child_id: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    return _list("behavior_observations", child_id, p, repo)


# ---- vocabulary ----
class VocabIn(BaseModel):
    word: str
    modality: Literal["receptive", "expressive"]
    status: Literal["not_observed", "emerging", "with_prompt", "independent"]
    observed_on: date
    source: str | None = None  # e.g. test_code or "session"
    category: str | None = None
    difficulty: int | None = Field(default=None, ge=1, le=5)
    target: bool = False


@router.post("/children/{child_id}/vocabulary", status_code=201)
def create_vocab(child_id: str, body: VocabIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    return _create("vocabulary_records", child_id, body, p, repo)


@router.get("/children/{child_id}/vocabulary")
def list_vocab(child_id: str, modality: str | None = None, q: str | None = None,
               p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    rows = _list("vocabulary_records", child_id, p, repo)
    return [r for r in rows if (not modality or r["modality"] == modality) and (not q or q in r["word"])]


@router.get("/children/{child_id}/vocabulary/home-list")
def home_list(child_id: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    rows = [r for r in _list("vocabulary_records", child_id, p, repo) if r["target"] and r["status"] != "independent"]
    return {"words": sorted({r["word"] for r in rows}), "status": "draft"}


# ---- sessions ----
class Activity(BaseModel):
    name: str
    correct: int = Field(ge=0)
    trials: int = Field(ge=0)
    prompt_level: str | None = None

    @model_validator(mode="after")
    def _ok(self):
        if self.correct > self.trials:
            raise ValueError("correct cannot exceed trials")
        return self


class SessionIn(BaseModel):
    date: date
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$")
    status: Literal["scheduled", "completed", "cancelled"] = "completed"
    therapist: str
    activities: list[Activity] = []
    utterances: list[str] = []
    observed_behaviors: list[str] = []

    @model_validator(mode="after")
    def _times(self):
        billing.minutes_between(self.start, self.end)
        return self


@router.post("/children/{child_id}/sessions", status_code=201)
def create_session(child_id: str, body: SessionIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    stats = [{"name": a.name, "accuracy_pct": billing.accuracy(a.correct, a.trials)} for a in body.activities]
    return _create("therapy_sessions", child_id, body, p, repo,
                   {"minutes": billing.minutes_between(body.start, body.end), "activity_accuracy": stats})


@router.get("/children/{child_id}/sessions")
def list_sessions(child_id: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    return _list("therapy_sessions", child_id, p, repo)


class NoteIn(BaseModel):
    text: str


@router.post("/sessions/{session_id}/note", status_code=201)
def save_manual_note(session_id: str, body: NoteIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    try:
        s = repo.get("therapy_sessions", p.org_id, session_id)
    except NotFound:
        raise HTTPException(404, "session not found")
    owned_or_404(repo, p, s, "session not found")
    doc = repo.create("session_notes", p.org_id, {"session_id": session_id, "child_id": s["child_id"], "text": body.text,
                                                  "source": "therapist", "status": "approved"})
    audit(repo, p, "create", "session_notes", doc["id"], s["child_id"])
    return doc


@router.get("/billing/summary")
def billing_summary(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), child_id: str = Query(), unit_price: int | None = None,
                    p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    from .attendance import month_bounds
    child_or_404(repo, p, child_id)
    rows = repo.list_range("therapy_sessions", p.org_id, "date", *month_bounds(month), child_id=child_id)
    return billing.monthly_summary(rows, unit_price)
