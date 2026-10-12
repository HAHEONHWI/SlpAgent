# Project instructions

## Project

SLP Agent is a Korean-language assistant for speech-language therapists. Backend is FastAPI; `Repo` supports memory and Firestore. Every stored document carries `organization_id` and child-scoped records carry `child_id`.

## Structure and commands

- `backend/app/auth.py`, `deps.py`, `rate_limit.py`: Firebase authentication, organization-scoped dependencies, and per-process request limits.
- `backend/app/repo/`: memory and Firestore repository implementations.
- `backend/app/routers/`: authenticated API routes.
- `backend/app/services/`: AI, assessment, billing, knowledge, and document services.
- `backend/app/data/assessments/`: local-only assessment item-bank JSON (git-ignored, docker-ignored). Production reads `ASSESSMENT_DATA_DIR`, mounted read-only from a private bucket. `backend/tests/fixtures/assessments/` holds a synthetic fixture only.
- `backend/tests/`: pytest suite.
- `backend/scripts/`: local ingest, OCR, and admin utilities.
- `docs/`: plans, operations, retention, and privacy procedures.
- `reference-docs/` and `extracted/` are local-only source material and generated extraction. Do not commit, upload, or publish either directory.
- `frontend/` belongs to another owner. Do not modify it for backend work.

Run from the repository root:

```sh
cd backend && .venv/bin/python -m pytest -q
cd backend && .venv/bin/uvicorn app.main:app --reload
```

Run source extraction locally with `cd backend && .venv/bin/python scripts/extract_text.py ../reference-docs ../extracted`. OCR uses the local macOS Vision script: `swift backend/scripts/ocr_scans.swift reference-docs extracted extracted/ocr`.
Build banks locally with `./backend/.venv/bin/python backend/scripts/build_assessment_banks.py extracted backend/app/data/assessments reference-docs`.

## Development rules

- Read `docs/PLAN.md` and relevant tests before changes.
- Do not invent scores, developmental ages, percentiles, item text, or norms. `norm_tables_loaded` stays false until an official norm source is loaded.
- Do not auto-complete unreadable pages or tables. Mark them `needs_review` and keep them out of retrieval.
- AI output is a draft. Persist it to `ai_analyses` with `status=draft`; therapist approval is required before clinical records change.
- Calculate time, counts, and money only in `backend/app/services/billing.py`.
- Keep OpenAI calls behind injectable clients. Read model names from environment variables. Never add real keys, secrets, or credentials to source.
- Reference text ingestion to a remote repository requires `--allow-reference-text-upload`; OpenAI embeddings also require `OPENAI_ALLOW_REFERENCE_EMBEDDING_UPLOAD=true`. Default is local keyword retrieval.
- Scope every read and write by `organization_id`; validate child ownership through `Principal` before child data access. Record writes in `audit_logs`.
- Preserve the existing tests and add pytest coverage for each new behavior. Do not edit `frontend/`.
- Keep copyrighted source and extraction local. Do not commit, externally upload, or publicly serve `reference-docs/`, `extracted/`, or `backend/app/data/assessments/` (item banks contain licensed item text). Tests that need real banks must skip when they are absent; use synthetic fixtures otherwise.

## Git

- Use branch names `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`, or `chore/<short-name>`.
- Commit messages use `prefix: description`, with prefix one of `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`, `perf`, `ci`, or `build`. Keep descriptions short and specific.
- Do not force-push, rewrite history, delete branches, or push without an explicit user request.
- Preserve user changes; never reset or overwrite changes outside the requested scope.

## Deployment and privacy

- Cloud Run deployment is documented but must not be run without an explicit request.
- Use Firebase Auth, Firestore, private Cloud Storage, and Secret Manager in production. Keep project IDs and secret values in deployment variables.
- Firestore client rules deny direct client reads and writes; backend uses the Admin SDK.
- Retention periods require organization and qualified privacy/legal review. Do not invent a statutory period. Explain that policy drafts are not legal advice and require expert review.
- The retention script is dry-run by default and requires an explicit approved `--retention-days`; permanent deletion additionally requires `--apply`.
- Keep data sent to OpenAI to the minimum necessary pseudonymous clinical context. Redact known child names/contact details and common phone/email patterns; ask users to pseudonymize other free text.
