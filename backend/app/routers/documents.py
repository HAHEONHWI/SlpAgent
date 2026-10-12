import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from ..auth import Principal, require_write
from ..config import get_settings
from ..deps import audit, child_or_404, get_repo
from ..repo.base import NotFound
from ..services import billing
from ..services.documents import DocumentFontNotConfigured, render_document
from ..services.documents import hwpx, storage


router = APIRouter(tags=["documents"])


class DocumentIn(BaseModel):
    type: str = Field(pattern=r"^(service_record|schedule|progress_report|assessment_summary|parent_consultation)$")
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    format: str = Field(pattern=r"^(docx|pdf|hwpx)$")


def _data(repo, principal: Principal, child_id: str, month: str) -> dict:
    record = child_or_404(repo, principal, child_id)
    child = {key: record.get(key) for key in ("id", "alias", "display_name", "birth_date")}
    sessions = [row for row in repo.list("therapy_sessions", principal.org_id, child_id=child_id)
                if row["date"].startswith(month)]
    try:
        org = repo.get("organizations", principal.org_id, principal.org_id)
    except NotFound:
        org = {}
    summary = billing.monthly_summary(sessions, org.get("unit_price"), org.get("voucher_minutes"))
    schedules = [row for row in repo.list("schedules", principal.org_id, child_id=child_id)
                 if row["date"].startswith(month)]
    plans = repo.list("treatment_plans", principal.org_id, child_id=child_id)
    assessments = repo.list("assessments", principal.org_id, child_id=child_id)
    consultations = [row for row in repo.list("parent_consultations", principal.org_id, child_id=child_id)
                     if row.get("date", "").startswith(month)]
    return {"child": child, "organization": {"name": org.get("name")}, "month": month, "sessions": sessions, "schedules": schedules,
            "plans": plans, "assessments": assessments, "consultations": consultations, "billing": summary}


def _render(kind: str, format: str, data: dict, draft: bool, settings) -> tuple[bytes, str, str]:
    try:
        return render_document(kind, format, data, draft, settings)
    except DocumentFontNotConfigured as error:
        raise HTTPException(503, str(error))
    except hwpx.UnusableTemplate as error:
        raise HTTPException(501, f"HWPX generation is unverified: {error}")


def _signed_url(request: Request, document: dict, settings) -> tuple[str, int]:
    route_url = str(request.url_for("download_document", document_id=document["id"]))
    try:
        return storage.signed_url(document["storage_kind"], document["storage_key"], document["id"],
                                  document["organization_id"], settings, route_url)
    except RuntimeError as error:
        raise HTTPException(503, str(error))


@router.post("/children/{child_id}/documents", status_code=201)
def create_document(child_id: str, body: DocumentIn, request: Request,
                    p: Principal = Depends(require_write), repo=Depends(get_repo)):
    data = _data(repo, p, child_id, body.month)
    settings = get_settings()
    content, content_type, extension = _render(body.type, body.format, data, True, settings)
    document_id = uuid.uuid4().hex
    key = storage.object_key(p.org_id, child_id, document_id, extension)
    try:
        storage_kind = storage.write(content, key, content_type, settings)
    except RuntimeError as error:
        raise HTTPException(503, str(error))
    document = repo.create("generated_documents", p.org_id, {
        "child_id": child_id, "doc_type": body.type, "month": body.month, "format": body.format,
        "status": "draft", "storage_kind": storage_kind, "storage_key": key,
        "content_type": content_type, "source_data": data,
        "hwpx_validation": "unverified_hancom" if body.format == "hwpx" else None,
    }, doc_id=document_id)
    audit(repo, p, "create", "generated_documents", document_id, child_id)
    url, expires = _signed_url(request, document, settings)
    return {"id": document_id, "type": body.type, "month": body.month, "format": body.format,
            "status": "draft", "download_url": url, "expires_at": datetime.fromtimestamp(expires, timezone.utc).isoformat(),
            "hwpx_validation": document.get("hwpx_validation")}


@router.post("/generated-documents/{document_id}/approve")
def approve_document(document_id: str, request: Request, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    try:
        document = repo.get("generated_documents", p.org_id, document_id)
    except NotFound:
        raise HTTPException(404, "document not found")
    if not p.can_approve:
        raise HTTPException(403, "therapist approval required")
    if document.get("status") != "draft":
        raise HTTPException(409, f"document is {document.get('status')}")
    settings = get_settings()
    content, content_type, extension = _render(document["doc_type"], document["format"], document["source_data"], False, settings)
    previous_key = document["storage_key"]
    approved_key = storage.object_key(p.org_id, document["child_id"], f"{document_id}-approved", extension)
    try:
        storage.write(content, approved_key, content_type, settings)
    except RuntimeError as error:
        raise HTTPException(503, str(error))
    try:
        updated = repo.update("generated_documents", p.org_id, document_id,
                              {"status": "approved", "storage_key": approved_key, "content_type": content_type,
                               "approved_by": p.uid, "approved_at": datetime.now(timezone.utc).isoformat()})
    except Exception:
        storage.delete(document["storage_kind"], approved_key, settings)
        raise
    cleanup_pending = False
    try:
        storage.delete(document["storage_kind"], previous_key, settings)
    except Exception:
        cleanup_pending = True
        updated = repo.update("generated_documents", p.org_id, document_id, {"cleanup_storage_key": previous_key})
    audit(repo, p, "approve", "generated_documents", document_id, document["child_id"])
    url, expires = _signed_url(request, updated, get_settings())
    return {"id": document_id, "status": "approved", "download_url": url, "cleanup_pending": cleanup_pending,
            "expires_at": datetime.fromtimestamp(expires, timezone.utc).isoformat()}


@router.get("/generated-documents/{document_id}/download", name="download_document")
def download_document(document_id: str, organization_id: str, expires: int, signature: str, repo=Depends(get_repo)):
    settings = get_settings()
    if not storage.verify_local_signature(organization_id, document_id, expires, signature, settings):
        raise HTTPException(403, "invalid or expired document URL")
    try:
        document = repo.get("generated_documents", organization_id, document_id)
    except NotFound:
        raise HTTPException(404, "document not found")
    if document.get("storage_kind") != "local":
        raise HTTPException(404, "document not found")
    try:
        content = storage.read_local(document["storage_key"], settings)
    except OSError:
        raise HTTPException(404, "document file not found")
    return Response(content, media_type=document["content_type"],
                    headers={"Content-Disposition": f'attachment; filename="{document_id}.{document["format"]}"',
                             "Cache-Control": "private, no-store"})
