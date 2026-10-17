"""Turn local extraction output (scripts/extract_text.py, OCR JSON) into knowledge_documents pages.
Pages that still need OCR or review are stored with their flags so search keeps them out."""
import hashlib
import json
from pathlib import Path
from .assessment_defs import DEFS

CODE_BY_SOURCE = {f: d.code for d in DEFS.values() for f in d.source_files}


def load_extracted(directory: Path) -> list[dict]:
    """Extraction JSON with `source` and `pages`; OCR output (ocr/) comes last so it replaces the
    empty needs_ocr page of the same source. Other JSON files in the folder are ignored."""
    paths = sorted(directory.glob("*.json")) + sorted((directory / "ocr").glob("*.json"))
    documents = []
    for path in paths:
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(document, dict) and isinstance(document.get("source"), str) and isinstance(document.get("pages"), list):
            documents.append(document)
    return documents


def ingest(repo, org: str, documents: list[dict], embedding_client=None, embedding_model: str = "") -> int:
    from .knowledge import _embedding
    n = 0
    for doc in documents:
        for page in doc["pages"]:
            payload = {"source": doc["source"], "page": page["page"], "test_code": CODE_BY_SOURCE.get(doc["source"]),
                       "text": page.get("text") or "", "needs_ocr": bool(page.get("needs_ocr")),
                       "needs_review": bool(page.get("needs_review")), "visibility": "org_internal"}
            if embedding_model and not payload["needs_ocr"] and not payload["needs_review"] and payload["text"]:
                payload["embedding"] = _embedding(embedding_client, embedding_model, payload["text"])
            doc_id = hashlib.sha256(f"{org}:{doc['source']}:{page['page']}".encode()).hexdigest()
            repo.create("knowledge_documents", org, payload, doc_id=doc_id)
            n += 1
    return n


def load_local_dev(repo, directory: Path, orgs: list[str]) -> int:
    """Development (memory storage) only: make local 검사 서류 searchable for the dev orgs and license their
    tests there, mirroring what a site admin grants in production."""
    documents = load_extracted(directory)
    codes = sorted({CODE_BY_SOURCE[d["source"]] for d in documents if d["source"] in CODE_BY_SOURCE})
    from ..repo.base import NotFound
    n = 0
    for org in orgs:
        try:
            current = repo.get("organizations", org, org).get("licensed_assessments") or []
            repo.update("organizations", org, org, {"licensed_assessments": sorted(set(current) | set(codes))})
        except NotFound:
            repo.create("organizations", org, {"name": "", "licensed_assessments": codes}, doc_id=org)
        n += ingest(repo, org, documents)
    return n
