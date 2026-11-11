# SLP Agent

언어재활사(언어치료사)를 위한 AI 업무보조 웹서비스입니다. 아동별 발달검사, 행동 관찰, 치료계획, 회기 기록, 보호자 상담, 바우처 문서까지 치료 과정 전체를 관리하고, 근거 기반의 대화형 AI가 기록을 조회해 초안을 만들어 줍니다.

- 서비스: https://slpai.heonhwi.dev (같은 사이트: https://slp-agent-2026.web.app)
- 기능명세서: [docs/기능명세서.md](docs/기능명세서.md) · 디자인 시스템: [DESIGN.md](DESIGN.md)

## 핵심 원칙

| 원칙 | 구현 |
|---|---|
| AI 출력은 미승인 초안 | AI가 만든 분석·기록문·활동·상담자료는 `ai_analyses`에 초안으로만 저장되고, 치료사가 승인해야 기록에 반영됩니다. |
| 근거 제시 | AI 답변은 문서명·페이지·검사 문항번호·평가일을 근거로 붙입니다. 분석 결과는 근거가 실제 기록과 맞지 않으면 서버가 거부합니다. |
| 점수를 만들지 않음 | 공식 규준표가 없는 검사는 표준점수·발달연령·백분위를 `규준 없음`으로 표시합니다. |
| 진단하지 않음 | 행동기능과 임상 의견은 "잠정 가설"로만 작성하고 치료사 검토를 요구합니다. |
| 기관 격리 | 모든 데이터에 `organization_id`가 붙고, 서버가 기관·역할·아동 소유권을 검증합니다. |
| 개인정보 최소화 | OpenAI에는 가명코드·월령·임상 기록만 보내고 이름·연락처는 제외합니다. 텍스트 첨부(TXT/MD/CSV/DOCX/HWP/HWPX)는 아동 실명·연락처·전화번호·이메일을 가린 뒤 보내지만, **PDF와 이미지 첨부는 원본 그대로 전송**되므로 개인정보가 담긴 파일은 첨부하지 마세요. |
| 계산은 코드로 | 시간·횟수·금액은 `backend/app/services/billing.py`에서만 계산합니다. 승인번호·서명은 수기 입력입니다. |

## 주요 기능

- **AI 대화**: 일반 모드와 아동별 모드를 지원합니다.
  - 대화 이력이 저장되고, 파일·이미지 첨부(PDF, DOCX, HWP/HWPX, TXT/MD/CSV, PNG/JPG/WEBP)와 Markdown 답변을 지원합니다.
  - 기관 자료를 인용할 때는 `[자료 N]`으로 출처를 표시합니다.
  - 아동별 모드에서는 검사·회기·행동·어휘·목표 조회 도구를 쓰고, 계획·기록문·상담자료 초안을 승인 대기 목록에 올립니다.
- **아동 관리**
- **발달검사**: K-SNAP, ESDM, EASIC, K-MB-CDI(영아·유아), REVT, SELSI, PRES, KOSECT, K-CDI. 사용권한이 있는 검사는 문항 체크리스트로 입력합니다.
- **통합 발달 분석 · 행동 패턴 분석 · 치료활동 생성**: 근거가 검증된 AI 초안을 만들고, 승인한 결과는 이력으로 남습니다.
- **행동분석(ABC 관찰)**: 기관이 정한 강도 척도를 씁니다.
- **어휘 발달 관리**: 수용·표현 어휘의 습득 변화 차트, 가정연계 어휘 목록을 제공합니다.
- **치료계획**: 장기·단기목표를 버전으로 관리하고, 승인한 목표만 활성화됩니다.
- **회기별 치료기록**과 **발달 진행도 분석**
- **보호자 상담 기록**
- **바우처·문서 생성**: 월별 집계와 DOCX·PDF 출력을 지원합니다(HWPX는 미완성).
- **AI 지식자료실**: 기관 전용 자료를 검색합니다.
- **일정 관리**: 치료사·아동별 시간 충돌을 검사합니다.
- **기관 설정과 감사로그**
- **회원가입과 승인**: 가입하면 사이트 관리자가 승인합니다. 사이트 관리자는 기관별 검사 사용권한을 지정하고, 집계 숫자만 볼 수 있으며 임상 기록은 볼 수 없습니다.

## 구성

```
frontend/   React + TypeScript + Vite + Tailwind + TanStack Query  → Firebase Hosting
backend/    FastAPI + Pydantic v2 + Firebase Admin + OpenAI          → Cloud Run (asia-northeast3)
docs/       계획, 운영, 개인정보·보유기간, 지식검색, 문서생성, 기능명세
```

| 영역 | 운영 환경 |
|---|---|
| 인증 | Firebase Authentication (이메일/비밀번호, 커스텀 클레임 `org_id`·`role`·`site_admin`) |
| 데이터 | Cloud Firestore (서울). 클라이언트 직접 접근은 규칙으로 차단하고 백엔드만 접근 |
| 파일 | 비공개 Cloud Storage: 생성 문서 `slp-agent-2026-documents`, 문항 은행 `slp-agent-2026-item-banks`(읽기 전용 마운트) |
| 비밀값 | Secret Manager (`OPENAI_API_KEY`) |
| AI 모델 | 환경변수 `OPENAI_MODEL` (현재 `gpt-6-luna`) |
| 라우팅 | Hosting의 `/api/**` → Cloud Run `slp-agent-api` (백엔드가 `/api` 접두어 제거) |

