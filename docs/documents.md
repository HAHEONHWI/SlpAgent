# 문서 생성 및 서식 검수

## 바우처 HWP 다운로드 (2026-11-02)

바우처 화면은 HWP를 기본으로 제공하며 HWPX도 선택할 수 있다. 기존 `POST /children/{id}/voucher-hwpx` 요청에 `"format": "hwp"`를 추가하면 HWP, 생략하면 기존 HWPX를 반환한다. 여러 달은 선택한 형식의 파일을 ZIP으로 묶는다. 아동·기관 권한과 감사로그는 그대로 적용한다.

HWPX 양식을 채운 뒤 [hwp-cli v1.3.1](https://github.com/STAIxBWLB/hwp-cli/releases/tag/v1.3.1)의 `hwp convert voucher.hwpx -o voucher.hwp --preserve-layout --strict`로 서버 안에서만 변환한다. 임시 파일은 성공·실패 모두 정리한다. 변환기 미설치·실패·시간 초과는 HTTP 503이며 HWPX로 내려받을 수 있다. Docker 이미지와 CI는 SHA-256으로 검증한 바이너리를 설치하고 라이선스는 이미지의 `/usr/local/share/doc/hwp-cli/`에 포함한다.

로컬 개발은 해당 OS/CPU용 v1.3.1 릴리스와 `.sha256`을 받아 해시를 대조하고, 압축을 푼 디렉터리를 PATH에 추가한 뒤 `hwp --version`을 확인한다. `cd backend && .venv312/bin/python -m pytest tests/test_voucher_hwp.py tests/test_voucher_hwpx.py -q`로 검증한다. 변환기가 없는 환경에서는 실제 변환 테스트만 skip한다.

Mac 한글에서 합성 4회 HWP는 3쪽, 9회 HWP는 5쪽으로 열리는 것을 확인했다. 기본 변환은 4회에서도 4쪽이 되어 `--preserve-layout`이 필요했다. 복제 페이지는 상위 문단의 레이아웃을 유지하고, 수정한 셀의 캐시만 지워 9회에서도 불필요한 빈 페이지를 막는다. 한글 버전·폰트·긴 회기 내용에 따라 출력 서식 검수는 계속 필요하다. 아래는 일반 문서 생성기의 이전 검수 기록이다.

검증: 브라우저 HWP·HWPX·2개월 ZIP 다운로드, 독립 `syhwp` 파서, frontend build와 Linux arm64 이미지·amd64 변환을 확인했다. 기존 시간표 테스트의 날짜 의존성은 명시적 시작일로 수정했다. 분리한 배포본의 Python 3.12 회귀 테스트 220개, 최종 관련 테스트 52개 통과. 실제 Linux amd64 배포 이미지에서도 합성 데이터로 HWP·HWPX·ZIP·일정 수정·권한을 검증했다. 2026-11-02 백엔드 `slp-agent-api-00042-giv` 트래픽 100% 및 Hosting `c56be45cd10d01a7` 배포 완료. 동시 작업 중인 결제 일정·추가 읽기 최적화는 제외했다. 실제 임상 데이터 수정과 Windows 한글 확인은 수행하지 않았다. 상세 배포 기록은 `docs/operations.md`.

지원 형식은 DOCX와 PDF다. PDF에는 배포 이미지의 Noto Sans CJK 폰트를 포함한다. 별도 폰트를 쓸 때는 재배포·임베딩 라이선스를 확인한다. 금액·시간은 `services/billing.py` 결과만 사용한다. 승인번호, 날짜, 서명은 수기 입력란이다. 미승인 DOCX에는 초안 표시, PDF에는 초안 워터마크가 있다.

생성된 파일은 기관·아동별 비공개 Cloud Storage 경로에 저장하고 15분 서명 URL을 반환한다. 로컬에서는 HMAC 서명 URL로 대체한다. 승인 시 파일에서 초안 표시를 제거하고 감사로그를 남긴다.

## 서식 비교 체크리스트

- [ ] 바우처 HWPX 원본의 월별 제공시간 표, 제공시간·바우처·추가구매 합계, 이용금액, 서명란, 승인일자·번호·상태·결과, 별지를 한컴오피스에서 확인한다.
- [ ] 생성된 서비스 제공기록지와 원본을 같은 페이지 크기·방향으로 나란히 비교한다.
- [ ] 표의 열 너비, 줄바꿈, 페이지 나눔, 한글 폰트 포함, 서명란 빈칸을 확인한다.
- [ ] DOCX/PDF에서 누락 일자, 월 경계, 분 계산과 합계를 테스트 데이터로 확인한다.

현재 받은 HWPX에는 코드가 치환할 `{{token}}`이 없다. 따라서 원본 구조를 보존하며 텍스트 노드를 바꾸는 생성은 중단되고 HWPX 출력은 미검증이다. 로컬 LibreOffice 변환도 `source file could not be loaded`로 실패했고 한컴오피스 검증 환경도 없어 완료로 표시하지 않는다.

`Contents/section0.xml`은 로컬에서 XML로 확인했다. 표 10개, 행 58개, 셀 286개, 문단 336개, 텍스트 노드 166개이며 지원하는 치환 토큰은 0개다. 원본 미리보기는 A4 세로 1페이지다. 합성 입력의 생성 PDF도 A4 세로 1페이지로 확인했다.

원본 HWPX 미리보기와 합성 데이터 DOCX/PDF를 시각 비교했다. DOCX/PDF는 세로 페이지의 단순 표로 월별 회기 행과 합계·서명/승인 빈칸을 제공하지만, 원본의 주별 칸 배치, 색상 구획, 긴 결과·별지 영역까지 같은 서식을 재현하지 않는다. 페이지 나눔·원본과 같은 모양의 HWPX 출력은 미완료다. 비교용 합성 파일은 ignored `extracted/layout-compare/`에 생성하며 개인 정보를 포함하지 않는다.

재현: `cd backend && .venv/bin/python -m scripts.render_document_preview --font-path /path/to/licensed-korean-font.ttf`.

## HWPX 한컴오피스 확인 (2026-10-12)

이 Mac의 Hancom Office HWP에서 합성 데이터 HWPX를 열어 확인했다.

- 확인 방법: 바우처 예시 HWPX의 기존 텍스트 5곳(제목 월, 생년월일, 별지·일정표 아동 표기)만 `{{month}}`, `{{birth_date}}`, `{{child_alias}}`, `{{draft_watermark}}` 토큰으로 바꾼 검증용 템플릿을 `extracted/hwpx-check/`(git 제외)에 만들고 `render_document(..., "hwpx")`로 생성했다.
- 결과: 한컴오피스에서 오류 없이 3쪽으로 열렸고, 토큰 위치에 생성 값과 "초안 · 치료사 승인 전" 표시가 들어갔다. → zip 재작성 방식(`mimetype` 첫 항목·무압축 유지)은 한컴 호환으로 확인됨.
- 한계: 예시 파일은 빈 서식이 아니라 작성된 샘플이다. 토큰이 없는 칸에는 샘플 값(제공기관명, 담당자, 일정표 날짜·시간, 관리번호 등)이 그대로 남는다. 회기별 시작·종료시간, 합계, 금액 칸에도 토큰이 없어 채워지지 않는다.
- 운영 사용 조건: 기관이 **빈 서식**에 모든 입력 칸의 토큰을 넣은 템플릿을 제공해야 한다. 그 전까지 HWPX 출력은 "미완료"로 유지한다. 회기 행처럼 반복되는 표는 단순 치환으로 채울 수 없어 행 복제 로직이 추가로 필요하다.
