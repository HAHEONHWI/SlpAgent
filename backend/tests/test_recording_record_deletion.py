from types import SimpleNamespace

from app.main import app
from app.repo.base import NotFound
from app.routers.recordings import get_stt_deps
from tests.conftest import H


class Store:
    def __init__(self):
        self.deleted = []

    def delete(self, key):
        self.deleted.append(key)


def test_delete_recording_record_removes_linked_recording_data(client, repo, child):
    job = repo.create("stt_jobs", "orgA", {
        "child_id": child["id"], "status": "approved", "draft_id": "draft-1", "original_key": "original/audio.m4a",
    }, doc_id="job-1")
    chunk = repo.create("stt_chunks", "orgA", {
        "job_id": job["id"], "index": 0, "key": "tmp/audio.mp3",
    }, doc_id="chunk-1")
    repo.create("stt_transcripts", "orgA", {"child_id": child["id"], "text": "녹취 내용"}, doc_id=job["id"])
    record = repo.create("recording_records", "orgA", {
        "child_id": child["id"], "job_id": job["id"], "kind": "session", "date": "2026-11-03",
        "sections": {"goals": "회기 목표"}, "transcript": "녹취 내용",
    }, doc_id="record-1")
    repo.create("ai_analyses", "orgA", {
        "child_id": child["id"], "kind": "recording_summary", "status": "approved",
        "payload": {"job_id": job["id"]}, "result": record["id"],
    }, doc_id=job["draft_id"])
    store = Store()
    app.dependency_overrides[get_stt_deps] = lambda: SimpleNamespace(repo=repo, store=store)

    response = client.delete(f"/recording-records/{record['id']}", headers=H())

    assert response.status_code == 204
    assert store.deleted == ["tmp/audio.mp3", "original/audio.m4a"]
    for collection, doc_id in (
        ("recording_records", record["id"]), ("stt_jobs", job["id"]), ("stt_chunks", chunk["id"]),
        ("stt_transcripts", job["id"]), ("ai_analyses", job["draft_id"]),
    ):
        try:
            repo.get(collection, "orgA", doc_id)
        except NotFound:
            continue
        raise AssertionError(f"record remains: {collection}/{doc_id}")
    assert any(event["action"] == "delete_recording_record" and event["doc_id"] == record["id"]
               for event in repo.list("audit_logs", "orgA"))


def test_delete_recording_record_checks_write_role_and_child_scope(client, repo, child):
    record = repo.create("recording_records", "orgA", {
        "child_id": child["id"], "kind": "session", "date": "2026-11-03", "sections": {},
    })

    assert client.delete(f"/recording-records/{record['id']}", headers=H(role="assistant")).status_code == 403
    assert client.delete(f"/recording-records/{record['id']}", headers=H(uid="unassigned-therapist")).status_code == 404
    assert client.delete(f"/recording-records/{record['id']}", headers=H(org="orgB")).status_code == 404
    assert repo.get("recording_records", "orgA", record["id"])
