import argparse
import pathlib
from app.deps import get_repo
from app.config import get_settings
from app.services.knowledge_ingest import ingest, load_extracted

parser = argparse.ArgumentParser()
parser.add_argument("org_id")
parser.add_argument("extracted_dir")
parser.add_argument("--allow-reference-text-upload", action="store_true",
                    help="allow derived reference text to be written to a remote repository")
args = parser.parse_args()
settings = get_settings()
if settings.storage_backend != "memory" and not args.allow_reference_text_upload:
    raise SystemExit("remote reference text storage is disabled; pass --allow-reference-text-upload only after rights review")
client = None
if settings.openai_embedding_model and settings.openai_allow_reference_embedding_upload:
    if not settings.openai_api_key:
        raise SystemExit("OPENAI_API_KEY is required when OPENAI_EMBEDDING_MODEL is configured")
    from openai import OpenAI
    client = OpenAI(api_key=settings.openai_api_key)

documents = load_extracted(pathlib.Path(args.extracted_dir))
n = ingest(get_repo(), args.org_id, documents, client, settings.openai_embedding_model if client else "")
print(f"ingested {n} pages for {args.org_id}")
