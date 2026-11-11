# 배포·보안·운영

운영 서비스의 최근 배포 검증은 아래에 기록한다. `cloudbuild.yaml`은 배포 또는 재배포 시 변수를 채워 사용한다. 실제 프로젝트 ID, Secret, 도메인을 저장소에 넣지 않는다.

### 아동 등록 폼·아이 코드 자동 표시 배포 (2026-11-11)

- Firebase Hosting `slp-agent-2026`을 20:23:02 KST에 배포했다(53개 파일). `/`, `/children`, `/api/healthz`는 200, 미인증 `/api/children/next-code`는 401이다. `app.html`, 앱 JavaScript, 아동 관리 번들의 SHA-256이 `frontend/dist`와 일치한다.
- 등록 폼을 담당 치료사·이름·생년월일·성별·장애등록·바우처 등급·아이 코드 순서로 표시한다. 코드 입력은 읽기 전용이며, 치료사 코드 알파벳이 설정되지 않으면 등록을 막고 관리자에게 안내한다. Python 3.12 pytest 280개와 `npm run build`가 통과했다. Cloud Run·Firestore·Android는 변경하지 않았다.

### 대시보드 인사말·오늘 일정 세로 배치 배포 (2026-11-11)

- Firebase Hosting `slp-agent-2026`을 20:17:13 KST에 배포했다(53개 파일). 운영 `/`, `/dashboard`, `/api/healthz`가 모두 200이다. `app.html`, 대시보드 JavaScript, CSS의 SHA-256이 `frontend/dist`와 일치한다.
- Python 3.12 pytest 280개와 `npm run build`가 통과했다. Cloud Run, Firestore, Android 앱은 변경하지 않았다.

## Cloud Run

1. Artifact Registry 저장소 `slp-agent`와 Cloud Run 런타임 서비스 계정을 만든다.
2. 런타임 계정에는 Firestore용 `roles/datastore.user`, 전용 버킷에 한정한 `roles/storage.objectAdmin`, 설정한 Secret에 한정한 `roles/secretmanager.secretAccessor`, URL 서명에 필요한 `roles/iam.serviceAccountTokenCreator`를 부여한다. Cloud Build 배포 계정은 Artifact Registry 저장소 쓰기, Cloud Run 배포, 런타임 계정 사용 권한만 받도록 범위를 제한한다. OpenAI Secret은 운영자가 만든 뒤 연결하며 저장소에 값은 넣지 않는다.
3. Cloud Build substitutions의 `_REGION`, `_SERVICE`, `_SERVICE_ACCOUNT`, `_GCS_BUCKET`, `_OPENAI_MODEL`, `_OPENAI_EMBEDDING_MODEL`, `_ALLOW_REFERENCE_EMBEDDING_UPLOAD`, `_CORS_ORIGINS`를 프로젝트 값으로 설정한다. Artifact Registry 경로와 Secret 이름은 프로젝트에서 확인한다. 원문 임베딩 전송은 저작권 권한 검토 후에만 허용한다.
4. Firestore 인덱스와 deny-all 규칙을 먼저 배포한 뒤 Cloud Build를 실행한다. API는 Firebase ID token을 검증한다. Cloud Run 공개 진입점 뒤에 애플리케이션 인증이 적용된다.
5. 프론트엔드는 `frontend/dist`를 Firebase Hosting에 올린다. 프론트 소유자가 빌드한 다음 `firebase deploy --only hosting --project PROJECT_ID`를 실행한다. 프론트 변경은 사용자가 명시적으로 요청한 범위에서만 수행한다.

보존 작업을 Cloud Run Job으로 실행할 때는 동일 이미지를 사용하고 `python -m scripts.purge_archived_children --org-id ORG_ID --retention-days APPROVED_DAYS --apply`를 컨테이너 command/args로 지정한다. 기관별 승인 기간과 실행 주기를 운영자가 설정하며, 이 저장소에서는 Job이나 Scheduler를 생성하지 않는다.

비공개 Cloud Storage 객체는 V4 서명 URL로 15분간 제공한다. 런타임 서비스 계정이 서명할 수 있도록 IAM Sign Blob 권한이 필요하다. 로컬 대체 저장소는 `DOCUMENT_URL_SIGNING_KEY`가 있어야 하며, 운영에서는 GCS를 사용한다.

### 백엔드 전체 변경 배포 (2026-11-11)

- Python 3.12 pytest 280개 통과 후 Cloud Run `slp-agent-api-00050-8wj`에 트래픽 100% 전환했다. 이미지 digest는 `sha256:90d46be1adfc72efff0b97eaf9a6a7fb95787649f61c8bbd44d1c281b93d186c`다.
- 기존 런타임 서비스 계정·환경변수·Secret 연결을 유지했다. `/api/healthz` 200, 미인증 `/api/children` 401, 새 revision 오류 로그 0건을 확인했다. Firestore 인덱스·규칙 변경은 없다.
- Firebase Hosting `slp-agent-2026`을 19:27:58 KST에 배포했다(53개 파일). 공개 홈과 `/terms`는 200이며 운영 홈·앱 셸·개인정보 문서 번들이 빌드 결과와 일치한다. 이용약관·환불정책 초안은 번들에서 제외했고 해당 경로에는 미게시 안내만 표시한다. `frontend` build와 테스트 26개 통과.

