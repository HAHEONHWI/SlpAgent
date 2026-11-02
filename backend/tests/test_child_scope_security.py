"""Therapists reach only their own 담당 아동, also through routes addressed by a record's own id."""
import pytest
from app.services.privacy import sanitize_external_text
from tests.conftest import H, THERAPIST


@pytest.fixture
def other(client, repo):
    """A child of another therapist (u2, linked in the 치료사 목록 by its unique name)."""
    repo.create("users", "orgA", {"uid": "u2", "email": "u2@example.com", "name": "다른치료사", "role": "therapist"}, doc_id="u2")
    r = client.post("/children", json={"alias": "B-01", "display_name": "다른아동", "birth_date": "2021-05-01",
                                       "therapist": "다른치료사"}, headers=H(role="admin", uid="admin"))
    assert r.status_code == 201
    return r.json()


def test_same_name_account_does_not_inherit_children(client, repo, child):
    # an approved applicant who chose the existing therapist's name, not linked to a 치료사 목록 entry
    repo.create("users", "orgA", {"uid": "u3", "email": "u3@example.com", "name": THERAPIST, "role": "therapist"}, doc_id="u3")
    assert client.get("/children", headers=H(uid="u3")).json() == []
    assert client.get(f"/children/{child['id']}/sessions", headers=H(uid="u3")).status_code == 404
    assert [c["id"] for c in client.get("/children", headers=H()).json()] == [child["id"]]


def test_id_addressed_routes_hide_other_therapists_children(client, repo, child, other, tmp_path, monkeypatch):
    from types import SimpleNamespace as NS
    from app.routers import documents
    # signed download links need a key; don't depend on a developer's local .env
    monkeypatch.setattr(documents, "get_settings", lambda: NS(gcs_bucket="", local_documents_dir=str(tmp_path),
                                                              document_url_signing_key="test-key", pdf_font_path="", hwpx_template_path=""))
    oid = other["id"]
    doc = repo.create("generated_documents", "orgA", {"child_id": oid, "doc_type": "monthly", "format": "pdf", "status": "draft",
                                                      "storage_key": "k", "storage_kind": "local", "source_data": {}})
    assert client.post(f"/generated-documents/{doc['id']}/link", headers=H()).status_code == 404
    assert client.post(f"/generated-documents/{doc['id']}/approve", headers=H()).status_code == 404

    session = repo.create("therapy_sessions", "orgA", {"child_id": oid, "date": "2026-10-01"})
    assert client.post(f"/sessions/{session['id']}/note", headers=H(), json={"text": "x"}).status_code == 404

    draft = repo.create("ai_analyses", "orgA", {"kind": "session_note", "child_id": oid, "status": "draft",
                                                "payload": {"session_id": session["id"], "text": "x"}})
    assert client.put(f"/proposals/{draft['id']}", headers=H(), json={"payload": {"text": "y"}}).status_code == 404
    assert client.post(f"/proposals/{draft['id']}/approve", headers=H()).status_code == 404
    assert client.post(f"/proposals/{draft['id']}/reject", headers=H()).status_code == 404
    assert repo.list("session_notes", "orgA") == []
    assert repo.get("ai_analyses", "orgA", draft["id"])["status"] == "draft"

    plan = repo.create("treatment_plans", "orgA", {"child_id": oid, "version": 1, "status": "draft", "goals": []})
    assert client.post(f"/plans/{plan['id']}/approve", headers=H()).status_code == 404
    assert repo.get("treatment_plans", "orgA", plan["id"])["status"] == "draft"

    sched = repo.create("schedules", "orgA", {"child_id": oid, "date": "2026-10-05", "start": "10:00", "end": "10:40",
                                              "therapist": "다른치료사", "status": "scheduled"})
    assert client.post(f"/schedules/{sched['id']}/cancel", headers=H()).status_code == 404
    assert repo.get("schedules", "orgA", sched["id"])["status"] == "scheduled"

    entry = repo.create("timetable_entries", "orgA", {"day": 1, "slot": "10:00", "teacher_id": "t2", "child_id": oid})
    body = {"day": 1, "slot": "10:00", "teacher_id": "t1", "child_id": child["id"]}  # re-pointing to one's own child
    assert client.put(f"/timetable/entries/{entry['id']}", headers=H(), json=body).status_code == 404
    assert client.delete(f"/timetable/entries/{entry['id']}", headers=H()).status_code == 404
    assert repo.get("timetable_entries", "orgA", entry["id"])["child_id"] == oid

    # the 담당 치료사 and admins still can
    assert client.post(f"/generated-documents/{doc['id']}/link", headers=H(uid="u2")).status_code == 200
    assert client.post(f"/sessions/{session['id']}/note", headers=H(uid="u2"), json={"text": "x"}).status_code == 201
    assert client.post(f"/proposals/{draft['id']}/reject", headers=H(uid="u2")).status_code == 200
    assert client.post(f"/schedules/{sched['id']}/cancel", headers=H(uid="u2")).status_code == 200
    assert client.post(f"/plans/{plan['id']}/approve", headers=H(role="admin", uid="admin")).status_code == 200
    assert client.delete(f"/timetable/entries/{entry['id']}", headers=H(role="admin", uid="admin")).status_code == 204


def test_proposal_edit_keeps_linked_session_and_job(client, repo, child):
    draft = repo.create("ai_analyses", "orgA", {"kind": "session_note", "child_id": child["id"], "status": "draft",
                                                "payload": {"session_id": "s-own", "text": "x"}})
    r = client.put(f"/proposals/{draft['id']}", headers=H(), json={"payload": {"session_id": "s-other", "job_id": "j", "text": "y"}})
    assert r.status_code == 200
    assert r.json()["payload"] == {"session_id": "s-own", "text": "y"}


def test_known_names_are_masked_in_any_case():
    out = sanitize_external_text("JANE DOE and jane doe and Jane Doe", ["Jane Doe"])
    assert out == "[개인정보] and [개인정보] and [개인정보]"
    assert sanitize_external_text("a.b 테스트아동", ["a.b", "테스트아동"]) == "[개인정보] [개인정보]"
