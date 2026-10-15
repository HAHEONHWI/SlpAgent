"""Parent consultation records (written by the therapist, not AI) and approved clinical history lists."""
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator, model_validator
from ..auth import Principal, current_principal, require_write
from ..deps import audit, child_or_404, get_repo
from ..services import billing

router = APIRouter(tags=["consultations"])


class ConsultationIn(BaseModel):
    date: date
    start: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    end: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    counselor: str = Field(min_length=1, max_length=100)
    participants: list[str] = []
    topics: list[str] = []
    summary: str = Field(max_length=10000)
    session_summary: str | None = Field(default=None, max_length=10000)
    parent_concerns: list[str] | None = Field(default=None, max_length=50)
    home_activities: list[str] | None = Field(default=None, max_length=50)
    guidance_given: str | None = Field(default=None, max_length=10000)
    follow_up: str | None = Field(default=None, max_length=10000)

    @field_validator("summary")
    @classmethod
    def _summary(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("summary is required")
        return value

    @model_validator(mode="after")
    def _times(self):
        if (self.start is None) != (self.end is None):
            raise ValueError("start and end must both be given or both be null")
        if self.start is not None:
            billing.minutes_between(self.start, self.end)
        return self


@router.post("/children/{child_id}/consultations", status_code=201)
def create_consultation(child_id: str, body: ConsultationIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child_or_404(repo, p, child_id)
    minutes = billing.minutes_between(body.start, body.end) if body.start and body.end else None
    doc = repo.create("parent_consultations", p.org_id,
                      {**body.model_dump(mode="json"), "minutes": minutes, "child_id": child_id, "created_by": p.uid})
    audit(repo, p, "create", "parent_consultations", doc["id"], child_id)
    return doc


@router.get("/children/{child_id}/consultations")
def list_consultations(child_id: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    child_or_404(repo, p, child_id)
    rows = repo.list("parent_consultations", p.org_id, child_id=child_id)
    return sorted(rows, key=lambda r: (r.get("date", ""), r.get("start") or "", r.get("created_at", "")))


def _approved(repo, p: Principal, col: str, child_id: str, **eq) -> list[dict]:
    child_or_404(repo, p, child_id)
    rows = repo.list(col, p.org_id, child_id=child_id, status="approved", **eq)
    return sorted(rows, key=lambda r: r.get("created_at", ""), reverse=True)


@router.get("/children/{child_id}/clinical-analyses")
def list_clinical_analyses(child_id: str, kind: Literal["integrated_analysis", "behavior_analysis"] | None = None,
                           p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    eq = {"kind": kind} if kind else {}
    return [{"id": r["id"], "kind": r.get("kind"), "payload": r.get("payload"), "approved_by": r.get("approved_by"),
             "created_at": r.get("created_at")} for r in _approved(repo, p, "clinical_analyses", child_id, **eq)]


@router.get("/children/{child_id}/therapy-activities")
def list_therapy_activities(child_id: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    return [{"id": r["id"], "payload": r.get("payload"), "approved_by": r.get("approved_by"),
             "created_at": r.get("created_at")} for r in _approved(repo, p, "therapy_activities", child_id)]