### 아동 종결 화면 복구 배포 (2026-11-11)

- 현재 운영 번들에 종결 화면이 빠진 것을 확인한 뒤, 운영 HTML·JS와 일치하는 2026-11-10 배포 소스의 `frontend/src/pages/Children.tsx`에 종결 버튼·날짜 확인창·종결된 아동 목록만 복구했다. 동시 작업 중인 아이 코드 자동 생성과 공개 소개·정책 변경은 포함하지 않았다. 녹음 기록 삭제 기능과 기존 공개 홈페이지를 보존했다.
- Firebase Hosting `616fba34e391530f`을 17:59 KST에 배포했다(50개 파일). 이전 버전은 `78ef61f7916f71a4`다. Cloud Run·Firestore·Android는 변경하지 않았다.
- Python 3.12 pytest 277개, 배포본의 공개 페이지 검증 14개, frontend build와 draft guard 통과. 1440px에서 종결 버튼·빈 목록·날짜 확인창, 390px 확인창, 로컬 가상 아동 종결 후 목록 반영을 확인했다. 운영 `/children`·entry JS·Children JS·CSS의 SHA-256이 배포본과 일치하며 health 200, 익명 아동·종결 목록 API 401을 확인했다. 운영 임상 문서는 읽거나 쓰지 않았다.

### 임상 AI 아동 이름 가명 처리 배포 (2026-11-11)

- 대화 입력·기록·검색 결과·도구 출력·분석 문맥에서 선택 아동 이름을 가명 코드로 바꾸고, 기관 내 다른 등록 아동 이름은 `[개인정보]`로 가린다. 녹취록은 OpenAI 요약 전 가명 처리한다.
- Python 3.12 pytest 274개 통과. Cloud Build `f80563bb-2bc1-46c6-bb1a-ac992073a81f`는 기존 운영 이미지 `sha256:6ff8d6fec37c641a3669b0465553e3bf9607a6386587b098b382865f921fb215`에 수정 소스 7개만 덮어써 `sha256:ac2dc575bb11954031e97bafccf68afc6c2d4ca0e7785fb3051390f09e3ddb9e`를 만들었다. `slp-agent-api-00062-yil`에 트래픽 100%, 이전 `slp-agent-api-00059-wok`는 `keep-rollback`으로 보존했다.
- 기존 런타임 설정을 유지했다. 후보·운영 health는 200, 미인증 `/api/children`은 401, 새 revision 오류 로그 0건. 임상 데이터와 프론트엔드는 배포에서 읽거나 변경하지 않았다.

### 수업 녹음 기록 삭제 배포 (2026-11-10)

- 치료사·관리자가 승인된 수업 녹음 기록을 삭제할 수 있도록 프론트 버튼과 `DELETE /recording-records/{record_id}`를 배포했다. 권한·아동 범위·감사 로그를 적용하고, 공유 중이지 않은 연결 녹취록·STT 작업·임시 파일·승인 제안을 정리한다. DB 스키마와 Firestore 인덱스 변경은 없다.
- Python 3.12 pytest 272개와 frontend build가 통과했다. Cloud Build `dcd64e89-f23a-489c-b5d0-cf67f973da54`는 기존 운영 이미지 `slp-agent-api-00047-gq4`의 `app/routers/recordings.py`만 교체해 digest `sha256:6ff8d6fec37c641a3669b0465553e3bf9607a6386587b098b382865f921fb215`를 만들었다. `slp-agent-api-00059-wok`가 트래픽 100%를 처리하며 이전 `00047-gq4`를 `keep-rollback`으로 보존했다. 런타임 설정은 동일하다.
- Hosting은 운영 HTML과 asset 해시가 일치한 `feat/dashboard-home`의 `b37e6eb` 기준에 삭제 버튼만 적용해 2026-11-10 15:38 KST 배포했다. `/sessions`는 200, 새 JS 번들에 삭제 API와 확인 문구가 포함됐다. API health는 200, 미인증 삭제 요청은 401이었다. 임상 자료는 읽거나 변경하지 않았다.

### 구버전 앱의 날짜별 수업 수정 호환 패치 (2026-11-09)

- 구버전 앱이 시간 수정 요청에 조회값 `pay=pending`을 보내도 저장된 결제 구분을 보존한다. 같은 치료사 또는 아동의 실제 겹침은 409로 차단하며 결석 처리된 슬롯은 사용할 수 있다.
- Python 3.12 테스트 258개 통과. Cloud Build `551a5054-8261-4d97-9c13-ded606369440`으로 운영 이미지의 `app/routers/schedules.py`만 교체했다. Cloud Run `slp-agent-api-00046-pzg` 트래픽 100%, 직전 `slp-agent-api-00052-tod`. 운영 health 200, 익명 수업 수정 401 확인.

### 월간 일정표 수정 및 치료사별 결제 설정 배포 (2026-11-09)

