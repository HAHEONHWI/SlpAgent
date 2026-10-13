"""AI output = draft in ai_analyses. Nothing reaches clinical collections without therapist approval."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..auth import Principal, current_principal, require_write
from ..deps import audit, get_repo
from ..repo.base import NotFound
from .plans import create_plan_version

router = APIRouter(prefix="/proposals", tags=["proposals"])


class EditIn(BaseModel):
    payload: dict


def _get(repo, p, pid):
    try:
        return repo.get("ai_analyses", p.org_id, pid)
    except NotFound:
        raise HTTPException(404)


@router.get("")
def list_pending(child_id: str | None = None, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    rows = repo.list("ai_analyses", p.org_id, status="draft")
    return [r for r in rows if not child_id or r.get("child_id") == child_id]


@router.put("/{pid}")
def edit(pid: str, body: EditIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    pr = _get(repo, p, pid)
    if pr["status"] != "draft":
        raise HTTPException(409)
    return repo.update("ai_analyses", p.org_id, pid, {"payload": body.payload, "edited_by": p.uid})


@router.post("/{pid}/reject")
def reject(pid: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    pr = _get(repo, p, pid)
    if pr["status"] != "draft":
        raise HTTPException(409)
    audit(repo, p, "reject", "ai_analyses", pid, pr.get("child_id"))
    return repo.update("ai_analyses", p.org_id, pid, {"status": "rejected"})


@router.post("/{pid}/approve")
def approve(pid: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    pr = _get(repo, p, pid)
    if pr["status"] != "draft":
        raise HTTPException(409, f"proposal is {pr['status']}")
    kind, d, child = pr["kind"], pr["payload"], pr["child_id"]
    if kind == "treatment_plan":  # lands as a *draft* plan version; plan approval is a separate explicit step
        result = create_plan_version(repo, p, child, d["goals"], d.get("rationale"), "ai_approved_draft", via_ai=True)
        target = ("treatment_plans", result["id"])
    elif kind == "session_note":
        result = repo.create("session_notes", p.org_id, {"session_id": d["session_id"], "child_id": child, "text": d["text"],
                                                         "source": "ai_edited_by_therapist", "status": "approved"})
        target = ("session_notes", result["id"])
    elif kind == "parent_guidance":
        result = repo.create("generated_documents", p.org_id, {"child_id": child, "doc_type": "parent_guidance",
                                                               "text": d["text"], "status": "approved"})
        target = ("generated_documents", result["id"])
    elif kind in ("integrated_analysis", "behavior_analysis"):
        result = repo.create("clinical_analyses", p.org_id, {"child_id": child, "kind": kind,
                                                              "payload": d, "status": "approved",
                                                              "approved_by": p.uid})
        target = ("clinical_analyses", result["id"])
    elif kind == "consultation_recording":  # therapist-reviewed draft from a consultation recording
        keys = ("date", "start", "end", "minutes", "counselor", "participants", "topics", "summary", "session_summary",
                "parent_concerns", "guidance_given", "home_activities", "follow_up", "transcript", "duration_seconds")
        result = repo.create("parent_consultations", p.org_id, {**{k: d.get(k) for k in keys}, "child_id": child,
                                                                "source": "recording_ai_approved", "created_by": p.uid})
        target = ("parent_consultations", result["id"])
    elif kind == "recording_summary":  # 8-section draft from a long recording, as edited by the therapist
        try:
            t = repo.get("stt_transcripts", p.org_id, d["job_id"])
            transcript = t.get("edited_text") or t.get("text")
        except NotFound:
            transcript = None
        result = repo.create("recording_records", p.org_id, {
            "child_id": child, "job_id": d.get("job_id"), "kind": d.get("kind", "session"), "date": d.get("date"),
            "start": d.get("start"), "end": d.get("end"), "minutes": d.get("minutes"), "counselor": d.get("counselor"),
            "sections": d.get("sections", {}), "transcript": transcript, "duration_seconds": d.get("duration_seconds"),
            "source": "recording_ai_approved", "created_by": p.uid})
        target = ("recording_records", result["id"])
    elif kind == "activity_plan":
        result = repo.create("therapy_activities", p.org_id, {"child_id": child, "payload": d,
                                                              "status": "approved", "approved_by": p.uid})
        target = ("therapy_activities", result["id"])
    else:
        raise HTTPException(422, "unknown proposal kind")
    audit(repo, p, "approve", target[0], target[1], child, via_ai=True)
    repo.update("ai_analyses", p.org_id, pid, {"status": "approved", "approved_by": p.uid, "result": target[1]})
    return {"applied_to": target[0], "id": target[1]}
