from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .config import get_settings
from .repo.base import NotFound
from .routers import admin, analysis, chat, children, documents, knowledge, org, plans, proposals, records, schedules
from .rate_limit import RateLimitMiddleware

app = FastAPI(title="SLP Agent API")
app.add_middleware(RateLimitMiddleware, limit=get_settings().rate_limit_requests,
                   window_seconds=get_settings().rate_limit_window_seconds)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins.split(","),
                   allow_methods=["*"], allow_headers=["*"])
for r in (children.router, records.router, plans.router, proposals.router, chat.router, org.router,
          schedules.router, knowledge.router, analysis.router, documents.router, admin.router):
    app.include_router(r)


@app.exception_handler(NotFound)
async def _nf(_: Request, __):
    return JSONResponse({"detail": "not found"}, status_code=404)


@app.get("/healthz")
def health():
    return {"ok": True}


if get_settings().dev_seed and get_settings().env == "development" and get_settings().storage_backend == "memory":
    from .deps import get_repo
    from .dev_seed import seed
    seed(get_repo())
