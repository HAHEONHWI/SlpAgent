# 배포·보안·운영

실제 배포는 아직 수행하지 않았다. `cloudbuild.yaml`은 변수를 채운 뒤 사용한다. 실제 프로젝트 ID, Secret, 도메인을 저장소에 넣지 않는다.

## Cloud Run

1. Artifact Registry 저장소 `slp-agent`와 Cloud Run 런타임 서비스 계정을 만든다.
2. 런타임 계정에는 Firestore용 `roles/datastore.user`, 전용 버킷에 한정한 `roles/storage.objectAdmin`, 설정한 Secret에 한정한 `roles/secretmanager.secretAccessor`, URL 서명에 필요한 `roles/iam.serviceAccountTokenCreator`를 부여한다. Cloud Build 배포 계정은 Artifact Registry 저장소 쓰기, Cloud Run 배포, 런타임 계정 사용 권한만 받도록 범위를 제한한다. OpenAI Secret은 운영자가 만든 뒤 연결하며 저장소에 값은 넣지 않는다.
3. Cloud Build substitutions의 `_REGION`, `_SERVICE`, `_SERVICE_ACCOUNT`, `_GCS_BUCKET`, `_OPENAI_MODEL`, `_OPENAI_EMBEDDING_MODEL`, `_ALLOW_REFERENCE_EMBEDDING_UPLOAD`, `_CORS_ORIGINS`를 프로젝트 값으로 설정한다. Artifact Registry 경로와 Secret 이름은 프로젝트에서 확인한다. 원문 임베딩 전송은 저작권 권한 검토 후에만 허용한다.
4. Firestore 인덱스와 deny-all 규칙을 먼저 배포한 뒤 Cloud Build를 실행한다. API는 Firebase ID token을 검증한다. Cloud Run 공개 진입점 뒤에 애플리케이션 인증이 적용된다.
5. 프론트엔드는 `frontend/dist`를 Firebase Hosting에 올린다. 프론트 소유자가 빌드한 다음 `firebase deploy --only hosting --project PROJECT_ID`를 실행한다. 이 저장소는 프론트 파일을 수정하지 않는다.

보존 작업을 Cloud Run Job으로 실행할 때는 동일 이미지를 사용하고 `python -m scripts.purge_archived_children --org-id ORG_ID --retention-days APPROVED_DAYS --apply`를 컨테이너 command/args로 지정한다. 기관별 승인 기간과 실행 주기를 운영자가 설정하며, 이 저장소에서는 Job이나 Scheduler를 생성하지 않는다.

비공개 Cloud Storage 객체는 V4 서명 URL로 15분간 제공한다. 런타임 서비스 계정이 서명할 수 있도록 IAM Sign Blob 권한이 필요하다. 로컬 대체 저장소는 `DOCUMENT_URL_SIGNING_KEY`가 있어야 하며, 운영에서는 GCS를 사용한다.

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
- 기본 속도 제한은 설정된 요청 수/분, 토큰 해시별 프로세스 메모리 기준이다. Cloud Run 인스턴스 사이에는 공유되지 않으므로 다중 인스턴스 한도는 Cloud Armor 등 앞단에서 설정한다.
- 감사로그 조회는 기관 `admin` 전용 `GET /admin/audit-logs`다.
- GitHub Actions는 pytest와 `pip-audit`를 실행한다. dependency 취약점 해결은 승인된 버전 변경으로 진행한다.
