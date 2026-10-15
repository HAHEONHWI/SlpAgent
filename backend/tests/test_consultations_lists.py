import io
from types import SimpleNamespace as NS
from urllib.parse import urlparse
from docx import Document
from app.routers import documents
from tests.conftest import H


def _consultation(**overrides):
    body = {"date": "2026-10-07", "start": "15:00", "end": "15:30", "counselor": "치료사T",
            "participants": ["어머니"], "topics": ["가정 연계"], "summary": "가정 내 놀이 상황 공유",
            "guidance_given": "선택 질문 사용 안내", "follow_up": "다음 회기에 확인"}
    return {**body, **overrides}


def test_create_and_list_consultations(client, repo, child):
    later = client.post(f"/children/{child['id']}/consultations", headers=H(), json=_consultation(date="2026-10-20"))
    assert later.status_code == 201
    body = later.json()
    assert body["minutes"] == 30 and body["child_id"] == child["id"] and body["organization_id"] == "orgA"
    assert body["id"] and body["created_at"] and body["participants"] == ["어머니"]
    earlier = client.post(f"/children/{child['id']}/consultations", headers=H(),
                          json=_consultation(date="2026-10-01", start=None, end=None, guidance_given=None))
    assert earlier.status_code == 201 and earlier.json()["minutes"] is None
    listed = client.get(f"/children/{child['id']}/consultations", headers=H("orgA", "assistant", "u2"))
    assert listed.status_code == 200
    assert [row["date"] for row in listed.json()] == ["2026-10-01", "2026-10-20"]
    assert any(row["action"] == "create" and row["collection"] == "parent_consultations"
               for row in repo.list("audit_logs", "orgA"))


def test_consultation_validation(client, child):
    url = f"/children/{child['id']}/consultations"
    assert client.post(url, headers=H(), json=_consultation(end=None)).status_code == 422
    assert client.post(url, headers=H(), json=_consultation(start=None)).status_code == 422
    assert client.post(url, headers=H(), json=_consultation(start="15:30", end="15:00")).status_code == 422
    assert client.post(url, headers=H(), json=_consultation(summary="")).status_code == 422
    assert client.post(url, headers=H(), json=_consultation(summary="   ")).status_code == 422


def test_assistant_cannot_create_consultation(client, repo, child):
    response = client.post(f"/children/{child['id']}/consultations", headers=H("orgA", "assistant", "u2"),
                           json=_consultation())
    assert response.status_code == 403
    assert repo.list("parent_consultations", "orgA") == []


def test_consultation_rejects_invalid_child_detail_fields(client, child):
    url = f"/children/{child['id']}/consultations"
    assert client.post(url, headers=H(), json=_consultation(session_summary="x" * 10001)).status_code == 422
    assert client.post(url, headers=H(), json=_consultation(parent_concerns="목록이 아닌 문자열")).status_code == 422
    assert client.post(url, headers=H(), json=_consultation(home_activities="목록이 아닌 문자열")).status_code == 422


def test_parent_consultation_document_uses_consultation_fields(client, child, tmp_path, monkeypatch):
    monkeypatch.setattr(documents, "get_settings", lambda: NS(gcs_bucket="", local_documents_dir=str(tmp_path),
                                                               document_url_signing_key="test-key", pdf_font_path="",
                                                               hwpx_template_path=""))
    client.post(f"/children/{child['id']}/consultations", headers=H(), json=_consultation())
    created = client.post(f"/children/{child['id']}/documents", headers=H(),
                          json={"type": "parent_consultation", "month": "2026-10", "format": "docx"})
    assert created.status_code == 201
    url = urlparse(created.json()["download_url"])
    document = Document(io.BytesIO(client.get(url.path + "?" + url.query).content))
    cells = [cell.text for table in document.tables for row in table.rows for cell in row.cells]
    for expected in ("2026-10-07", "15:00-15:30", "치료사T", "어머니", "가정 연계", "가정 내 놀이 상황 공유",
                     "선택 질문 사용 안내", "다음 회기에 확인"):
        assert expected in cells


