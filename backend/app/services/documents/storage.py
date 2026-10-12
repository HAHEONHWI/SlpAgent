import hashlib
import hmac
import time
from datetime import timedelta
from pathlib import Path
from urllib.parse import quote


URL_LIFETIME_SECONDS = 900


def object_key(org_id: str, child_id: str, document_id: str, extension: str) -> str:
    org = hashlib.sha256(org_id.encode()).hexdigest()[:20]
    child = hashlib.sha256(child_id.encode()).hexdigest()[:20]
    return f"documents/{org}/{child}/{document_id}.{extension}"


def write(content: bytes, key: str, content_type: str, settings) -> str:
    if settings.gcs_bucket:
        from google.cloud import storage
        blob = storage.Client().bucket(settings.gcs_bucket).blob(key)
        blob.cache_control = "private, no-store"
        blob.content_disposition = f'attachment; filename="{Path(key).name}"'
        blob.upload_from_string(content, content_type=content_type)
        return "gcs"
    if not settings.document_url_signing_key:
        raise RuntimeError("DOCUMENT_URL_SIGNING_KEY is required for local signed download URLs")
    path = Path(settings.local_documents_dir) / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return "local"


def signed_url(kind: str, key: str, document_id: str, org_id: str, settings,
               route_url: str | None = None) -> tuple[str, int]:
    expires = int(time.time()) + URL_LIFETIME_SECONDS
    if kind == "gcs":
        from google.auth import default
        from google.auth.transport.requests import Request
        from google.cloud import storage
        credentials, _ = default()
        credentials.refresh(Request())
        service_account_email = getattr(credentials, "service_account_email", None)
        if not service_account_email or not credentials.token:
            raise RuntimeError("Cloud Run service account signing access is not configured")
        blob = storage.Client().bucket(settings.gcs_bucket).blob(key)
        url = blob.generate_signed_url(expiration=timedelta(seconds=URL_LIFETIME_SECONDS), version="v4",
                                       method="GET", service_account_email=service_account_email,
                                       access_token=credentials.token)
        return url, expires
    if not settings.document_url_signing_key or not route_url:
        raise RuntimeError("local signed URL configuration is missing")
    message = f"{org_id}:{document_id}:{expires}".encode()
    signature = hmac.new(settings.document_url_signing_key.encode(), message, hashlib.sha256).hexdigest()
    return f"{route_url}?organization_id={quote(org_id)}&expires={expires}&signature={quote(signature)}", expires


def verify_local_signature(org_id: str, document_id: str, expires: int, signature: str, settings) -> bool:
    if not settings.document_url_signing_key or expires < int(time.time()) or expires > int(time.time()) + URL_LIFETIME_SECONDS:
        return False
    message = f"{org_id}:{document_id}:{expires}".encode()
    expected = hmac.new(settings.document_url_signing_key.encode(), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


def read_local(key: str, settings) -> bytes:
    root = Path(settings.local_documents_dir).resolve()
    path = (root / key).resolve()
    if root not in path.parents:
        raise FileNotFoundError(key)
    return path.read_bytes()


def delete(kind: str, key: str, settings) -> None:
    if kind == "gcs":
        from google.cloud import storage
        storage.Client().bucket(settings.gcs_bucket).blob(key).delete()
        return
    root = Path(settings.local_documents_dir).resolve()
    path = (root / key).resolve()
    if root not in path.parents:
        raise FileNotFoundError(key)
    path.unlink(missing_ok=True)
