# 개인정보 보유 및 삭제 정책 초안

이 문서는 운영 절차 초안이며 법률 자문이 아니다. 기관별 기록 의무와 계약에 맞춰 개인정보·의료정보 및 법률 전문가의 확인을 받은 뒤 보유 기간을 설정한다.

## 상태 전이

1. 치료사가 아동을 보관하면 `archived=true`, UTC `archived_at`을 기록한다. 일반 아동 목록에서 제외한다.
2. 기관이 정한 보유기간이 지난 항목을 `purge_archived_children.py` dry-run으로 검토한다.
3. 담당 관리자가 기관 ID와 승인된 기간을 확인한 뒤 `--apply`로 영구 삭제를 실행하고 결과를 보관한다.
4. 아동 문서와 아동 연결 문서, 대화, 생성된 객체를 삭제한다. 감사로그는 아동 연결 필드를 제거하고 삭제 이벤트는 식별 불가능한 단방향 ID 해시만 남긴다. 감사로그 보유 기간은 별도로 정한다.
5. 삭제 후 조직별 문서 수와 객체 저장소를 점검한다. 백업본의 만료 시점과 복원 시 삭제 재적용 절차도 정한다.

기본 보유 일수와 자동 Scheduler는 설정되어 있지 않다. 명시된 `--retention-days`가 없으면 스크립트는 실행하지 않는다. 운영자가 기관별 승인 기간과 Cloud Run Job 주기를 정한 뒤 실행한다.

## 공개 방침과 운영 설정 대조 (2026-11-03)

- 공개 방침 `frontend/src/content/privacy-policy.md` 버전 `2026-11-03.1`은 웹·Android에 공통 적용한다. 동의 기록 버전은 웹 `frontend/src/lib/privacy.ts`, Android `mobile/src/lib/config.ts`와 맞춘다. 운영자·개인정보 보호책임자 하헌휘는 사용자가 확인했다.
- 임상 문서를 읽지 않고 Cloud Run 설정·Firestore 데이터베이스 메타데이터·버킷 설정·플랫폼 STT 설정만 확인했다. 업무 데이터베이스·파일 저장소는 서울 리전이다.
- 녹음 원본 추가 보관은 현재 0일이다. 병합 후 파일 삭제를 요청하며, 잔여 분할 파일 `tmp/`는 생성 3일, 원본 `original/`은 생성 30일 후 삭제하는 버킷 수명주기 규칙이 있다. 수명주기 실행 지연이 있을 수 있다.
- 녹음·문서 버킷은 삭제 후 7일의 soft delete를 사용한다. Firestore PITR은 꺼져 있고 이전 버전 보관 설정은 1시간이다. 활성 자료 삭제를 모든 복구 사본의 즉시 소멸로 표현하지 않는다.
- Cloud Logging 일반 로그는 30일, 클라우드 인프라 관리·시스템 감사로그는 400일이다. 서비스 DB의 `audit_logs` 및 차단 식별자와는 별개다.
- 회원 탈퇴는 Firebase 인증 계정·회원 문서·가입 신청을 삭제한다. 차단 식별자와 감사기록, 기관 소유 기록은 남을 수 있다. Firebase는 삭제 요청 후 인증 정보의 운영·백업 사본 제거에 최대 180일을 고지한다.
- 기관 기록·서비스 감사기록에는 공통 자동 파기 기한이 없다. 공개 방침에도 이 사실과 삭제 요청·기관별 보유기간 확인 경로를 명시했다. 상한·법정 보존 의무·정기 파기 절차는 기관과 자격 있는 개인정보·법률 전문가가 검토해 확정해야 한다. 이 문서와 공개 방침 수정은 법률 자문이나 적법성 인증이 아니다.
- 외부 처리 근거: [Firebase](https://firebase.google.com/support/privacy), [OpenAI](https://developers.openai.com/api/docs/guides/your-data), [Groq](https://console.groq.com/docs/your-data), [OpenRouter](https://openrouter.ai/privacy), [연결 사업자](https://openrouter.ai/openai/whisper-large-v3-turbo), [DeepInfra](https://deepinfra.com/privacy). ZDR 요청 조건과 보안·법적 예외를 구분한다.

## 화면에서 삭제

- 치료사·관리자가 아동 관리에서 `삭제`하면 위 1단계(보관)와 같다. 오늘 이후 예정 일정은 취소되고 주간 시간표에서 빠진다. `삭제된 아동`에서 복구할 수 있다(`POST /children/{id}/restore`).
- 기관 관리자는 `삭제된 아동`에서 아동 이름을 입력해 즉시 `영구 삭제`할 수 있다(`POST /children/{id}/purge`). 보관되지 않은 아동은 영구 삭제할 수 없다. 삭제 범위는 스크립트와 같은 `app/services/child_purge.py`를 쓴다.

