# SLP Agent — 구조와 구현 상태

## 현재 상태 (2026-10-12)
- macOS Vision이 이미지 전용 PDF 7개, 총 81페이지를 OCR했다. 텍스트 검출 80/81이며 모든 페이지 `needs_review=true`; HTML 대조 리포트와 원본 페이지 이미지는 무시 대상 `extracted/ocr/`에 있다.
- 텍스트 자료 문항 은행: PRES 90/92, SELSI 112/112, EASIC 144/144, KOSECT 57/57. 모든 문항은 검수 전이며 규준표는 미제공이다. PRES 누락 2건과 EASIC 원문 번호 중복은 자동 수정하지 않았다.
- RAG는 org 격리, 문서·페이지·텍스트 인용, `needs_ocr`/`needs_review` 제외, bigram 폴백, 권한 확인 전송 opt-in 임베딩을 구현했다. AI 대화에는 검수된 허가 자료의 제한된 발췌만 낮은 권한의 user 참고 입력으로 전달한다.
- AI 대화는 언어치료 지식 모드가 기본이다. 임상 모드는 별도로 선택하며, 초안 도구는 메시지별 허가와 쓰기 역할을 확인한다. 구조적 도구 차단·참고자료 권한 분리·직접 규칙 우회 요청 차단을 구현했다. 실제 모델의 공격 저항성은 별도 평가가 필요하다.
- 통합·행동·활동 AI 분석은 근거 스키마 검증 후 `ai_analyses` 초안으로 저장한다. 실제 OpenAI 호출은 하지 않았다.
- DOCX/PDF 5종 생성과 비공개 저장·승인·서명 URL 경로를 구현했다. HWPX 샘플에는 치환 토큰이 없고 한컴오피스 검증도 없어 미검증이다.
- Cloud Run/Hosting 설정, 인덱스, 비밀값 변수화, 클레임·보존 스크립트와 운영 문서를 추가했다. 운영 서비스는 배포 완료(사용자 확인); 배포 revision·URL·실환경 검증 기록은 이 문서에 없다.
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
| 배포 | 배포 완료(사용자 확인). 배포 revision·URL·실환경 검증 상태는 저장소 문서에 미기록 |
| 프론트엔드 | 다른 담당자 작업 중 |