## 로컬 개발

필요한 것: Python 3.12+, Node 20+.

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
cd frontend && npm install
```

`backend/.env` (git 제외):

```
ENV=development
AUTH_MODE=dev            # 개발용 토큰 로그인. production에서는 거부됨
STORAGE_BACKEND=memory   # 메모리 저장소 (재시작하면 초기화)
DEV_SEED=1               # 데모 기관·아동 더미 데이터
OPENAI_API_KEY=          # 선택. 없으면 AI 기능이 503 안내
OPENAI_MODEL=gpt-6-luna
DOCUMENT_URL_SIGNING_KEY= # 로컬 문서 다운로드 링크 서명용 임의 문자열
```

`frontend/.env.local` (git 제외)에는 Firebase 웹 설정(`VITE_FIREBASE_*`)을 넣습니다. 개발용 토큰 로그인을 함께 쓰려면 `VITE_DEV_LOGIN=1`을 추가합니다.

실행:

```bash
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8080
```

```bash
cd frontend && npm run dev
```

- 앱: http://localhost:5173 (`/api`는 8080으로 프록시)
- API 문서(Swagger): http://localhost:8080/docs. 개발 모드에서는 Authorize에 `dev:demo:therapist:dev-user`를 넣습니다. 운영에서는 Swagger가 꺼져 있습니다.

테스트:

```bash
cd backend && .venv/bin/python -m pytest -q
```

```bash
cd frontend && npx tsc -b && npm run build
```

## 배포

백엔드(Cloud Run). 기존 환경변수·비밀값·버킷 마운트는 유지됩니다:

```bash
cd backend && gcloud run deploy slp-agent-api --source . --region asia-northeast3 --project slp-agent-2026 --build-service-account projects/slp-agent-2026/serviceAccounts/slp-agent-builder@slp-agent-2026.iam.gserviceaccount.com
```

프론트(Firebase Hosting):

```bash
cd frontend && npm run build && cd .. && firebase deploy --only hosting --project slp-agent-2026
```

Firestore 규칙·인덱스:

```bash
firebase deploy --only firestore --project slp-agent-2026
```

사이트 관리자 지정(첫 관리자만 스크립트로 지정하고, 이후 가입은 관리자 화면에서 승인합니다):

```bash
cd backend && GOOGLE_CLOUD_PROJECT=slp-agent-2026 .venv/bin/python scripts/set_firebase_claims.py --email you@example.com --site-admin --apply
```

자세한 운영 절차는 [docs/operations.md](docs/operations.md)를 참고하세요.

## 라이선스

Copyright (c) 2026 하헌휘. All rights reserved.

이 프로젝트의 자체 소스 코드·문서·자산은 [독점 라이선스](LICENSE)를 따릅니다. 저작권자의 사전 서면 허가 없는 사용·복제·수정·재배포·판매·별도 서버 운영을 금지하며, 비상업적 사용에도 동일하게 적용됩니다. 이용 허가 문의: [3h@heonhwi.dev](mailto:3h@heonhwi.dev).

운영자가 승인한 사용자의 공식 서비스·앱 이용은 허용 범위 안에서 유지됩니다. 외부 라이브러리·폰트·서식·검사 자료 등 제3자 자료의 권리와 별도 라이선스는 그대로 유지됩니다.

## 데이터와 저작권

- `reference-docs/`(검사 원문), `extracted/`(추출본), `backend/app/data/assessments/`(문항 은행)는 **커밋하지 않고**, 컨테이너 이미지와 Cloud Build 업로드에도 포함하지 않습니다(`.gitignore`, `.dockerignore`, `.gcloudignore`).
- 문항 은행과 검사 자료는 사이트 관리자가 사용권한(라이선스)을 지정한 기관에만 제공됩니다.
- 자동 추출된 문항은 모두 `needs_review` 상태입니다. 원본 기록지와 사람이 대조하는 검수가 필요합니다.

## 현재 한계

- 규준표가 없어 어떤 검사도 표준점수·백분위를 계산하지 않습니다.
- 이미지 PDF 7종은 OCR만 했고 검수 전이라 사용하지 않습니다. PRES 문항 2개가 추출되지 않았습니다.
- HWPX 바우처 출력은 기관의 빈 서식 템플릿이 있어야 완성할 수 있습니다.
- Firestore 예약 백업은 아직 꺼져 있습니다.
- 데이터 보유기간, 개인정보 처리, OpenAI 국외 이전은 전문가 검토가 필요합니다([docs/retention.md](docs/retention.md)는 초안이며 법률 자문이 아닙니다).

## 기여 규칙

개발 규칙은 [AGENTS.md](AGENTS.md)를 따릅니다. 커밋 메시지는 `feat:`/`fix:`/`docs:` 등의 접두어를 쓰고, 기존 테스트를 유지하며 새 동작마다 테스트를 추가합니다.
