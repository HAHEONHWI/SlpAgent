"""Permanent deletion of a child and everything linked to it. Used by the retention script and by the
admin's explicit 영구 삭제; audit events keep the action but lose the link to the child."""
import hashlib
from .documents import storage

CHILD_COLLECTIONS = (
    "assessments", "behavior_observations", "vocabulary_records", "therapy_sessions",
    "session_notes", "treatment_plans", "schedules", "parent_consultations", "ai_analyses",
    "clinical_analyses", "therapy_activities", "generated_documents",
    "stt_jobs", "stt_chunks", "stt_transcripts", "recording_records", "attendance", "timetable_entries",
)


def purge_child(repo, org_id: str, child_id: str, actor: str, role: str, settings=None, **detail) -> None:
    for collection in CHILD_COLLECTIONS:
        for document in repo.list(collection, org_id, child_id=child_id):
            if collection == "generated_documents" and settings:
                for key in (document.get("storage_key"), document.get("cleanup_storage_key")):
                    if key:
                        storage.delete(document["storage_kind"], key, settings)
            repo.delete(collection, org_id, document["id"])
    for conversation in repo.list("chat_conversations", org_id, child_id=child_id):
        for message in repo.list("chat_messages", org_id, conversation_id=conversation["id"]):
            repo.delete("chat_messages", org_id, message["id"])
        repo.delete("chat_conversations", org_id, conversation["id"])
    for event in repo.list("audit_logs", org_id, child_id=child_id):
        repo.update("audit_logs", org_id, event["id"], {"child_id": None, "doc_id": "purged"})
    repo.delete("children", org_id, child_id)
    repo.create("audit_logs", org_id, {
        "actor": actor, "role": role, "action": "permanent_delete",
        "collection": "children", "doc_id": hashlib.sha256(child_id.encode()).hexdigest()[:16],
        "child_id": None, **detail,
    })