- Cloud Build `2b061ab0-7875-4de1-a986-bf36095fd56c`에서 기존 운영 이미지의 소스 8개를 검증 후 교체했다. 무트래픽 후보의 인증과 상태를 확인하고 Cloud Run `slp-agent-api-00052-tod`로 100% 전환했다. 롤백 대상은 `slp-agent-api-00044-4ct`다.
- Firebase Hosting의 운영 `/schedule`, `/account`와 관련 JS 번들이 검증한 빌드와 일치했다. 운영 `/api/healthz`는 200, 익명 개인 결제 설정과 월간 일정표 요청은 401이었다. 배포 전 Python 3.12 테스트 257개가 통과했다.
- 2026년 11월부터 담당 치료사가 직접 저장한 자동 설정 또는 아동별 수동 결제 날짜가 적용된다. 배포 작업에서 교사 설정이나 아동의 결제 내역을 일괄 변경하지 않았다.

### 상담 녹음 시간 자동 입력 배포: 2026-11-09

- 기존 운영 이미지에 `app/routers/schedules.py`와 `app/services/billing.py`만 교체했다. Cloud Build `317944d9-61b2-45a1-bf04-f39dc77da2df`, Cloud Run `slp-agent-api-00044-4ct`에 트래픽 100%. 직전 revision은 `slp-agent-api-00048-qut`다. 런타임 컨테이너 설정은 동일하며 DB 마이그레이션은 없다.
- Firebase Hosting의 `/sessions`와 새 JS 번들이 로컬 빌드와 일치한다. 운영 `/api/healthz` 200, 익명 `/api/schedules` 401. Python 3.12 테스트 243개 통과. 웹의 40분 입력과 제출은 가상 일정으로 검증했다.
- 같은 날 아동 등록·수정 화면에서 장애등록이 N이면 바우처 등급을 수정할 수 없도록 Hosting을 갱신했다. 운영 `/children`과 해당 JS 번들이 검증한 빌드와 일치한다. 기존 저장 등급은 유지한다.

### 월간 일정표 교사별 보기 배포: 2026-11-02

- 사용자 요청으로 월간 일정표를 교사 한 명 기준으로 바꿨다. 관리자가 아닌 계정은 서버에서 본인(치료사 목록에 연결된 이름) 수업만 받고, 기관 관리자는 교사를 고른다. 기관 전체 `GET /pay-plans`는 `GET /month-sheet`로 대체했다(운영 404 확인).
- 배포 직전 Python 3.12 pytest 242개, frontend build·검증 14개 통과. Cloud Build `f00f0b07-52d5-4589-b095-d663d74e0f68` SUCCESS, 업로드 72개 파일에 민감 파일 없음. 인덱스 변경 없음.
- `slp-agent-api-00048-qut`(이미지 `sha256:18abcae5c947b96af98af374f1ccc0cf6c872cf17490555d4d23b57fac9d6510`)를 무트래픽 후보로 확인 후 100% 전환했다. runtime 설정 해시는 그대로다. `keep-current`·`latest`는 새 이미지, `keep-rollback`은 직전 `00045-kob` 이미지로 옮겼다.
- Hosting 배포 후 `/`·`/schedule` 200, 번들 SHA 일치, `/api/healthz` 200, 익명 `/api/children`·`/api/month-sheet` 401, `/api/docs` 404, 새 revision 오류 로그 없음. 운영 임상 문서는 읽거나 쓰지 않았다.

### 결제 일정(월간 일정표) 배포: 2026-11-02

- 사용자 요청으로 작업 트리 전체(미커밋 변경 포함, 브랜치 `feat/pay-schedule`)를 배포했다. 일정 관리 › 월간 일정표의 실제·결제 일정표, 아동·월별 결제 일정(`pay_plans`): 실제와 동일이면 그 달 실제 수업 처음 5회만 바우처, 입력하면 그 날짜가 바우처 서류와 정산 바우처 회수에 쓰인다. 함께 미배포였던 10/31 읽기 최적화도 이번에 반영됐다.
- 배포 직전 Python 3.12 pytest 241개, frontend build와 frontend 검증 14개가 통과했다. 새 쿼리는 동등 조건 또는 기존 인덱스만 써서 인덱스 변경은 없다(파일 46개 = 운영 46개). Cloud Build `2a8029ec-6279-4e79-9949-b4dd35dea2f8` SUCCESS, 업로드 72개 파일에 비밀값·가상환경·테스트·원문·추출물·문항 은행 없음.
- `slp-agent-api-00045-kob`(이미지 `sha256:13e7340e949569e5144844dfc3b66b060c6b0796b5609a966dc273155e922f0f`)를 무트래픽 후보로 확인한 뒤 트래픽 100% 전환했다. 이미지 외 runtime 설정 해시는 배포 전과 같다. `keep-current`·`latest`는 새 이미지, `keep-rollback`은 직전 `00042-giv` 이미지로 옮겼고 임시 태그는 지웠다.
- Firebase Hosting을 배포했다. 운영 `/`·`/schedule` 200(업무 경로 noindex), 번들 SHA 일치, `/api/healthz` 200, 익명 `/api/children`·`/api/pay-plans` 401, `/api/docs` 404, 새 revision 오류 로그 없음을 확인했다. 운영 임상 문서는 읽거나 쓰지 않았다.

### 바우처 HWP·날짜별 일정 수정 배포: 2026-11-02

