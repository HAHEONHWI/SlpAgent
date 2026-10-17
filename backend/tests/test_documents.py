import io
import zipfile
from pathlib import Path
from types import SimpleNamespace as NS
from urllib.parse import urlparse
from docx import Document
from fastapi import HTTPException
from app.main import app
from app.routers import documents
from app.services.documents import hwpx
from app.services.documents.render import TITLES, render_document
from tests.conftest import H


def test_five_document_types_render_as_draft_docx():
    data = {"month": "2026-10", "organization": {"name": "Test Org"},
            "child": {"alias": "A-01", "display_name": "Test", "birth_date": "2022-01-01"},
            "sessions": [], "schedules": [], "plans": [], "consultations": [],
            "billing": {"session_count": 0, "total_minutes": 0, "voucher_minutes": None,
                        "additional_minutes": None, "total_amount": None}}
    settings = NS(pdf_font_path="", hwpx_template_path="")
    for kind in TITLES:
        content, content_type, extension = render_document(kind, "docx", data, True, settings)
        document = Document(io.BytesIO(content))
        visible_text = " ".join(paragraph.text for paragraph in document.paragraphs + document.sections[0].header.paragraphs)
        assert "초안" in visible_text
        assert TITLES[kind] in visible_text
        assert extension == "docx" and "wordprocessingml" in content_type


def test_pdf_requires_a_configured_korean_font():
    data = {"month": "2026-10", "child": {"alias": "A-01"}, "sessions": [], "billing": {}}
    try:
        render_document("service_record", "pdf", data, True, NS(pdf_font_path="", hwpx_template_path=""))
    except ValueError as error:
        assert "licensed Korean" in str(error)
    else:
        raise AssertionError("PDF generation must stop without a configured Korean font")


def test_hwpx_text_node_placeholder_replacement(tmp_path):
    source = Path(tmp_path) / "template.hwpx"
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("Contents/section0.xml", "<root><p>{{month}}</p><p>{{draft_watermark}}</p></root>")
    output = hwpx.render(str(source), {"month": "2026-10", "draft_watermark": "draft"}, {"draft_watermark"})
    with zipfile.ZipFile(io.BytesIO(output)) as archive:
        assert "2026-10" in archive.read("Contents/section0.xml").decode()
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("Contents/section0.xml", "<root><p>{{month}}</p></root>")
    try:
        hwpx.render(str(source), {"month": "2026-10", "draft_watermark": "draft"}, {"draft_watermark"})
    except hwpx.UnusableTemplate as error:
        assert "missing required tokens" in str(error)
    else:
        raise AssertionError("template without tokens must remain unverified")


def test_document_endpoints_create_draft_calculate_billing_and_approve(client, repo, child, tmp_path, monkeypatch):
    settings = NS(gcs_bucket="", local_documents_dir=str(tmp_path), document_url_signing_key="test-key",
                  pdf_font_path="", hwpx_template_path="")
    monkeypatch.setattr(documents, "get_settings", lambda: settings)
    repo.create("organizations", "orgA", {"unit_price": 40000, "voucher_minutes": 30}, doc_id="orgA")
    repo.create("therapy_sessions", "orgA", {"child_id": child["id"], "date": "2026-10-04", "start": "10:00",
                "end": "10:40", "status": "completed", "therapist": "T"})
    repo.create("therapy_sessions", "orgA", {"child_id": child["id"], "date": "2026-10-05", "start": "10:00",
                "end": "11:00", "status": "cancelled", "therapist": "T"})
    repo.create("therapy_sessions", "orgA", {"child_id": child["id"], "date": "2026-09-30", "start": "09:00",
                "end": "10:00", "status": "completed", "therapist": "T"})
    response = client.post(f"/children/{child['id']}/documents", headers=H(),
                           json={"type": "service_record", "month": "2026-10", "format": "docx"})
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "draft"
    draft_document = repo.get("generated_documents", "orgA", body["id"])
    draft_file = Path(tmp_path) / draft_document["storage_key"]
    assert draft_file.exists()
    query = urlparse(body["download_url"])
    downloaded = client.get(query.path + "?" + query.query)
    assert downloaded.status_code == 200
    document = Document(io.BytesIO(downloaded.content))
    text = " ".join(p.text for p in document.paragraphs + document.sections[0].header.paragraphs)
    table_text = " ".join(cell.text for table in document.tables for row in table.rows for cell in row.cells)
    assert "초안" in text and "40" in table_text and "10" in table_text and "40,000원" in table_text
    session_dates = [row.cells[0].text for row in document.tables[0].rows[1:]]
    assert session_dates == ["2026-10-04", "2026-10-05"]
    summary_rows = {row.cells[0].text: row.cells[1].text for row in document.tables[1].rows[1:]}
    assert summary_rows == {"총 제공시간(분)": "40", "바우처 시간(분)": "30",
                            "추가 구매 시간(분)": "10", "총 이용금액": "40,000원"}
    approved = client.post(f"/generated-documents/{body['id']}/approve", headers=H())
    assert approved.status_code == 200 and approved.json()["status"] == "approved"
    assert not approved.json()["cleanup_pending"] and not draft_file.exists()
    approved_url = urlparse(approved.json()["download_url"])
    final = client.get(approved_url.path + "?" + approved_url.query)
    final_doc = Document(io.BytesIO(final.content))
    assert all("초안" not in paragraph.text for paragraph in final_doc.paragraphs + final_doc.sections[0].header.paragraphs)
    assert repo.get("generated_documents", "orgA", body["id"])["status"] == "approved"
    assert any(row["action"] == "approve" for row in repo.list("audit_logs", "orgA"))


def test_session_without_date_is_rejected(client, child):
    response = client.post(f"/children/{child['id']}/sessions", headers=H(), json={
        "start": "10:00", "end": "10:40", "therapist": "T"})
    assert response.status_code == 422


def test_hwpx_route_reports_unverified_template(client, child, monkeypatch, tmp_path):
    monkeypatch.setattr(documents, "get_settings", lambda: NS(gcs_bucket="", local_documents_dir=str(tmp_path),
                                                               document_url_signing_key="test-key", pdf_font_path="",
                                                               hwpx_template_path=""))
    response = client.post(f"/children/{child['id']}/documents", headers=H(),
                           json={"type": "service_record", "month": "2026-10", "format": "hwpx"})
    assert response.status_code == 501 and "unverified" in response.json()["detail"]
