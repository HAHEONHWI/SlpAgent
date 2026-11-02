# Project instructions

## Project

SLP Agent is a Korean-language assistant for speech-language therapists. Backend is FastAPI; `Repo` supports memory and Firestore. Every stored document carries `organization_id` and child-scoped records carry `child_id`.

## Structure and commands

- `backend/app/auth.py`, `deps.py`, `rate_limit.py`: Firebase authentication, organization-scoped dependencies, and per-process request limits.
- `backend/app/repo/`: memory and Firestore repository implementations.
- `backend/app/routers/`: authenticated API routes.
- `backend/app/services/`: AI, licensed-test registry (`assessment_defs`), billing, knowledge, and document services.
- 검사 결과 입력(발달검사 관리) was removed. Saved `assessments` records are kept untouched (purged with the child) but no route, AI tool, analysis or document reads them. 검사 서류 reach the AI only as `knowledge_documents` pages, retrievable by organizations licensed for that test. `backend/app/data/assessments/` (old item banks) stays local-only and git/docker-ignored.
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
Local dev: set `LOCAL_KNOWLEDGE_DIR=../extracted` in `backend/.env` (development + memory storage only) to load extracted 검사 서류 into `LOCAL_KNOWLEDGE_ORGS` (default `orgA,demo`) at startup. Remote ingest: `cd backend && .venv/bin/python -m scripts.ingest_knowledge ORG_ID ../extracted --allow-reference-text-upload`, only after rights review.

## Development rules

- Read `docs/PLAN.md` and relevant tests before changes.
- Do not invent scores, developmental ages, percentiles, item text, or norms.
- Do not auto-complete unreadable pages or tables. Mark them `needs_review` and keep them out of retrieval.
- AI output is a draft. Persist it to `ai_analyses` with `status=draft`; therapist approval is required before clinical records change.
- Calculate time, counts, and money only in `backend/app/services/billing.py`.
- Schedule payment category: explicit private/cognitive choices and legacy `extra=paid` always win. Every other class follows the child's monthly 결제 일정 (`pay_plans`, id `{child_id}_{month}`): 실제와 동일 (default, no plan) = the month's first 5 held classes are `voucher` and later ones auto `private`; an entered plan = classes on its dates are `voucher`, the rest auto `private`, and the 바우처 서류 and settlement's voucher sessions use the plan's dates/times. Edit it in 일정 관리 › 월간 일정표 (결제 일정).
- Keep OpenAI calls behind injectable clients. Read model names from environment variables. Never add real keys, secrets, or credentials to source.
- AI dialogue defaults to knowledge mode with no clinical tools or child context. Clinical mode is explicit and fixed per conversation; draft tools require per-message opt-in and a writable role. Never place reference or attachment data in system/developer instructions.
- Reference text ingestion to a remote repository requires `--allow-reference-text-upload`; OpenAI embeddings also require `OPENAI_ALLOW_REFERENCE_EMBEDDING_UPLOAD=true`. Default is local keyword retrieval.
- Scope every read and write by `organization_id`; validate child ownership through `Principal` before child data access. Record writes in `audit_logs`.
- Firestore repeated document/unfiltered-list reads are cached only within one HTTP request (`repo/request_cache.py`); every write invalidates them and request completion clears/disables the cache. Keep access/assignment checks fresh across requests. For one child's permissions, inspect that child's document instead of listing all children. Keep the existing organization-scoped knowledge cache separate.
- Chat conversation lists must apply the newest-50 limit in Firestore. Legacy titles read only the earliest user message with `list_earliest`; new conversations skip empty history queries. Keep the matching composite indexes ready before deploying backend query changes. Conversation detail and model history retain the full conversation.
- Attendance payment categories reuse already loaded schedules and marks; the day view reads the month only up to that day (the first-5 rule needs earlier classes, never later days). Platform counts use `count`/`count_range` aggregation without downloading clinical documents; preserve children with a missing legacy `archived` field. Billing summaries apply the selected child and validated month range in Firestore.
- Therapists may edit their own child's dated schedules, including timetable-generated ones, through the existing child assignment checks. Keep the fixed weekly entry unchanged. Preserve the first `timetable_date` anchor across moves, skip overrides during weekly/holiday pruning, and include original-month overrides during sync to prevent regeneration; deploy the schedules `(organization_id, timetable_date)` index before this query.
- Preserve the existing tests and add pytest coverage for each new behavior. Do not edit `frontend/` for backend work; an explicit frontend request authorizes changes limited to that request.
- Public introduction lives in `frontend/public/home.html` and `home.css`, served at `/` by Firebase Hosting. The authenticated dashboard is `/dashboard`; SPA HTML is `noindex`. Follow `docs/DESIGN.md` for the public page. Run `cd frontend && npm run build` and `backend/.venv312/bin/python -m pytest frontend/tests -q` from the repository root when changing public search visibility. Never include clinical routes or licensed reference material in the sitemap or public metadata.
- Production runs Python 3.12 (eager annotation evaluation); the local `.venv` may be newer. Before any deploy, run `cd backend && .venv312/bin/python -m pytest -q` (create with `uv venv --python 3.12 .venv312 && uv pip install --python .venv312/bin/python -r requirements.txt`).
- Keep copyrighted source and extraction local. Do not commit, externally upload, or publicly serve `reference-docs/`, `extracted/`, or `backend/app/data/assessments/` (item banks contain licensed item text). Tests that need real banks must skip when they are absent; use synthetic fixtures otherwise.

