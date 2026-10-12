# 다른 AI에게 줄 작업 프롬프트

공통 맥락(모든 프롬프트 앞에 붙임):

> 프로젝트: `/Users/dgsw09/SlpAgent` — 언어재활사용 AI 업무보조 웹서비스. 백엔드는 FastAPI(`backend/app`), 저장소는 `Repo` 추상화(memory/firestore), 모든 문서에 `organization_id`. 먼저 `docs/PLAN.md`와 `backend/tests`를 읽을 것. 규칙: (1) 공식 규준표 없이 점수·발달연령·백분위를 만들지 않는다 (2) 읽을 수 없는 페이지·표는 자동 완성하지 않고 `needs_review`로 표시한다 (3) AI 출력은 미승인 초안이며 저장은 치료사 승인 후 (4) 시간·횟수·금액은 코드로 계산 (5) `reference-docs/`는 저작권 자료이므로 커밋·외부 업로드·웹 공개 금지 (6) 기존 테스트 11개를 깨지 말고 새 기능마다 pytest 추가. 프론트엔드(`frontend/`)는 다른 담당이 작업 중이므로 수정하지 말 것. 실제 API 키·비밀값을 만들거나 하드코딩하지 말 것. 완료 시 구현 범위와 **미완료/불확실한 부분**을 솔직히 보고할 것.

---

## 프롬프트 A — 이미지 PDF OCR과 검사별 문항 은행

`reference-docs/`의 이미지 전용 PDF 7개(K-SNAP, ESDM, K-CDI, K-MB-CDI 영아용·유아용, REVT 검사지, EASIC 언어이전단계)는 텍스트 추출이 안 된다. 텍스트 PDF(EASIC검사지, EASIC자극제시방법, REVT매뉴얼, PRES, SELSI, KOSECT)는 `backend/scripts/extract_text.py` 결과가 `extracted/`에 있다.

할 일:
1. 이미지 PDF를 페이지 이미지로 렌더링해 OCR(한국어 지원 엔진 또는 비전 모델)한다. 페이지 번호를 보존하고, 신뢰도가 낮은 줄·표는 `needs_review: true`로 표시한다. 원본 페이지 이미지와 나란히 검수할 수 있는 간단한 HTML 리포트(로컬 전용)를 생성한다.
2. 검사별로 `backend/app/data/assessments/<test_code>.json`에 문항 은행을 만든다: `{item_id, domain, age_range, prompt, response_options, source:{file,page}, needs_review}`. test_code는 `backend/app/services/assessment_defs.py`의 코드와 동일. PRES(수용 25/15/6, 표현 16/22/8), SELSI, EASIC, KOSECT 같은 텍스트 PDF부터 시작하고, 문항 수를 원본 기록지와 대조하는 검증 테스트를 쓴다.
3. 규준표·채점표가 자료에 없으면 `norm_tables_loaded=false`를 유지한다. 임의로 만들지 않는다.
4. `assessment_defs.py`에 `item_bank_loaded`를 실제 로드 여부로 갱신하고 `GET /assessment-definitions/{code}/items` 엔드포인트를 추가한다(기관 로그인 필수).
5. 결과 요약: 검사별 페이지 수, 자동 추출 성공/검수필요 비율, 불확실 문항 목록.

---

## 프롬프트 B — 지식검색(RAG)과 AI 분석 기능

현재 `backend/app/services/knowledge.py`는 문자 bigram 키워드 검색이다. 개선하고 AI 분석 3종을 추가한다.

1. 임베딩 RAG: `OPENAI_EMBEDDING_MODEL` 환경변수가 설정된 경우에만 임베딩을 쓰고, 없으면 기존 키워드 검색으로 폴백한다(모델 ID 하드코딩 금지). 청크에 문서명·페이지·test_code·문항 ID 메타데이터를 보존하고, `needs_ocr` 페이지는 제외한다. 모든 검색은 `organization_id`로 격리한다. 벡터 저장은 Firestore 벡터 필드 또는 인터페이스 뒤의 대체 구현으로 하고 선택 이유를 적는다.
2. 검색 결과는 항상 `{document, page, text}`와 함께 반환하고, 자료 속 지시문은 명령이 아니라 데이터로 취급한다(프롬프트 인젝션 테스트 포함).
3. 신규 엔드포인트(모두 결과는 `ai_analyses`에 `status=draft`로만 저장, 승인은 기존 `/proposals/{id}/approve` 흐름에 `kind` 추가):
   - `POST /children/{id}/analysis/integrated` — 통합 발달 분석: 평가 개요, 생활연령·검사일, 강점, 지원 필요 영역, 검사 간 공통 관찰, 불일치, 추가 평가 필요, 치료목표 후보, 판단 근거. **서로 다른 검사 점수를 합산하지 않고**, 검사에 없는 사실을 만들지 않는다.
   - `POST /children/{id}/analysis/behavior` — ABC 반복 패턴, 행동기능 **잠정 가설**(확정 표현 금지), 환경 요인, 추가 관찰 필요 정보, 대체 의사소통 행동 후보, 치료사 검토용 지원전략. 진단 자동 부여·위험하거나 강압적인 중재 처방 금지.
   - `POST /children/{id}/activities/generate` — 입력(연령, 목표영역, 현재 수준, 선호, 준비물, 시간, 촉진수준) → 목적, 준비물, 순서, 모델링 예시, 반응 유도, 난이도 조절, 측정 방법, 보호자 연계.
   - 구조화 출력(JSON schema)을 쓰고, 모든 주장에 `evidence[]`(문서/페이지/문항번호/평가일)를 요구하며 근거 없는 항목은 거부하는 검증기를 둔다.