- 사용자 요청으로 HWP 기본 다운로드·HWPX 선택·월별 ZIP, 날짜별 일정의 아동 이름·코드 표시와 담당 치료사 수정 기능을 배포했다. 고정 주간 시간표는 유지한다. 날짜 이동의 최초 `timetable_date`를 보존해 재생성과 주간표·휴무 변경에 따른 삭제를 막는다.
- 운영 `00040-9lw`의 배포 소스에 이번 변경만 적용한 별도 배포본을 만들었다. 동시 수정 중인 결제 일정·추가 읽기 최적화는 제외했다. Python 3.12 회귀 테스트 220개와 최종 관련 테스트 52개가 통과했다. 미배포 집계 API를 검증하는 `test_firestore_counts.py`, `test_operational_reads.py`는 배포본 검증에서 제외했다. 작업 트리 전체 테스트의 동시 결제 변경 관련 3개 실패는 이번 배포본에 포함되지 않는다.
- 기존 시간표 테스트의 실패는 현재 월과 조회 월이 달라지는 fixture 때문이었다. 명시적 `valid_from=2026-10-01`로 수정했다. 브라우저의 합성 치료사 계정으로 아동 이름, 날짜·시간·메모 수정, 새로고침 후 유지, 주간표 보존을 확인했다. 실제 Linux amd64 배포 이미지에서도 네트워크 없이 합성 데이터로 일정·권한·HWP·HWPX·ZIP 및 독립 HWP 파서를 검증했다.
- 새 Firestore 인덱스 `schedules(organization_id ASC, timetable_date ASC)` (`CICAgJjU8o8K`)만 추가하고 READY를 확인했다. Cloud Build `2bed800b-1971-4c21-86ef-ceebdccdae5a`는 SUCCESS이며 업로드 72개 파일에 비밀값·가상환경·테스트·임상 원문·추출물·문항 은행은 없다.
- 백엔드 `slp-agent-api-00042-giv`를 무트래픽 후보로 검증한 뒤 트래픽 100%로 전환했다. 이미지 `sha256:0760db9d1dcb09e93cdfb2cc3992ce0d6baf1fe73fac01c3f44cf00b4b262057` 외 runtime 설정·환경변수·Secret 참조·서비스 계정·scaling은 유지했다. 현재 이미지는 `keep-current`와 `latest`, 직전 `00040-9lw` 이미지는 `keep-rollback`으로 보호했다. 임시 후보 태그만 제거했고 이미지는 삭제하지 않았다.
- Firebase Hosting `c56be45cd10d01a7`을 19:47 KST에 배포했다. 공개 소개·검색 파일 5개는 이전 운영본과 동일하다. 배포 후 주요 정적 파일 9개의 SHA 일치, `/api/healthz` 200, 익명 아동·HWP API 401, `/api/docs` 404를 확인했다. 운영 임상 문서를 읽거나 쓰지 않았다. Windows 한글 출력은 미검증이다.

### 공개 소개페이지 Hosting 배포: 2026-10-26

- 사용자 승인 후 현재 frontend 작업본을 빌드해 `firebase deploy --only hosting --project slp-agent-2026`으로 배포했다. https://slpai.heonhwi.dev/ 에 정적 소개·출시 예정 요금제 3단계·`contact@heonhwi.dev` 문의 링크를 제공한다. Cloud Run·Firestore는 이 배포 대상이 아니다.
- 배포 전 Python 3.12 backend pytest 192개와 frontend build·검색 검증 11개가 통과했다. 이후 ChatGPT·Gemini 크롤러 검증 대상을 추가해 frontend 검증 14개가 통과했다. 배포 파일 49개에 원문·추출물·문항 은행·비밀값 파일이 없음을 확인했다.
- 운영 소개 HTML·CSS·robots·sitemap·llms 200, 업무 경로 noindex, 익명 `/api/children` 401, `/api/healthz` 200을 확인했다. Google·네이버·Bing 소유확인과 사이트맵 제출을 완료했다. 이후 Google의 추가 색인 요청도 재시도해 우선순위 크롤링 대기열 등록을 확인했다. ChatGPT 일반 채팅의 웹 검색에서 운영 페이지 읽기·출처 인용, Gemini 일반 Flash-Lite 채팅에서 운영·기본 Hosting 주소 읽기와 본문 일치를 검증했다. 실제 색인 상태와 AI 읽기 검증은 [검색 등록 기록](search-visibility.md)을 따른다.
- 같은 날 13:40 KST 일반 검색 의도에 맞춘 소개·메타·FAQ·공개 요약을 추가 배포했다. build·frontend pytest 14개·Python 3.12 backend pytest 192개와 독립 기능·시각 검토를 통과했으며, 수정한 공개 파일 외 배포 파일 45개는 이전 배포본과 동일했다. 운영 공개 파일 일치·noindex 경계·API smoke를 재확인하고 네이버·Bing에 변경 URL을 요청했다. Google 색인과 일반 검색·Gemini 추천 반영은 아직 대기 상태다.

### 이전 백엔드 배포 검증: 2026-10-26