## Git

- Use branch names `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`, or `chore/<short-name>`.
- Commit messages use `prefix: description`, with prefix one of `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`, `perf`, `ci`, or `build`. Keep descriptions short and specific.
- Do not force-push, rewrite history, delete branches, or push without an explicit user request.
- Preserve user changes; never reset or overwrite changes outside the requested scope.

## Deployment and privacy

- Cloud Run deployment is documented but must not be run without an explicit request.
- Artifact Registry cleanup uses `artifact-cleanup.json`: target only untagged `slp-agent-api` images older than 7 days, retain the latest 3 per package, and protect all serving/required rollback digests with tags. Start with `--dry-run`; permanent image deletion requires explicit approval. See `docs/operations.md`.
- Use Firebase Auth, Firestore, private Cloud Storage, and Secret Manager in production. Keep project IDs and secret values in deployment variables.
- For Firebase CLI account checks, use `firebase login:list` without `--json`; JSON output includes authentication tokens and must not be printed to logs.
- Firestore client rules deny direct client reads and writes; backend uses the Admin SDK.
- Retention periods require organization and qualified privacy/legal review. Do not invent a statutory period. Explain that policy drafts are not legal advice and require expert review.
- The retention script is dry-run by default and requires an explicit approved `--retention-days`; permanent deletion additionally requires `--apply`.
- Keep data sent to OpenAI to the minimum necessary pseudonymous clinical context. Redact known child names/contact details and common phone/email patterns; ask users to pseudonymize other free text.

## 바우처 기록지 HWP/HWPX

- `backend/app/services/voucher_hwpx.py` fills `backend/app/data/hwpx/voucher_template.hwpx` (발달재활 서비스 제공 기록지, 3 pages) by editing section XML as text: keep ZIP entry order/compression, reuse each cell's own paragraph/run tags, drop `hp:linesegarray` on edited content. Never restructure the form; more than 5 visits repeat page 1 and the 별지 page per 5 visits, and the calendar is rebuilt from the template's own first/middle/last week rows at the original total height.
- The stored template must stay blank (no child names, birth dates, notes, author metadata or preview image). Re-sanitize any new template before committing, and check output by opening it in 한글 when changing the filler.
- Voucher exports also support HWP through local `hwp-cli` v1.3.1 (`hwp` on PATH), pinned with SHA-256 in Docker and CI. Keep `--preserve-layout --strict` and page-level layout on repeated sheets: edited cells already drop stale layout, and dropping the remaining layout adds blank pages. Never upload clinical documents to an online converter. The UI defaults to HWP; the legacy `/voucher-hwpx` API defaults to HWPX unless `format=hwp` is requested. Preserve the HWPX fallback and report converter failures as HTTP 503.