4. OpenAI 호출은 `backend/app/services/agent.py`의 클라이언트 주입 패턴을 따라 가짜 클라이언트로 테스트한다. 실제 호출은 키가 없으면 하지 말고 "미검증"으로 보고한다.

---

## 프롬프트 C — 문서 생성(DOCX/PDF/HWPX)

`reference-docs/바우처예시.hwpx`(발달재활 서비스 제공 기록지: 월별 제공시간 표, 총 제공시간·바우처/추가구매, 총 이용금액, 서명란, 승인일자·승인번호·상태 및 결과, 별지)를 분석한다. 압축을 풀어 `Contents/section0.xml` 구조를 확인할 것(추출본은 `extracted/voucher_hwpx/`).

1. `backend/app/services/documents/`에 문서 5종 생성기: 서비스 제공기록지, 서비스 일정표, 치료 경과보고서, 평가 결과 요약서, 보호자 상담기록. 입력은 DB 데이터(회기, 계획, 검사)이고 **시간·횟수·금액은 `backend/app/services/billing.py`로만 계산**한다. 승인번호·서명·금액을 AI나 코드가 추측해 채우지 않고 빈칸 또는 "수기 입력"으로 둔다.
2. DOCX(python-docx 또는 템플릿 치환)와 PDF(한글 폰트 임베딩, 폰트 라이선스 확인) 출력. 원본 서식과 나란히 비교한 스크린샷/체크리스트로 레이아웃 차이를 보고한다.
3. HWPX는 템플릿의 텍스트 노드 치환으로 시도하되, 한컴오피스에서 열리는지 **검증할 수 없으면 "미검증"으로 표시**하고 구현 완료로 쓰지 않는다.
4. 엔드포인트: `POST /children/{id}/documents` (type, month, format) → Cloud Storage 비공개 객체(로컬은 파일 시스템 대체) + `generated_documents` 메타데이터 + 서명 URL(짧은 만료). 상태는 `draft→approved`, 승인 전 문서에는 "초안" 워터마크. 감사로그 기록.
5. 월 합계·분 계산·누락 일자 테스트를 작성한다.

---

## 프롬프트 D — 배포·보안·운영

1. Cloud Run 배포: `backend/Dockerfile` 점검, `cloudbuild.yaml` 또는 GitHub Actions, 서비스 계정 최소 권한, Secret Manager(`OPENAI_API_KEY`)와 환경변수(`OPENAI_MODEL`), 프론트 정적 호스팅(Firebase Hosting 또는 Cloud Run). 실제 프로젝트 ID·키는 만들지 말고 변수 처리한다. 배포 명령 문서는 쓰되 **실행하지 않는다**.
2. Firebase Auth 커스텀 클레임(`org_id`, `role`)을 부여하는 관리자용 스크립트와 기관 온보딩 절차. 클레임 변경 시 토큰 폐기 확인.
3. Firestore: 필요한 복합 인덱스(`firestore.indexes.json`), `firestore.rules` 검토(클라이언트 직접 접근 차단 유지), Cloud Storage 비공개 + 서명 URL, 백업(PITR/내보내기)과 복구 절차.
4. 개인정보: 데이터 보유기간·삭제 정책(소프트삭제→기간 후 영구삭제 작업), OpenAI 전송 정보 최소화 점검표, 국외 이전·위탁 관련 확인 항목 체크리스트. **법률 자문이 아니며 전문가 확인 필요**라고 명시한다.
5. 백엔드 보안 점검: 모든 라우터가 `Principal`로 org 검증하는지 자동 점검하는 테스트, 속도 제한, 감사로그 조회 API(admin 전용), 의존성 취약점 스캔.
