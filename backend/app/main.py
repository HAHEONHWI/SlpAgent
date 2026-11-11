from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .auth import require_site_admin
from .config import get_settings
from .repo.base import NotFound
from .repo.request_cache import FirestoreReadCacheMiddleware
from .routers import admin, analysis, attendance, recordings, chat as ai_dialogue, children, consultations, documents, knowledge, org, plans, platform, proposals, records, schedules, timetable, voucher_doc, notices, class_records, settlement
from .rate_limit import RateLimitMiddleware

# API docs (Swagger UI /docs, /openapi.json) are for development; production does not expose them.
_docs = get_settings().env != "production"
app = FastAPI(title="SLP Agent API", docs_url="/docs" if _docs else None, redoc_url=None,
              openapi_url="/openapi.json" if _docs else None)


class StripApiPrefix:
    """Firebase Hosting forwards /api/** to Cloud Run unchanged; routes are defined without the prefix."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            if path == "/api" or path.startswith("/api/"):
                scope = {**scope, "path": path[4:] or "/", "raw_path": (path[4:] or "/").encode()}
        await self.app(scope, receive, send)


app.add_middleware(RateLimitMiddleware, limit=get_settings().rate_limit_address_requests,
                   window_seconds=get_settings().rate_limit_window_seconds)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins.split(","),
                   allow_methods=["*"], allow_headers=["*"])
class NoStoreApiResponses:
    """API responses are per-user and must never be cached by the Firebase Hosting CDN (it would otherwise
    cache e.g. 404s for 10 minutes across deploys). Endpoints that set Cache-Control keep their own value."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_header(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                if not any(k.lower() == b"cache-control" for k, _ in headers):
                    headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)
        await self.app(scope, receive, send_with_header)


app.add_middleware(NoStoreApiResponses)
app.add_middleware(FirestoreReadCacheMiddleware)
app.add_middleware(StripApiPrefix)  # added last = outermost, so rate limiting and CORS see the real path
for r in (children.router, records.router, plans.router, proposals.router, ai_dialogue.router, org.router,
          schedules.router, knowledge.router, analysis.router, documents.router, consultations.router, admin.router, platform.router, attendance.router, recordings.router, timetable.router, voucher_doc.router, notices.router, class_records.router, settlement.router):
    app.include_router(r)


@app.exception_handler(NotFound)
async def _nf(_: Request, __):
    return JSONResponse({"detail": "not found"}, status_code=404)


# Production has no public /docs or /openapi.json; site admins read the spec through the platform screen.
@app.get("/platform/openapi.json", include_in_schema=False, dependencies=[Depends(require_site_admin)])
def platform_openapi():
    return app.openapi()


@app.get("/healthz")
def health():
    return {"ok": True}


if get_settings().dev_seed and get_settings().env == "development" and get_settings().storage_backend == "memory":
    from .deps import get_repo
    from .dev_seed import seed
    seed(get_repo())

_settings = get_settings()
if _settings.local_knowledge_dir and _settings.env == "development" and _settings.storage_backend == "memory":
    from pathlib import Path
    from .deps import get_repo
    from .services.knowledge_ingest import load_local_dev
    _dir = Path(_settings.local_knowledge_dir)
    _dir = _dir if _dir.is_absolute() else Path(__file__).resolve().parents[1] / _dir
    load_local_dev(get_repo(), _dir, [o.strip() for o in _settings.local_knowledge_orgs.split(",") if o.strip()])
