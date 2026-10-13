# 장시간 녹음 받아쓰기 (STT) — 구조와 운영

사용자는 녹음 파일 하나만 올리면, 서버가 압축·분할·전사·통합·AI 요약까지 처리하고 치료사가 검토·승인합니다.

## 흐름
1. `POST /children/{id}/recordings` — 녹음 동의 확인 후 작업 생성, 업로드 대상 발급 (운영: 비공개 버킷의 resumable 세션 URL)
2. 브라우저가 8MiB 단위로 직접 업로드 (진행률, 끊기면 `bytes */size` 조회 후 이어 올림) → `POST /recordings/{id}/complete`
3. Cloud Tasks 큐(`stt-jobs`, 동시 1개)가 단계별로 호출: 준비 → 구간 받아쓰기(구간당 1단계) → 병합 → 요약
4. 치료사가 녹취록·8개 항목을 수정하고 승인 → `recording_records`에 저장

## 처리 규칙
- 파일 검증: 확장자 허용 목록 + ffprobe로 실제 디코딩. 크기 상한·작업 공간은 환경변수.
- 압축: 모노 16kHz MP3 48kbps. 이미 작은 모노 원본은 재인코딩하지 않고 바로 분할하며, 원본 비트레이트보다 높게 인코딩하지 않음(최저 32kbps). 신뢰도가 낮은 구간은 원본에서 64kbps로 다시 잘라 재시도.
- 분할: 기본 5분(관리자 설정 3~10분), 경계 ±30초 안의 무음 가운데에서 자름, 1.5초 중첩, 구간 24MB 미만 확인.
- 병합: 중첩 구간 중복 제거(경계 직후 3초 내 동일 문장 제거), Whisper가 비음성으로 판단한 구간 제외, 실패 구간·20초 이상 무음 표시. 화자 구분 안 함.
- 한도: Groq 오디오 초(시간당·일일)를 서버 원장으로 관리(요청당 최소 10초 과금 반영), 429 `retry-after` 우선, 없으면 지수 백오프+지터, 구간 요청 간 최소 간격.
- 예비: 관리자 허용 + 예상 비용이 월 상한 이내일 때만 OpenRouter Whisper(데이터 비보관 라우팅). 불가하면 작업 대기.
- 요약: gpt(기존 모델) 8개 항목, 녹음에 없으면 "확인되지 않음". 진단 금지. 아동 이름·연락처는 가린 뒤 전송.
- 정리: 병합 후 구간 파일과 원본 삭제(보관 설정 시 최대 30일). 버킷 수명주기: tmp/ 3일, original/ 30일.
- 로그에 녹취 내용·파일 내용 기록 금지. 관리자 통계는 숫자만.

## 파일
- 백엔드: `app/services/stt/{audio,merge,providers,budget,store,queue,jobs}.py`, `app/routers/recordings.py`, `app/routers/platform.py`(STT 설정·통계), `app/routers/proposals.py`(승인)
- 프론트: `src/lib/upload.ts`, `src/components/{RecordingConsultation,RecordingRecords,SttAdmin}.tsx`
- 테스트: `tests/test_recordings.py` (실제 ffmpeg + 가짜 STT/LLM)

## 환경변수
| 이름 | 운영 값 | 설명 |
|---|---|---|
| GROQ_API_KEY | Secret Manager | |
| STT_MODEL | whisper-large-v3-turbo | |
| GROQ_AUDIO_SECONDS_PER_HOUR / _PER_DAY | 7200 / 28800 | Groq 무료 플랜 공개값(콘솔 Limits에서 확인 후 조정) |
| OPENROUTER_API_KEY | Secret Manager | 예비 |
| OPENROUTER_STT_MODEL | openai/whisper-large-v3-turbo | |
| OPENROUTER_STT_USD_PER_HOUR | 0.04 | 사용 전 비용 추정(실측 단가가 더 높으면 실측 사용) |
| RECORDINGS_BUCKET | slp-agent-2026-recordings | 비어 있으면 로컬 디렉터리 |
| STT_TASKS_QUEUE / SERVICE_URL / STT_TASKS_INVOKER | 큐 경로 / run.app URL / 런타임 SA | 비어 있으면 개발용 내장 큐 |
| STT_MAX_UPLOAD_MB / STT_TMP_LIMIT_MB / STT_MAX_MINUTES | 200 / 1200 / 180 | |
| STT_BITRATE_KBPS / STT_RETRY_BITRATE_KBPS / STT_OVERLAP_SECONDS / STT_MIN_REQUEST_INTERVAL_SECONDS | 48 / 64 / 1.5 / 3 | |

## 제약
- Cloud Run 메모리(2GB)가 /tmp를 겸하므로 원본 200MB 상한. 더 큰 파일은 분할해서 업로드.
- 무료 한도(시간당 2시간 분량)를 넘는 녹음은 다음 시간대에 이어서 처리되므로 완료까지 시간이 걸릴 수 있음.
- 화자 분리 없음. 음성 인식 오류는 치료사 검토로 보정.
