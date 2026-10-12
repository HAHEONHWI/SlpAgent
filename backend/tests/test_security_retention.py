from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace as NS
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.routing import APIRoute
from app.auth import current_principal, require_admin, require_write
from app.main import app
from app.rate_limit import RateLimitMiddleware, WindowLimiter
from app.repo.base import NotFound
from app.services.documents.storage import object_key, write
from scripts.purge_archived_children import purge
from tests.conftest import H


def _has_auth(dependency):
    if dependency.call in (current_principal, require_write, require_admin):
        return True
    return any(_has_auth(child) for child in dependency.dependencies)


def test_every_business_route_has_principal_or_signed_download():
    missing = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.include_in_schema:
            continue
        if route.path in ("/healthz", "/generated-documents/{document_id}/download"):
            continue
        if not any(_has_auth(dependency) for dependency in route.dependant.dependencies):
            missing.append(route.path)
    assert missing == []


def test_rate_limiter_returns_retry_after_and_resets():
    limiter = WindowLimiter(2, 10)
    assert limiter.check("client", now=0) == (True, 0)
    assert limiter.check("client", now=1) == (True, 0)
    allowed, retry = limiter.check("client", now=2)
    assert not allowed and retry == 8
    assert limiter.check("client", now=11) == (True, 0)


def test_rate_limit_middleware_is_observable():
    application = FastAPI()
    application.add_middleware(RateLimitMiddleware, limit=1, window_seconds=30)

    @application.get("/limited")
    def limited():
        return {"ok": True}

    client = TestClient(application)
    headers = {"Authorization": "Bearer test-token"}
    assert client.get("/limited", headers=headers).status_code == 200
    response = client.get("/limited", headers=headers)
    assert response.status_code == 429 and int(response.headers["Retry-After"]) > 0


def test_audit_query_is_admin_only_and_org_scoped(client, repo):
    repo.create("audit_logs", "orgA", {"action": "create", "child_id": "a"})
    repo.create("audit_logs", "orgB", {"action": "create", "child_id": "b"})
    assert client.get("/admin/audit-logs").status_code == 401
    assert client.get("/admin/audit-logs", headers=H(role="therapist")).status_code == 403
    response = client.get("/admin/audit-logs?child_id=a", headers=H(role="admin"))
    assert response.status_code == 200
    assert all(row["organization_id"] == "orgA" and row["child_id"] == "a" for row in response.json())


def test_retention_dry_run_and_permanent_delete_are_org_scoped(repo, tmp_path):
    old = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    child = repo.create("children", "orgA", {"alias": "A-01", "archived": True, "archived_at": old})
    doc = repo.create("assessments", "orgA", {"child_id": child["id"], "test_code": "PRES"})
    repo.create("children", "orgB", {"alias": "B-01", "archived": True, "archived_at": old})
    event = repo.create("audit_logs", "orgA", {"child_id": child["id"], "doc_id": doc["id"], "action": "create"})
    conversation = repo.create("chat_conversations", "orgA", {"child_id": child["id"]})
    message = repo.create("chat_messages", "orgA", {"conversation_id": conversation["id"], "content": "private"})
    settings = NS(gcs_bucket="", local_documents_dir=str(tmp_path), document_url_signing_key="test-key")
    key = object_key("orgA", child["id"], "generated", "docx")
    write(b"private file", key, "application/octet-stream", settings)
    generated = repo.create("generated_documents", "orgA", {"child_id": child["id"], "storage_kind": "local",
                                                              "storage_key": key})
    assert purge(repo, "orgA", 30, settings=settings) == [child["id"]]
    assert repo.get("children", "orgA", child["id"])
    purged = purge(repo, "orgA", 30, apply=True, settings=settings)
    assert purged == [child["id"]]
    for collection, doc_id in (("children", child["id"]), ("assessments", doc["id"]),
                               ("chat_messages", message["id"]), ("chat_conversations", conversation["id"]),
                               ("generated_documents", generated["id"])):
        try:
            repo.get(collection, "orgA", doc_id)
        except NotFound:
            pass
        else:
            raise AssertionError(f"record remains: {collection}/{doc_id}")
    assert not (Path(tmp_path) / key).exists()
    assert repo.get("audit_logs", "orgA", event["id"])["child_id"] is None
    assert len(repo.list("children", "orgB")) == 1
    assert any(row["action"] == "permanent_delete" for row in repo.list("audit_logs", "orgA"))


def test_swagger_authorize_scheme_and_docs_hidden_in_production(client, monkeypatch):
    spec = client.get("/openapi.json").json()
    assert any(v.get("scheme") == "bearer" for v in spec["components"]["securitySchemes"].values())
    import importlib, app.config as config, app.main as main
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("AUTH_MODE", "firebase")
    monkeypatch.setenv("STORAGE_BACKEND", "firestore")
    config.get_settings.cache_clear()
    try:
        prod = importlib.reload(main).app
        assert prod.docs_url is None and prod.openapi_url is None
    finally:
        monkeypatch.undo()
        config.get_settings.cache_clear()
        importlib.reload(main)
