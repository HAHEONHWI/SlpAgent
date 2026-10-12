import hashlib
import json
import pathlib
import sys
import argparse
from app.deps import get_repo
from app.config import get_settings
from app.services.assessment_defs import DEFS
from app.services.knowledge import _embedding


def _item_ids_by_source() -> dict[tuple[str, int], list[str]]:
    base = pathlib.Path(__file__).resolve().parents[1] / "app" / "data" / "assessments"
    result = {}
    for path in base.glob("*.json"):
        bank = json.loads(path.read_text(encoding="utf-8"))
        for item in bank.get("items", []):
            source = item.get("source", {})
            key = (source.get("file"), source.get("page"))
            result.setdefault(key, []).append(item["item_id"])
    return result


def ingest(repo, org: str, documents: list[dict], item_ids: dict[tuple[str, int], list[str]],
           embedding_client=None, embedding_model: str = "") -> int:
    n = 0
    for doc in documents:
        code = BY_FILE.get(doc["source"])
        for page in doc["pages"]:
            payload = {"source": doc["source"], "page": page["page"], "test_code": code,
                       "text": page.get("text", ""), "needs_ocr": bool(page.get("needs_ocr")),
                       "needs_review": bool(page.get("needs_review")), "visibility": "org_internal",
                       "item_ids": item_ids.get((doc["source"], page["page"]), [])}
            if embedding_model and not payload["needs_ocr"] and not payload["needs_review"] and payload["text"]:
                payload["embedding"] = _embedding(embedding_client, embedding_model, payload["text"])
            doc_id = hashlib.sha256(f"{org}:{doc['source']}:{page['page']}".encode()).hexdigest()
            repo.create("knowledge_documents", org, payload, doc_id=doc_id)
            n += 1
    return n


parser = argparse.ArgumentParser()
parser.add_argument("org_id")
parser.add_argument("extracted_dir")
parser.add_argument("--allow-reference-text-upload", action="store_true",
                    help="allow derived reference text to be written to a remote repository")
args = parser.parse_args()
org, src = args.org_id, pathlib.Path(args.extracted_dir)
by_file = {f: d.code for d in DEFS.values() for f in d.source_files}
BY_FILE = by_file
settings = get_settings()
if settings.storage_backend != "memory" and not args.allow_reference_text_upload:
    raise SystemExit("remote reference text storage is disabled; pass --allow-reference-text-upload only after rights review")
client = None
if settings.openai_embedding_model and settings.openai_allow_reference_embedding_upload:
    if not settings.openai_api_key:
        raise SystemExit("OPENAI_API_KEY is required when OPENAI_EMBEDDING_MODEL is configured")
    from openai import OpenAI
    client = OpenAI(api_key=settings.openai_api_key)

paths = sorted(src.glob("*.json")) + sorted((src / "ocr").glob("*.json"))
documents = [json.loads(path.read_text(encoding="utf-8")) for path in paths]
repo = get_repo()
n = ingest(repo, org, documents, _item_ids_by_source(), client, settings.openai_embedding_model)
print(f"ingested {n} pages for {org}")
