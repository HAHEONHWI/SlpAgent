import argparse
import hashlib
from datetime import datetime, timedelta, timezone
from app.config import get_settings
from app.deps import get_repo
from app.services.documents import storage


CHILD_COLLECTIONS = (
    "assessments", "behavior_observations", "vocabulary_records", "therapy_sessions",
    "session_notes", "treatment_plans", "schedules", "parent_consultations", "ai_analyses",
    "clinical_analyses", "therapy_activities", "generated_documents",
    "stt_jobs", "stt_chunks", "stt_transcripts", "recording_records", "attendance",
)


def purge(repo, org_id: str, retention_days: int, apply: bool = False, settings=None) -> list[str]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    candidates = []
    for child in repo.list("children", org_id, archived=True):
        try:
            archived_at = datetime.fromisoformat(child["archived_at"].replace("Z", "+00:00"))
        except (KeyError, TypeError, ValueError):
            continue
        if archived_at.tzinfo is None:
            archived_at = archived_at.replace(tzinfo=timezone.utc)
        if archived_at > cutoff:
            continue
        child_id = child["id"]
        candidates.append(child_id)
        if not apply:
            continue
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
            "actor": "retention-job", "role": "system", "action": "permanent_delete",
            "collection": "children", "doc_id": hashlib.sha256(child_id.encode()).hexdigest()[:16],
            "child_id": None, "retention_days": retention_days,
        })
    return candidates


def main() -> None:
    parser = argparse.ArgumentParser(description="Permanently delete archived child records after an approved retention period.")
    parser.add_argument("--org-id", required=True)
    parser.add_argument("--retention-days", required=True, type=int)
    parser.add_argument("--apply", action="store_true", help="permanently delete eligible records")
    args = parser.parse_args()
    if args.retention_days < 1:
        parser.error("--retention-days must be at least 1")
    settings = get_settings()
    repo = get_repo()
    candidates = purge(repo, args.org_id, args.retention_days, args.apply, settings)
    print(f"eligible archived children: {len(candidates)}")
    if args.apply:
        print(f"permanently deleted: {len(candidates)}")
    else:
        print("dry run; pass --apply to permanently delete records")


if __name__ == "__main__":
    main()