def test_document_list_and_link(client, repo, child, tmp_path, monkeypatch):
    monkeypatch.setattr(documents, "get_settings", lambda: NS(gcs_bucket="", local_documents_dir=str(tmp_path),
                                                               document_url_signing_key="test-key", pdf_font_path="",
                                                               hwpx_template_path=""))
    first = client.post(f"/children/{child['id']}/documents", headers=H(),
                        json={"type": "service_record", "month": "2026-09", "format": "docx"}).json()
    second = client.post(f"/children/{child['id']}/documents", headers=H(),
                         json={"type": "schedule", "month": "2026-10", "format": "docx"}).json()
    listed = client.get(f"/children/{child['id']}/documents", headers=H("orgA", "assistant", "u2"))
    assert listed.status_code == 200
    rows = listed.json()
    assert [row["id"] for row in rows] == [second["id"], first["id"]]
    assert set(rows[0]) == {"id", "type", "month", "format", "status", "created_at", "approved_at", "hwpx_validation"}
    assert rows[0]["type"] == "schedule" and rows[0]["status"] == "draft"

    link = client.post(f"/generated-documents/{first['id']}/link", headers=H("orgA", "assistant", "u2"))
    assert link.status_code == 200 and set(link.json()) == {"download_url", "expires_at"}
    url = urlparse(link.json()["download_url"])
    downloaded = client.get(url.path + "?" + url.query)
    assert downloaded.status_code == 200 and downloaded.content[:2] == b"PK"
    assert any(row["action"] == "read" and row["doc_id"] == first["id"] for row in repo.list("audit_logs", "orgA"))

    assert client.post(f"/generated-documents/{first['id']}/link", headers=H("orgB")).status_code == 404
    assert client.post("/generated-documents/missing/link", headers=H()).status_code == 404


def test_approved_analyses_and_activities_lists(client, repo, child):
    other = client.post("/children", headers=H(), json={"alias": "A-02", "display_name": "다른아동",
                                                         "birth_date": "2022-01-01"}).json()
    repo.create("clinical_analyses", "orgA", {"child_id": child["id"], "kind": "integrated_analysis",
                                              "payload": {"summary": "a"}, "status": "approved", "approved_by": "u1"})
    repo.create("clinical_analyses", "orgA", {"child_id": child["id"], "kind": "behavior_analysis",
                                              "payload": {"summary": "b"}, "status": "approved", "approved_by": "u1"})
    repo.create("clinical_analyses", "orgA", {"child_id": child["id"], "kind": "integrated_analysis",
                                              "payload": {}, "status": "draft"})
    repo.create("clinical_analyses", "orgA", {"child_id": other["id"], "kind": "integrated_analysis",
                                              "payload": {}, "status": "approved", "approved_by": "u1"})
    repo.create("therapy_activities", "orgA", {"child_id": child["id"], "payload": {"title": "x"},
                                               "status": "approved", "approved_by": "u1"})
    repo.create("therapy_activities", "orgA", {"child_id": child["id"], "payload": {}, "status": "draft"})
    repo.create("therapy_activities", "orgA", {"child_id": other["id"], "payload": {}, "status": "approved"})

    analyses = client.get(f"/children/{child['id']}/clinical-analyses", headers=H("orgA", "assistant", "u2")).json()
    assert sorted(row["kind"] for row in analyses) == ["behavior_analysis", "integrated_analysis"]
    assert set(analyses[0]) == {"id", "kind", "payload", "approved_by", "created_at"}
    filtered = client.get(f"/children/{child['id']}/clinical-analyses?kind=behavior_analysis", headers=H()).json()
    assert [row["payload"] for row in filtered] == [{"summary": "b"}]
    assert client.get(f"/children/{child['id']}/clinical-analyses?kind=bogus", headers=H()).status_code == 422
    activities = client.get(f"/children/{child['id']}/therapy-activities", headers=H()).json()
    assert [row["payload"] for row in activities] == [{"title": "x"}]
    assert set(activities[0]) == {"id", "payload", "approved_by", "created_at"}


def test_other_org_gets_404_on_new_routes(client, child):
    other = H("orgB")
    cid = child["id"]
    assert client.post(f"/children/{cid}/consultations", headers=other, json=_consultation()).status_code == 404
    for path in ("consultations", "documents", "clinical-analyses", "therapy-activities"):
        assert client.get(f"/children/{cid}/{path}", headers=other).status_code == 404