- 사용자가 승인한 현재 백엔드 작업본을 Dockerfile로 빌드해 `slp-agent-api-00039-bpq`에 배포했다. Ready이며 트래픽 100%를 처리한다. frontend는 배포하지 않았다.
- 배포 직전 Python 3.12.13의 pytest 192개가 통과했다. 업로드 대상 71개 파일에 `.env`, 검사 문항 은행, 원문·추출물, 가상환경, 테스트가 포함되지 않음을 확인했다.
- Firebase Hosting과 운영 도메인의 `GET /api/healthz`는 200, 인증 없는 `GET /api/children`은 401, 운영 `GET /api/docs`는 404를 반환했다.
- 배포 전후 이미지 외 컨테이너 설정·환경변수·Secret 참조·서비스 계정·scaling 설정의 해시가 동일했다. CPU 1개, 메모리 2Gi, timeout 900초, concurrency 80, 최대 인스턴스 3개를 유지했다.
- 직전 운영 이미지(`slp-agent-api-00038-j6s`)는 고정 태그 `keep-rollback`, 현재 이미지는 `keep-current`로 보호했다. 다음 배포에서도 날짜별 태그를 계속 추가하지 말고 이 고정 태그를 해당 digest로 옮긴다.
- 실제 사용자별 읽기 수·청구액 감소는 배포 후 집계로 확인해야 한다. 인증된 임상 데이터의 운영 읽기·쓰기는 이 smoke test에서 수행하지 않았다.

### 추가 대화 조회 최적화 배포 검증: 2026-10-28

- 배포 전후 동일 시각 기준 24시간의 Cloud Run 요청 로그를 집계했다. 첫날 14건 중 health check 4건과 익명 `/api/children` 401 응답 4건은 임상 조회를 하지 않았다. 둘째 날에는 대화 목록 9건·대화 상세 4건이 있었고, 해당 API들이 호출된 분에 Firestore 읽기 583회·616회가 관측됐다. 분 집계는 여러 요청이 섞이므로 API별 청구량이나 최적화의 인과효과로 단정하지 않는다. 진단 중 임상 문서를 조회하지 않았다.
- 대화 목록은 모든 대화를 읽은 뒤 50개를 자르던 코드를 `list_latest(..., 50, user_id=...)`로 변경했다. 제목 없는 과거 대화는 전체 메시지 대신 `list_earliest(..., 1, conversation_id=..., role="user")`로 최초 사용자 메시지만 읽는다. 새 대화 생성 직후에는 존재할 수 없는 과거 메시지 조회를 생략한다. 대화 상세와 기존 대화의 모델 입력에는 종전처럼 전체 이력을 제공한다.
- 합성 Firestore 회귀 테스트에서 목록의 대화 75개 읽기가 50개로, 과거 제목용 메시지 200개 읽기가 1개로, 새 대화의 빈 메시지 쿼리 1회가 0회로 줄었다. 운영 일일 사용량·비용 감소 실측은 아니다.
- Python 3.12 pytest 197개와 신규 테스트의 코드 규칙 검사를 통과했다. 별도 로컬 uvicorn + curl에서도 합성 대화 76개·메시지 200개를 대상으로 목록 50개 반환·총 53 reads(권한 확인 포함), 상세 메시지 200개 보존, 다른 사용자 접근 404, 새 대화의 과거 메시지 reads 0을 확인했다. 임시 서버는 종료했다. `ruff`·`basedpyright`는 미설치라 실행하지 않았다.
- 사용자 승인 후 `chat_conversations(organization_id, user_id, updated_at DESC)`와 `chat_messages(organization_id, conversation_id, role, created_at ASC)` 인덱스 2개만 운영에 추가하고 둘 다 READY를 확인했다. 기존 인덱스는 보존했다.
- Python 3.12 pytest 197개를 배포 직전에 다시 통과한 뒤 현재 백엔드 작업본을 빌드했다. Cloud Build `edd31650-2412-42e0-9db9-8587a5ba2c9f`가 SUCCESS이며, 업로드 71개 파일에 `.env`·가상환경·테스트·임상 원문·추출물·검사 문항 은행이 포함되지 않았다. frontend는 배포하지 않았다.
- 새 revision `slp-agent-api-00040-9lw`는 2026-10-28 14:26:18 KST에 RoutesReady가 됐고, 14:26:58 KST에 트래픽 100% 전환을 확인했다. 이미지 digest는 `sha256:f8b83197175a7da0cd6ea675118bfd9e17d38649b6d52a756f8cb47b67195533`이다. 이미지 외 컨테이너 설정·환경변수·Secret 참조·리소스·runtime scaling 설정의 해시가 배포 전과 동일했다. CPU 1개·메모리 2Gi·timeout 900초·concurrency 80·최대 인스턴스 3개를 유지했다.
- 현재 이미지에는 `keep-current`, 직전 `slp-agent-api-00039-bpq` 이미지에는 `keep-rollback` 고정 태그를 연결했다. Hosting·운영 도메인 health API 200, 익명 아동 API 401, 운영 docs API 404를 확인했다. 실제 Firestore에서도 임의의 예약 기관 ID에 한정해 새 정렬·제한 쿼리 2개가 빈 결과로 정상 완료됨을 확인했다. 임상 문서를 읽거나 쓰지 않았다.
- 매일 10:00 KST 읽기·비용 감시의 최신 배포 기준을 `00040-9lw`로 갱신했다. 이전 `00039-bpq`의 실측은 별도 배포 구간으로 보존하며, 새 배포 전후를 가로지르는 24시간은 기준에서 제외한다. 이 배포의 실제 사용량·청구액 절감은 아직 확인 전이다.

