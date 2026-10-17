from collections import defaultdict
from fastapi import APIRouter, Depends
from ..auth import Principal, current_principal
from ..deps import get_repo
from ..services import knowledge as kn

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.get("/documents")
def documents(p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    by: dict[str, dict] = defaultdict(lambda: {"pages": 0, "needs_ocr_pages": 0, "excluded_pages": 0, "test_code": None})
    for d in repo.list("knowledge_documents", p.org_id):
        e = by[d["source"]]
        e["pages"] += 1
        e["needs_ocr_pages"] += bool(d.get("needs_ocr"))
        # same exclusion rule as knowledge.search: unreadable or unreviewed pages are never retrieved
        e["excluded_pages"] += bool(d.get("needs_ocr") or d.get("needs_review") or not d.get("text"))
        e["test_code"] = d.get("test_code")
    return [{"source": k, **v, "status": "ocr_required" if v["excluded_pages"] == v["pages"] else "partial" if v["excluded_pages"] else "text_ok"}
            for k, v in sorted(by.items())]


@router.get("/search")
def search(q: str, test_code: str | None = None, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    return kn.search(repo, p.org_id, q, test_code)  # org-internal viewing only; snippets capped in service
