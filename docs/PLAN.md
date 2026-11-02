# SLP Agent — 구조와 구현 상태

## 현재 상태 (2026-10-12)
- 2026-11-02 바우처 HWP 기본 다운로드·HWPX 선택·여러 달 ZIP, 날짜별 일정의 아동 이름·코드 표시와 담당 치료사 수정 기능을 운영 배포했다. 고정 주간 시간표는 유지하며 날짜·시간·메모 변경은 해당 일정에만 적용된다. 기존 시간표 테스트는 명시적 시작일로 날짜 의존성을 제거했다. 분리한 배포본의 Python 3.12 회귀 테스트 220개와 최종 관련 테스트 52개, frontend build, 실제 Linux amd64 배포 이미지의 변환·권한·일정 검증을 통과했다. 백엔드 `slp-agent-api-00042-giv` 트래픽 100%, Hosting `c56be45cd10d01a7`. 동시 작업 중인 결제 일정·추가 읽기 최적화는 제외했다. 상세는 `docs/operations.md`, `docs/documents.md`.
- macOS Vision이 이미지 전용 PDF 7개, 총 81페이지를 OCR했다. 텍스트 검출 80/81이며 모든 페이지 `needs_review=true`; HTML 대조 리포트와 원본 페이지 이미지는 무시 대상 `extracted/ocr/`에 있다.
- 텍스트 자료 문항 은행: PRES 90/92, SELSI 112/112, EASIC 144/144, KOSECT 57/57. 모든 문항은 검수 전이며 규준표는 미제공이다. PRES 누락 2건과 EASIC 원문 번호 중복은 자동 수정하지 않았다.
- RAG는 org 격리, 문서·페이지·텍스트 인용, `needs_ocr`/`needs_review` 제외, bigram 폴백, 권한 확인 전송 opt-in 임베딩을 구현했다. AI 대화에는 검수된 허가 자료의 제한된 발췌만 낮은 권한의 user 참고 입력으로 전달한다.
- AI 대화는 언어치료 지식 모드가 기본이다. 임상 모드는 별도로 선택하며, 초안 도구는 메시지별 허가와 쓰기 역할을 확인한다. 구조적 도구 차단·참고자료 권한 분리·직접 규칙 우회 요청 차단을 구현했다. 실제 모델의 공격 저항성은 별도 평가가 필요하다.
- 통합·행동·활동 AI 분석은 근거 스키마 검증 후 `ai_analyses` 초안으로 저장한다. 실제 OpenAI 호출은 하지 않았다.
- DOCX/PDF 5종 생성과 비공개 저장·승인·서명 URL 경로를 구현했다. HWPX 샘플에는 치환 토큰이 없고 한컴오피스 검증도 없어 미검증이다.
- Cloud Run/Hosting 설정, 인덱스, 비밀값 변수화, 클레임·보존 스크립트와 운영 문서를 추가했다. 2026-10-26 백엔드 `slp-agent-api-00039-bpq` 배포·운영 API 검증을 완료했다. 상세 기록은 `docs/operations.md`를 따른다.
- 2026-10-28 대화 목록의 최신 50개 서버 제한·과거 제목의 최초 사용자 메시지 1개 제한·새 대화의 빈 이력 조회 제거를 추가했다. Python 3.12 pytest 197개와 로컬 HTTP 검증 통과 후 사용자 승인으로 새 Firestore 인덱스 2개를 READY 확인하고 백엔드 `slp-agent-api-00040-9lw`를 트래픽 100%로 배포했다. 운영 API와 새 Firestore 쿼리를 확인했고 일일 감시의 최신 배포 기준을 갱신했다.
- 2026-10-31 읽기 23,449회의 집계·요청 로그를 진단하고 출결의 불필요한 월 전체 재조회, 플랫폼 통계의 문서 전체 로딩, 월별 청구 요약의 전체 이력 조회를 제거했다. Python 3.12 pytest 215개와 운영 Firestore의 집계·기간 쿼리 호환성을 검증했다. 이 추가 최적화는 11/02 HWP 배포에 포함하지 않았다. 상세 수치·집계 한계는 `docs/operations.md`에 기록했다.
- pytest 34개 통과, `pip-audit` 알려진 취약점 없음, Python 컴파일과 JSON/YAML 파싱 통과. PDF 합성 미리보기 A4 세로 1페이지와 포함 폰트를 확인했다.
- Docker 이미지 빌드는 daemon 연결 실패(`Cannot connect to the Docker daemon`)로 미검증이다.
- `frontend/`는 다른 담당 작업으로 수정하지 않았다.

## 구조
```
backend/app/auth.py, deps.py, rate_limit.py  인증·기관 격리·요청 제한
backend/app/repo/                            memory / Firestore 저장소
backend/app/routers/                         인증 라우터와 초안 승인 API
backend/app/services/                        분석, 문항, RAG, billing, 문서 생성
backend/app/data/assessments/                검사별 문항 JSON
backend/scripts/                             추출, OCR, ingest, 운영 스크립트
backend/tests/                               격리·승인·계산·보안 회귀 테스트
frontend/                                    다른 담당자 소유
```

## 불변 원칙
1. 모든 문서에 `organization_id`(+`child_id`). 저장소 계층이 기관 불일치를 NotFound로 처리.
2. AI는 쓰기 불가. 쓰기 도구는 `ai_analyses`에 `status=draft` 제안만 만들고, 치료사가 `/proposals/{id}/approve`로 승인해야 반영.
3. 치료목표는 승인 전 `draft`; 계획 수정은 새 버전 생성, 이전 버전 보존(`superseded`).
4. 규준 없으면 점수·발달연령·백분위 = `null` + `norm_unavailable`.
5. 시간·횟수·금액은 `services/billing.py`에서만 계산. 단가 미설정이면 금액 null.
6. OpenAI에는 가명 아동 코드·월령·필요한 임상 기록만 전달한다. 알려진 이름·연락처와 이메일·전화 패턴은 가린다. 사용자가 추가 식별 정보를 가명화한다.
7. 모든 쓰기는 `audit_logs` 기록.

## 단계별 상태
| 영역 | 상태 |
|---|---|
| 인증·아동·기관·일정·기록 API | 구현, memory 기반 테스트 |
| 검사 관리·문항 은행 | 텍스트 검사 4종 추출, 전 문항 검수 필요; 이미지 검사 OCR, 문항 은행은 미완료 |
| 지식검색 | org 격리 키워드 검색; 임베딩은 권한 확인 후 설정할 수 있는 opt-in, 대규모 벡터 검색 미검증 |
| 채팅·통합/행동/활동 AI | fake client 기반 초안·근거 테스트; 실제 모델 호출 미검증 |
| 문서 생성 | DOCX/PDF 5종 구현; HWPX 미검증; 레이아웃 검수 결과 `docs/documents.md` |
| 보안·운영 | Principal 경로 검사, 제한, admin 감사 API, CI/pip-audit, Cloud Run 설정·절차 추가 |
| 배포 | 2026-11-02 백엔드 `slp-agent-api-00042-giv`, 트래픽 100%; HWP·날짜별 일정 및 Hosting 배포 검증은 `docs/operations.md`에 기록 |
| 프론트엔드 | 다른 담당자 작업 중 |