### 읽기 증가 진단·추가 최적화: 2026-10-31 (배포 전)

- 10/30 09:50~10/31 09:50 KST의 Firestore `document/read_ops_count`는 23,449회이며 QUERY 21,984회(93.75%), LOOKUP 1,391회, NOT_FOUND 74회다. 같은 구간 Cloud Run 요청은 451건이다. 비교일 8건은 모두 HTTP 404였으므로 0 reads와의 차이를 최적화 회귀로 단정하지 않는다.
- 요청 로그에서 `/attendance/day` 9건, `/attendance/summary` 9건, `/schedules` 10건, `/platform/summary`·`/platform/organizations` 각 10건, `/billing/summary` 10건을 확인했다. `/me`와 아동별 녹음 목록은 각각 67건이다. 최대 읽기 분(10/30 12:29 KST, 2,820회)에는 출결·시간표와 출결 수정 요청이 겹쳤다. 분 단위 DB 지표는 모든 클라이언트의 합계이고 API 요청별 Firestore 쿼리 로그는 없어, API별 정확한 읽기 수·과금 기여율은 확정할 수 없다. Data Access 로그도 해당 구간에 수집된 항목이 없었다.
- 10/31 10:22 KST에 문서 내용 대신 서버 집계로 확인한 현재 활성 기관 1개의 일정은 10월 566개, 10/30 하루 21개다. 월 출결 문서는 8개, 아동 문서는 91개(보관 1개), 회기 문서는 0개, 녹음 작업은 14개다. 이는 현재 스냅샷이며 전날 청구 구간의 문서 수를 재구성한 값은 아니다. 기관·아동·계정 식별자와 임상 내용은 출력·기록하지 않았다.
- 일일 출결은 날짜별 일정·출결을 이미 읽었는데 결제 구분 표시를 위해 `classify_month`가 다시 월 전체 일정·회기·출결을 읽었다. 결제 구분은 수업별 선택값이므로 기존 `month_classes`·`billing.assign_pay`를 읽어 둔 데이터에 적용한다. 아동 월 출결도 동일 데이터의 중복 쿼리를 제거했다. 사비·인지·기존 `extra=paid`, 결석·사유결석·옮긴 수업의 표시 의미는 보존한다.
- 플랫폼 요약·기관 목록의 아동·회원·최근 30일 회기 수는 `Repo.count`/`count_range`로 집계한다. 아동 수는 전체 수에서 `archived=True` 수를 빼 기존 `archived` 누락 문서도 포함한다. 응답 필드·site-admin 권한·최근 활동 조회는 유지한다. 집계도 무료가 아니며 [공식 과금 기준](https://firebase.google.com/docs/firestore/pricing#aggregation_queries)에 따라 스캔한 인덱스 항목에 대한 읽기와 최소 1회 읽기가 청구될 수 있다.
- `/billing/summary`는 아동 접근 권한과 `YYYY-MM`을 검증한 뒤 Firestore에서 해당 아동·해당 월만 읽는다. 기존 전체 회기 이력 로딩을 제거했고 금액 계산은 `services/billing.py`에 유지했다.
- 합성 Firestore 테스트에서 일일 출결의 일정 읽기 502회가 1회로(다른 날짜 500개), 불필요한 회기 읽기 50회가 0회로 줄었다. 아동 월 출결의 일정 읽기는 6회에서 3회, 청구 요약의 회기 읽기는 302회에서 2회, 플랫폼 통계의 아동 읽기는 103회에서 집계 2회로 줄었다. 이 값들은 개별 컬렉션의 합성 테스트 결과이며 운영 일일 절감률·확정 비용이 아니다.
- Python 3.12 pytest 215개가 통과했다. 합성 테스트는 기관·아동·권한 경계, 월 경계·잘못된 월 입력, 보관 필드 누락, 쓰기 후 집계 갱신, 집계 최소 읽기·1,000개 경계, 기존 결제 구분을 검증한다. 실제 Firestore에서도 임의의 빈 예약 기관에 한정한 집계 4개·아동별 월 기간 쿼리 1개가 기존 인덱스로 정상 완료됐다. 운영 집계 진단에서도 실제 양수 집계값을 확인했으며 임상 문서를 다운로드하거나 쓰지 않았다.
- 새 repo 구현·신규 테스트·Firestore fake의 코드 규칙 검사를 통과했다. `basedpyright`는 미설치이고 기존 설치 거절을 존중해 LSP 검사를 실행하지 못했다. 기존 큰 라우터와 Protocol의 사전 존재 타입 규칙 문제는 이번 최소 변경에서 확장하지 않았다. frontend·Cloud Run 배포·인덱스·과금 설정은 변경하지 않았다. 추가 최적화는 현재 백엔드 작업본에만 있으며 운영 반영 승인이 필요하다.

## 비용 관리

비용 보고서는 결제 계정 전체가 아닌 해당 프로젝트로 필터링하고, 무료 사용량 차감 후 소계를 확인한다. Firestore 무료 읽기 한도는 일별이므로 월 합계만으로 초과 여부를 판단하지 않는다. Blaze 요금제와 예산 알림은 0원 과금을 보장하지 않는다. Spark로 전환하면 현재 Cloud Run API를 운영할 수 없다.

배포 이미지가 쌓이면 요청이 없어도 Artifact Registry 저장 비용이 발생한다. 저장소 루트의 `artifact-cleanup.json`은 `slp-agent-api` 패키지의 **태그 없는 7일 초과 이미지**만 삭제 대상으로 삼고, 패키지별 최신 3개는 보존한다. 태그가 있는 이미지는 삭제 대상이 아니다. 다른 서비스의 이미지에는 적용하지 않는다. 이 서비스의 새 패키지를 만들 때도 같은 접두사를 사용한다.

먼저 현재 트래픽을 받는 모든 revision의 이미지 digest가 태그로 보호되는지 확인한다. 현재 이미지가 최신 3개라는 사실만으로는 보호가 지속되지 않는다. 새 빌드가 쌓이면 최신 목록에서 밀려날 수 있으므로, 운영 이미지와 계속 필요한 롤백 이미지에는 보존용 태그를 유지한다. 기존 cleanup policy가 있다면 덮어쓰지 말고 먼저 병합한다.

```sh
gcloud artifacts repositories set-cleanup-policies REPOSITORY \
  --project=PROJECT_ID --location=REGION \
  --policy=artifact-cleanup.json --dry-run
```

`--dry-run`은 설정을 저장하지만 이미지는 삭제하지 않는다. 대상과 운영 이미지 보호를 검토하고 사용자의 영구 삭제 승인을 받은 뒤에만 같은 명령에서 `--dry-run`을 `--no-dry-run`으로 바꾼다. 자동 정리는 비동기로 실행된다. 이미지 삭제 후에도 미참조 레이어는 Google의 일일 정리 때 제거되므로 저장 용량과 요금 반영에 시간이 걸린다. 삭제된 이미지에 의존하는 과거 revision으로는 롤백하지 않는다. 임상 기록, Firestore 문서, 녹음, 비밀값은 이 정책의 대상이 아니다.

Firestore 조회 비용을 줄일 때는 기존 `list_range` / `list_latest` 및 지식자료 캐시를 재사용한다. `account_access`, 기관 상태, 아동 담당자 등 권한 판단 데이터를 요청 간 캐시해서 계정 정지·기관 이동·담당 변경 반영을 늦추지 않는다. Cloud Run은 최소 인스턴스 0과 요청 기반 과금을 유지하되, STT 작업에 필요한 메모리와 timeout을 확인 없이 줄이지 않는다.

`repo/request_cache.py`는 동일 HTTP 요청 안에서 같은 문서와 필터 없는 목록의 Firestore snapshot을 재사용한다. 기관과 저장소 인스턴스를 구분하고, 응답 데이터는 매번 복사한다. 쓰기 전에는 전체 요청 캐시를 무효화하며 정상 종료·예외 모두에서 캐시를 비우고 닫는다. 다음 요청과 백그라운드 작업에는 권한 데이터 캐시를 이어 쓰지 않는다. 단일 아동·기록 접근 권한은 해당 아동 문서와 연결된 치료사 이름만 확인한다. 기존 지식자료 5분 캐시는 별도로 유지한다. `tests/test_firestore_reads.py`와 `tests/test_firestore_request_cache.py`가 읽기 수·기관 격리·권한 갱신·쓰기 무효화·요청 수명을 검증한다.

공식 기준: [Artifact Registry 요금](https://cloud.google.com/artifact-registry/pricing), [이미지 삭제](https://cloud.google.com/artifact-registry/docs/docker/manage-images), [cleanup policy](https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy), [Firestore 할당량](https://firebase.google.com/docs/firestore/quotas), [Firebase 요금제](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

## Firebase Auth 및 기관 온보딩

관리자는 Firebase Authentication에서 사용자를 만든 뒤 서버 측 스크립트로 `org_id`, `role` 클레임을 설정한다. 먼저 dry-run을 확인하고, 승인된 변경에만 `--apply`를 붙인다.

```sh
cd backend
.venv/bin/python scripts/set_firebase_claims.py --uid USER_UID --org-id ORG_ID --role admin
.venv/bin/python scripts/set_firebase_claims.py --uid USER_UID --org-id ORG_ID --role admin --apply
```

`--apply`는 custom claims를 갱신하고 refresh token을 폐기한다. 사용자에게 다시 로그인하도록 안내하고 새 ID token의 기관·역할을 확인한다. 기관 문서의 `id`와 `organization_id`는 `org_id`와 같아야 한다. 첫 계정은 `admin`, 이후 치료사는 `therapist`, 읽기 전용 보조 인력은 `assistant`로 부여한다.

## Firestore, 백업, 복구

클라이언트 직접 접근 규칙은 deny-all이다. API Admin SDK만 데이터에 접근한다. 인덱스 정의는 `firestore.indexes.json`에 둔다.

```sh
firebase deploy --only firestore:rules,firestore:indexes --project PROJECT_ID
```

운영 프로젝트에서 Firestore PITR을 활성화하고, 별도 백업 버킷으로 주기적 export를 설정한다. 백업 버킷은 서비스 데이터 버킷과 분리하고 접근 권한을 제한한다. 복구 시 격리 프로젝트에 export를 import해 문서 수, 조직 경계, 권한을 점검한 뒤 승인된 변경 절차로 운영에 반영한다. 주기적 복구 리허설 결과를 기록한다.

## 보유·삭제 및 개인정보

법령상 보유기간을 이 코드가 정하지 않는다. 기관의 계약·기록 의무와 전문가 검토로 기간을 정한다. 아동 보관 API는 `archived=true`, `archived_at`으로 소프트 삭제한다. 영구 삭제 스크립트는 `--retention-days`가 필수이며 기본은 dry-run이다. 기간 승인 후 기관별 실행에 `--apply`를 사용한다.

```sh
cd backend
.venv/bin/python -m scripts.purge_archived_children --org-id ORG_ID --retention-days APPROVED_DAYS
.venv/bin/python -m scripts.purge_archived_children --org-id ORG_ID --retention-days APPROVED_DAYS --apply
```

영구 삭제는 아동 문서, 관련 회기·상담·AI 초안·대화, 생성 문서 파일을 제거하고 기존 감사 이벤트에서 아동 연결값을 지운다. 삭제 작업 감사 이벤트는 아동 ID 해시만 남긴다. 감사로그 자체의 별도 보유기간도 기관이 정해야 한다.

OpenAI 전송 점검: 알려진 아동 이름·보호자 연락처·전화번호·이메일은 채팅 입력/이력에서 가리고, 가명 코드와 필요한 평가·관찰 필드만 전달한다. 패턴으로 알아내지 못하는 개인정보가 있을 수 있으므로 사용자 입력도 가명화한다. 모델 ID는 환경변수, 키는 Secret Manager, `store=False`를 사용한다. 지식자료 원문은 현재 검색 결과에서만 기관 내부 API로 반환한다. 임베딩으로 원문 텍스트를 외부 전송하려면 저작권 권한을 별도 확인하고 `OPENAI_ALLOW_REFERENCE_EMBEDDING_UPLOAD=true`를 명시적으로 설정해야 한다. 기본값은 `false`이며 키워드 검색으로 폴백한다.

국외 이전·처리 위탁 체크 항목: 데이터 항목과 목적, 처리자·재위탁자, 리전, 보유·삭제 시점, 접근 통제·사고 통지, 이용자 고지·동의 및 계약 조항을 확인한다. 이 문서는 법률 자문이 아니며 개인정보·의료정보 전문가와 법률 전문가의 확인이 필요하다.

## 운영 보안

- 모든 업무 API 라우트는 `Principal` 인증 또는 제한된 서명 다운로드를 사용한다. org 경계는 Repo 조회에서 강제한다.
- 속도 제한은 두 단계이며 모두 프로세스 메모리 기준이다. (1) 계정별: 토큰 검증 뒤 uid마다 `RATE_LIMIT_REQUESTS`(기본 120)/분. (2) TCP 연결 상대 주소별: 인증 전에 `RATE_LIMIT_ADDRESS_REQUESTS`(기본 1200)/분. `X-Forwarded-For`와 검증 전 `Authorization` 값은 키에 쓰지 않는다. Cloud Run에서 같은 프록시 주소로 들어오는 요청은 (2)의 버킷을 공유하므로 (2)는 서비스 전체 과부하 방지용이다. 인스턴스 사이에 상태가 공유되지 않으므로, 전체 서비스 한도는 Cloud Armor 등 앞단에서 설정한다.
- 감사로그 조회는 기관 `admin` 전용 `GET /admin/audit-logs`다.
- GitHub Actions는 pytest와 `pip-audit`를 실행한다. dependency 취약점 해결은 승인된 버전 변경으로 진행한다.

## 2026-11-09 월간 일정·아동 종결 배포

- 사용자 승인으로 Cloud Run `slp-agent-api-00047-gq4`에 트래픽 100% 전환. 이미지 digest는 `sha256:8e85194fbee5ae9b783deb9f9e94ab04b6bc1fc9d3759411d4fff887d00e5d68`. 직전 serving revision은 `slp-agent-api-00046-pzg`.
- 직전 운영 이미지를 기준으로 `deps.py`, routers의 `children.py`, `schedules.py`, `attendance.py`, `timetable.py`, `voucher_doc.py`, `settlement.py` 7개 파일만 교체했다. Cloud Build `8676cb63-aa00-4097-9547-a5bf496cba78` 성공.
- 월간 실제 일정 빈칸에서 등록 아동 수업 추가, 관리자의 기관 전체 월간 수정, 선택한 종결일부터 수업 취소·이전 기록 보존, 바우처 등급 저장 시 장애등록 Y를 반영했다. 다른 기관 경계와 치료사 담당 범위는 API에서 검증한다.
- Firebase Hosting에 삭제 확인 모달, 날짜별 보강 잡기, 종결 아동 목록, 개인정보 FAQ를 배포했다. 운영 관리자 계정에서 월간 수정 열기·추가 버튼, 삭제·보강 모달, 공개 FAQ와 개인정보처리방침 링크를 확인했다.
- Python 3.12 pytest 267개, 공개 페이지 테스트 14개, frontend build와 mobile typecheck, 합성 브라우저의 추가·삭제 확인·보강·종결·FAQ 흐름을 통과했다. 운영 health 및 SPA 라우팅을 확인했다. Android 새 바이너리 배포는 이번 승인 범위에 포함되지 않았다.
