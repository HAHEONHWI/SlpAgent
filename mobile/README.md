# SLP AI 안드로이드 앱

React Native(Expo SDK 58) 네이티브 앱입니다. 웹(`frontend/`)과 같은 Firebase 계정·같은 백엔드 API를 씁니다. 웹뷰가 아닙니다.

## 들어 있는 기능

| 탭 | 내용 (웹 메뉴) |
|---|---|
| **녹음** (가운데, 첫 화면) | 아이 고르기 → 보호자 상담 녹음(치료 회기로 변경 가능, 화면 꺼져도 계속, 일시정지, 최대 3시간) 또는 녹음 파일 선택 → 자동 업로드(끊기면 이어 올리기) → 받아쓰기·요약 진행 표시 → 녹취록·8개 항목 수정 → 승인하면 아동 기록에 저장. 올리지 못한 녹음은 휴대폰에 남아 ‘다시 올리기’ 가능 |
| 일정 | 주간 시간표(요일별, 편집·칸 닫기·시간/교사 설정), 월간 일정표(실제/결제 일정, 결제 날짜 편집), 날짜별 일정(추가·수정·취소), 기관 휴무일 |
| 출결 | 일별 출결(출석·결석·사유결석·지각, 결제 구분, 보강 잡기, 시간 수정, 수업 추가), 월별 현황 + 엑셀 내보내기(공유), 장기결강, 전체 휴강 |
| 기록 | 수업 기록 쓰기(활동 정확도·발화·관찰 포함), 지난 기록·녹음 기록, 수업 기록 조회(월·아동·치료사·기록 없는 수업) |
| AI | AI 대화(지식/임상 모드, 대화 기록, 파일 첨부, 초안 생성 허용), 치료활동 생성, 승인 대기 초안 검토 |
| 메뉴(≡) | 아동 관리(등록·수정·엑셀 일괄 등록·휴지통·영구 삭제), 내 계정(비밀번호 변경·로그아웃·**회원 탈퇴**) |

로그인·회원가입·가입 승인 대기 화면도 웹과 같습니다. 바우처 서류·정산·기관 설정·발달 분석 등 행정 화면은 웹에서 이용합니다.

녹음·수업 기록에서 날짜를 고르면 해당 아동의 시간표 시작 시각과 40분 뒤 종료 시각이 채워집니다. 수업이 여러 개면 바꿔 고를 수 있고, 시간이 다르면 직접 수정할 수 있습니다.

## 개발 실행

### 홈 화면 일정 위젯 (Android 1.0.3, 코드 11)

- 내 계정 › 홈 화면 일정 위젯에서 **다음 수업 (4×2)** 또는 **오늘 일정 (4×4)**을 추가합니다. Android 홈 화면의 위젯 목록에서도 `SLP AI`를 선택할 수 있습니다.
- 본인과 연결된 치료사의 날짜별 수업을 읽습니다. 취소·보강 이동 전 수업과 접근할 수 없는 아동은 제외합니다. 사용자 요청에 따라 두 크기 모두 아동 이름 전체를 표시합니다. 큰형의 목록은 스크롤할 수 있습니다.
- 수업을 누르면 해당 날짜의 일정이 열리고 선택 수업을 강조합니다. 위젯에서 직접 수정·삭제하지 않습니다.
- 앱 복귀·일정 변경·위젯의 새로고침 시 갱신하며, 앱을 닫아도 Android가 약 30분 간격으로 갱신합니다. 절전 상태에서 지연될 수 있으므로 마지막 갱신 시각을 표시합니다. 로그아웃하거나 기관 접근 권한이 없으면 일정을 지웁니다.
- 녹음 화면의 기본 동작은 **앱에서 녹음**입니다. 별도 **녹음 파일 수동 업로드** 버튼으로 기존 오디오 파일도 올릴 수 있습니다.

검증 명령은 `npm run typecheck`, `npm run test:widgets`, `node --test plugins/with-system-bars.test.js`입니다. 타입 검사, 위젯 테스트 6개, system-bar 회귀 검사, Android release build와 서명·16KB ZIP 정렬 검사를 통과했습니다. Android 14 에뮬레이터에서 두 크기 추가, 날짜별 일정 이동·재진입, 앱 종료 후 갱신, 로그아웃 시 숨김, 빈 일정과 파일 선택창을 확인했습니다. 네이티브 모듈이 추가되어 새 APK 설치가 필요합니다. 실기기·Android 16과 실제 30분 타이머 대기는 검증하지 않았습니다.

이름 전체 표시용 최신 APK는 `releases/slp-ai-1.0.3-11.apk`이며 기존 업로드 키로 서명했습니다. 코드 10에서 타입 검사·테스트 6개와 Android 14 두 위젯의 긴 가상 이름 전체 표시를 확인했고, 같은 기능을 표시 버전 1.0.3·코드 11로 다시 빌드·서명·설치했습니다. 코드 10 심사 요청은 회수했고 1.0.3(11)로 교체 제출했습니다. 이전 APK·AAB와 스토어 에셋 제출 기록은 보존합니다.

```sh
cd mobile
npm install
cp .env.production .env.local   # 개발 모드에서도 같은 설정을 쓰려면 (gitignore됨)
npx expo run:android            # USB로 연결한 폰이나 에뮬레이터에 개발 빌드 설치
```

녹음·파일 시스템 등 네이티브 모듈을 쓰므로 Expo Go가 아니라 개발 빌드로 실행합니다. 설정값은 `.env.production`(공개 클라이언트 설정만, `frontend/.env.production`과 같은 값)에 있고 릴리스·EAS 빌드에 자동으로 들어갑니다.

## 구글 플레이 배포

새 Android 출시마다 표시 버전의 patch와 빌드 번호를 함께 올립니다. 표시 버전은 `app.json`, `package.json`, `package-lock.json`에 일치시킵니다. 다음 표시는 1.0.5입니다.

### 아이 코드·일정 관리 개선 (1.0.4, 코드 12, 2026-11-11)

- `releases/slp-ai-1.0.4-12.aab`을 Alpha 비공개 테스트에 올리고 2026-11-11 19:16 KST 제출 ID `11`로 검토 요청했습니다. 출시명은 `1.0.4 (12) 아이 코드와 일정 관리 개선`, 기존 테스터 대상 100%입니다. Play Console 제출 활동은 `검토 중`입니다. 승인·실제 게시는 아직 확인하지 않았습니다.
- `npm run typecheck`, `npm run test:widgets`(6개), `node --test plugins/with-system-bars.test.js`(1개), Gradle `:app:checkSystemBarMigration :app:bundleRelease`가 통과했습니다. `bundletool validate`, AAB 서명·기존 업로드 인증서, `PAGE_ALIGNMENT_16K` 및 64비트 네이티브 라이브러리 48개 정렬을 확인했습니다. AAB SHA-256: `8f25db2c6fc79f2eb92c634d3ef5c39e8f2f3b6a55408b06ecfab70718709e6b`.
- 실기기·에뮬레이터 설치 실행은 이번 빌드에서 재검증하지 않았습니다. 기존 스토어 설정과 테스터는 변경하지 않았습니다.

### 위젯 아동 이름 전체 표시 (1.0.3, 코드 11, 2026-11-11)

- 사용자 요청에 따라 표시 버전도 1.0.2에서 1.0.3으로 올렸습니다. 잠시 제출한 코드 10은 회수하고, Alpha의 새 출시(ID 9)에 `releases/slp-ai-1.0.3-11.aab`을 올려 기존 테스터 대상 100%로 심사 요청했습니다. 이전 코드 10은 최종 출시에서 제외됩니다.
- Play의 번들 행에 `11 (1.0.3)`을 확인했고, 게시 개요의 `검토 중인 변경사항`에는 `1.0.3 (11) 위젯 아동 이름 전체 표시` 한 건만 남았습니다. `검토를 위해 변경사항 1개를 전송했습니다` 접수를 확인했습니다. 승인·실제 게시는 아직 확인하지 않았습니다. 화면은 `releases/slp-ai-1.0.3-11-review.png`입니다.
- `bundletool validate`, APK/AAB 서명·기존 인증서, 16KB 정렬, APK/AAB DEX·Hermes·네이티브 라이브러리 일치, Gradle system-bar 검사와 Python 3.12 pytest 274개를 통과했습니다. APK 설치·실행 및 설치 메타데이터의 `versionName=1.0.3`, `versionCode=11`도 확인했습니다. AAB SHA-256: `2fd0de7261addef66263be7f4958fad37ee69af7559abd8700979e1c3e6a2590`. 증거는 `.omo/evidence/play-1.0.3-2026-11-11/`입니다.
- 기존 스토어 에셋·설명·테스터·국가·건강 기능 신고는 유지했습니다. 앞으로 표시 버전의 patch도 한 단계씩 올리는 규칙은 `mobile/AGENTS.md`에 저장했습니다.

### 홈 화면 위젯 및 스토어 에셋 (1.0.2, 코드 9, 2026-11-10)

- 기존 업로드 키로 서명한 `releases/slp-ai-1.0.2-9.aab`을 Alpha 비공개 테스트의 새 출시(ID 7)에 업로드했습니다. 출시명은 `1.0.2 (9) 홈 화면 위젯 및 녹음 개선`, 출시율은 기존 테스터 대상 100%입니다. 프로덕션 출시는 아닙니다.
- 한국어 스토어에 `store-assets/play-guide-4screens-v2/`의 설명 이미지 4장을 녹음·일정·출결·기록 순서로 배치하고, 기존 실제 화면 2장을 뒤에 유지했습니다. 새 4장에는 AI 생성 표시를 저장했고, 전체 설명에 4×2·4×4 위젯 기능을 추가했습니다. 아이콘·그래픽 이미지·테스터·국가·건강 기능 신고는 변경하지 않았습니다.
- 앱·전체 설명·휴대전화 스크린샷 변경 3건을 함께 검토 전송 요청했습니다. 2026-11-11 Alpha 화면에서 코드 9가 11월 10일 오후 6:22에 게시되어 선택한 테스터에게 제공되는 상태를 확인했습니다. 당시 접수 화면은 `releases/slp-ai-1.0.2-9-review.png`입니다.
- `bundletool validate`, `jarsigner -verify`, 기존 업로드 인증서 일치, 64비트 ELF 48개 16KB 정렬과 `PAGE_ALIGNMENT_16K`, Gradle system-bar 검사, Python 3.12 pytest 272개를 통과했습니다. AAB의 DEX·Hermes 번들·네이티브 라이브러리 96개가 검증한 코드 9 APK와 동일합니다. AAB SHA-256: `16d3b2ca14c82ce742fd1dc8f68150a4ae6a4fbf103383ac5328e6a7bc16f6d7`. 증거는 `.omo/evidence/play-widget-release-2026-11-10/`입니다.

### 월간 일정표 및 결제 설정 (1.0.2, 코드 8)

- 월간 일정표에서 본인 수업의 날짜·시간·메모를 수정할 수 있습니다. 치료사가 ‘실제 일정과 동일’을 저장하면 별도 결제 일정이 없는 담당 아동의 매달 첫 5회를 바우처로 계산합니다.
- 기존 업로드 키로 서명한 `releases/slp-ai-1.0.2-8.aab`을 Alpha 비공개 테스트에 제출했습니다. 2026-11-09 Play Console의 ‘검토 중인 변경사항’에서 코드 8을 확인했습니다. 직접 설치 파일은 `releases/slp-ai-1.0.2-8.apk`, 제출 화면은 `releases/slp-ai-1.0.2-8-review.jpg`입니다.

### 키보드가 열린 상태에서 아동 선택 (1.0.1, 코드 7)

- 비공개 테스트용 파일은 `releases/slp-ai-1.0.1-7.aab`, 직접 설치용은 `releases/slp-ai-1.0.1-7.apk`입니다. 두 파일의 업로드 키 서명을 확인했습니다.
- Android 16 에뮬레이터에서 가상 아동 35명과 Gboard로 검증했습니다. 아동 선택 창에서 마지막 아동을 검색하거나 스크롤해 선택했고, 녹음 화면에서도 키보드를 연 채 검색 결과를 선택했습니다.
- Alpha 비공개 테스트에 코드 7을 제출했고 Play Console에서 `1.0.1 (7) 상담 녹음 및 아동 검색 개선 검토 중`을 확인했습니다.

### 보호자 상담 녹음 기본값과 시간 자동 입력 (1.0.1, 2026-11-09)

- Android 버전은 `1.0.1`(코드 `6`)이며 패키지는 `dev.heonhwi.slpai`입니다. Play 업로드용 파일은 `releases/slp-ai-1.0.1-6.aab`, 직접 설치용은 `releases/slp-ai-1.0.1-6.apk`입니다. 두 파일 모두 기존 업로드 키로 서명했습니다.
- 기존 Alpha 비공개 테스트에 100% 출시로 전송했으며 Play Console에서 `1.0.1 (6) 상담 녹음 및 수업 시간 자동 입력 검토 중`을 확인했습니다.

### Android 화면 호환성 (2026-11-09)

- `app.json`의 `orientation`은 `default`, 새 빌드는 `versionCode=4`입니다. 최종 AAB의 `screenOrientation=-1`(`unspecified`), min API 24, target API 36을 확인했습니다. 화면 크기 조절·종횡비 제한이나 대형 화면 예외 설정은 추가하지 않습니다.
- Play의 코드 2 화면 API 경고를 펼쳐 `setStatusBarColor`, `setNavigationBarColor`, `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`, `LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT`를 확인했습니다. 호출 위치는 React Native `WindowUtilKt.enableEdgeToEdge`, R8 매핑의 `f61`(React Native Screens `FormSheetDialog` / Material `BottomSheetDialog`), `n92`(Material `MaterialDatePicker`), `dd2`(R8 API outline)입니다.
- 현재 Expo 58 권장 React Native `0.88.1`과 Material의 해당 호출은 `plugins/with-system-bars.js`가 설치하는 AGP instrumentation으로 대체합니다. precompiled AAR에도 적용하며, `SystemBarProtection.kt`가 `WindowInsetsCompat`와 decor overlay를 사용해 요청한 배경색을 실제로 그립니다. 색상 getter도 같은 값을 반환하고 기존 아이콘 스타일·대비 처리는 유지합니다. Android 9/10은 안전한 기본 cutout 배치를 유지하고 API 30+는 `ALWAYS`를 사용합니다. [React Native 원본](https://github.com/facebook/react-native/blob/v0.88.1/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/views/view/WindowUtil.kt), [Android 15 변경사항](https://developer.android.com/about/versions/15/behavior-changes-15#edge-to-edge).
- 코드 4의 최종 DEX에서 `Window.setStatusBarColor`, `setNavigationBarColor` 및 대응 getter 호출은 0개이며, cutout 필드 쓰기는 `ALWAYS=3`인 1개만 남았습니다. 검사한 DEX가 최종 서명 AAB·설치용 APK와 동일함을 확인했습니다. 최소 지원 버전을 올리거나 reflection·호출 무효화로 경고를 숨기지 않습니다. Play의 최종 경고 상태는 새 업로드의 처리 결과로 별도 확인합니다.
- 기존 코드 2는 11월 3일 오전 11:40 Alpha 비공개 테스트에 게시됐고, [LuneTest 신청](https://lunetest.app/apps/582337ce-d7bc-442f-bcb2-1096285e9d3f)은 기본형 15대·15일 이용권 1장으로 접수·설치 및 시작 요청을 완료했습니다. 11월 9일 Play 대시보드에서 테스터 12명이 5일 동안 참여한 상태를 확인했습니다.

### 로컬 AAB (2026-11-09)

- 버전 코드 4 업로드 파일: `mobile/releases/slp-ai-1.0.0-4.aab` (저장소 루트 기준, gitignore). 이전 코드 1·2·3 AAB는 보존했습니다. 코드 4를 Alpha의 기존 출시 초안(ID 3)에 업로드하고 `출시 준비됨`을 확인해 저장했습니다. Play의 지원 제외 기기는 모든 폼 팩터에서 0대입니다. 11월 9일 오전 10:39 `1.0.0 (4) 화면 호환성 개선`을 Google 검토로 전송했고, 마지막 빠른 검사 완료 후 게시 개요의 `검토 중인 변경사항`에서 Alpha 코드 4와 `변경사항을 검토 중입니다`를 확인했습니다. **현재 검토 중이며 코드 4의 승인·게시는 아직 확인하지 않았습니다.** 기존 Alpha 게시 버전은 코드 2이고 관리형 게시는 꺼져 있습니다. 증거: `mobile/releases/slp-ai-1.0.0-4-review-confirmed.png`.
- `dev.heonhwi.slpai`, 버전 `1.0.0`, `versionCode=4`, min API 24, target API 36. `bundletool validate`, 16KB 페이지 정렬·64비트 라이브러리 48개 ELF 정렬, `jarsigner -verify` 통과. SHA-256: `3f372ccdfa40e648f90cc4d7bdb5f976b4174217c8b8c72381930dd97d85be2c`. 전용 업로드 인증서가 일치하며 서명 외 원본 엔트리 1,160개가 동일하고 동의 버전 `2026-11-03.1`이 번들에 포함됐습니다.
- `npm run typecheck`, config plugin 회귀 검사(`node --test plugins/with-system-bars.test.js`), Gradle `:app:checkSystemBarMigration`, 새 prebuild 이후 `bundleRelease assembleRelease`(7분 9초), Python 3.12 pytest 242개 통과. Android 14·16 에뮬레이터에서 코드 4 설치·실행 확인. Android 14는 같은 업로드 인증서로 APK를 다시 서명해 가상 계정·앱 데이터를 보존했고, 녹음 입력 화면·날짜창 표시/취소·키보드 열기/닫기·아동 선택 모달·가로/세로 전환·3버튼/제스처 내비게이션을 확인했습니다. 내비게이션은 원래의 제스처로 복원했습니다. Android 16 태블릿에서는 로그인 화면의 가로/세로 재배치와 시스템 바 여백을 확인했습니다. 두 기기의 `AndroidRuntime`·`ReactNativeJS` 오류 로그는 없었습니다. 증거: `mobile/releases/slp-ai-1.0.0-4-api34-*.png`, `slp-ai-1.0.0-4-api36-*.png`. 실기기·Android 9/10 및 녹음·업로드 전체 흐름은 이번 수정에서 재검증하지 않았습니다.
- 전용 업로드 키는 `~/.android/slpai-upload/upload.p12`, 비밀번호 파일은 같은 폴더의 `password`에 보관(권한 0600). 키와 비밀번호를 안전하게 백업하고 저장소나 채팅에 올리지 않습니다. 공개 인증서는 `upload-certificate.pem`입니다.
- 로컬 Gradle 기본 AAB는 **debug 서명**입니다. 위 파일은 기본 서명을 제거하고 전용 키로 다시 서명했습니다. 다음 EAS 빌드에도 같은 업로드 키를 등록해야 합니다. EAS 프로젝트 연결은 아직 하지 않았습니다.
- 비공개 테스트는 아래의 **내부 테스트**와 다른 트랙입니다. 비공개 테스트 심사에는 스토어 등록정보·앱 콘텐츠 신고·심사용 승인 계정 등이 필요합니다.
- [공개 개인정보처리방침](https://slpai.heonhwi.dev/privacy) `2026-11-03.1`을 Firebase Hosting에 반영했습니다. 사용자가 확인한 운영자·보호책임자 하헌휘, 로그인 없는 삭제 요청, 탈퇴 후 잔여 자료, 녹음 임시 보관, 저장소 복구 사본 7일, Firebase 인증의 미국 처리·삭제 사본 최대 180일, 외부 AI의 보유·안전상 예외를 명시했습니다. 기관 기록·서비스 내부 감사기록에 공통 자동 삭제 기한이 없다는 현재 설정도 공개했습니다. 보유기간·법정 의무는 기관과 개인정보·법률 전문가가 확정해야 하며 이 수정은 법률 자문이나 적법성 인증이 아닙니다. 근거·설정은 `docs/retention.md`를 참고합니다.

### Play Console·LuneTest 진행 상태 (2026-11-03)

- [SLP AI 앱](https://play.google.com/console/u/0/developers/4731826002426519319/app/4976324402888345056/app-dashboard)의 [Alpha 비공개 트랙](https://play.google.com/console/u/0/developers/4731826002426519319/app/4976324402888345056/tracks/4700461971448782386)에 코드 2 AAB를 업로드했습니다. `1.0.0 (2) 개인정보 안내 갱신`과 수정된 스토어 설명을 전송하고 **검토 다시 시작**을 확정했습니다. [게시 개요](https://play.google.com/console/u/0/developers/4731826002426519319/app/4976324402888345056/publishing)에 코드 2를 포함한 **검토 중인 변경사항**을 확인했으며 자동 검사 진행 중입니다. 승인·실제 트랙 게시는 아직 완료되지 않았습니다. 관리형 게시는 꺼져 있어 승인 후 자동 게시됩니다.
- 대한민국 1개 국가와 기존 `lunetests` 이메일 목록 15명을 연결·저장했습니다. 목록은 사용자가 제공한 `lunetest-tester-accounts.csv`의 15개 주소와 정확히 일치합니다. 개인정보처리방침 URL, 광고·광고 ID 미사용, 정부·금융 기능 없음을 저장했습니다. 건강 기능 신고는 사용자가 확인한 제품 용도에 따라 **앱에 건강 기능이 없음**만 선택된 저장 상태를 다시 확인했습니다. 의료 3항목과 기타는 선택되어 있지 않습니다. 데이터 보안에는 실제 사용자 입력 자료에 포함될 수 있는 건강정보 수집 고지를 유지했습니다.
- 공개 문의 주소 `3h@heonhwi.dev`, 공식 사이트, 한국어 설명, 아이콘·그래픽 이미지·실제 Android 스크린샷 2개를 저장했습니다. AI 생성 표시는 그래픽 이미지에만 적용했습니다. 전체 설명에 수업 운영·기록 정리를 돕는 생산성 앱이라는 점과 의료 진단·처방·의료기기 연동·인간 대상 연구 기능을 제공하지 않는다는 제품 범위를 명시하고 재심사에 포함했습니다. 기존 기능 목록은 유지했습니다.
- 데이터 보안, 18세 이상 타겟층, IARC 콘텐츠 등급(대한민국 12세 이상), 심사 로그인 정보를 저장했습니다. 심사 계정은 별도 가상 기관과 가상 아동 `PLAY-DEMO-01`만 접근하며 실제 기관 자료와 분리되어 있습니다. 로그인 비밀번호는 저장소 밖 `~/.android/slpai-upload/play-review.json`(0600)에 보관합니다. Google Play 검토팀에만 제공했고 파트너 기기 공유는 끈 상태입니다.
- `FOREGROUND_SERVICE_MICROPHONE`은 백그라운드 오디오 입력으로 신고했고, [실제 Android 14 시연 영상](https://drive.google.com/file/d/1KcIh9_sKg3sdCyW-v347_d53GKEMCQA6/view)을 저장했습니다. 녹음 시작·홈 화면 이동·지속 알림·앱 복귀·정지를 보여주는 160초 영상이며 가상 자료만 포함합니다. 링크 소지자에게 읽기만 허용하고 검색 공개는 하지 않았습니다. 로컬 사본은 `mobile/releases/slp-ai-foreground-demo.mp4`(gitignore)입니다. 출시 검토의 오류가 모두 해소된 **출시 준비됨** 상태에서 저장·전송했습니다.
- 현재 `3hDev`는 **개인 계정**, 주분류는 **생산성**입니다. 첫 제출에서 의료 기능 3개를 선택한 상태가 남아 있었고, 11월 3일 Google의 `Play Console Requirements` 조직 계정 요구 거절을 확인했습니다. 사용자는 의료·건강 기능 없는 업무 지원 앱이라고 재확인했습니다. 현재 건강 기능 없음으로 수정된 신고를 확인하고 새 AAB로 검토를 다시 시작했으며, Google의 재심사 판단을 기다립니다. 계정 이전·조직 계정 생성은 수행하지 않았습니다.
- [LuneTest 신청 화면](https://lunetest.app/apps/new)의 신청 조건은 `dev.heonhwi.slpai`·`SLP AI`·`Alpha`·대한민국·생산성·일반 무료 Android 앱·기본형(15대, 15일, 표시가 2,900원)입니다. 사용자가 기존 이용권 1장 사용을 승인했으며 추가 옵션은 없습니다. **신청 제출·이용권 차감·추가 결제는 하지 않았습니다.** 비공개 트랙의 실제 게시 확인이 필수이므로 Google 승인 후 신청해야 합니다. 이전 입력 폼은 서버에 저장된 신청이 아니며 브라우저 종료 시 유실될 수 있습니다.
- `npm run typecheck`, `npx expo-doctor` 20개 검사, Python 3.12 pytest 242개, frontend build·검증 14개 통과. 동의 버전의 웹·Android·방침 일치와 운영 공개 화면도 확인했습니다. 코드 1 APK의 Android 14 설치·로그인·가상 아동 선택·녹음·백그라운드 지속 알림·앱 복귀는 무음으로 검증했습니다. 코드 2는 동의 버전·버전 코드 변경 후 빌드·서명·번들 검증을 완료했으며 Android 런타임 재검증은 하지 않았습니다. 화면 꺼짐 녹음과 실제 음성 받아쓰기 품질은 미검증입니다. 처음 자동 GPU 에뮬레이터가 QEMU 오류로 멈춰 SwiftShader·Vulkan 비활성화로 재실행했습니다.

처음 한 번:

1. [Expo 계정](https://expo.dev/signup)을 만들고 `npx eas-cli@latest login`
2. `npx eas-cli@latest init` — 프로젝트 ID가 `app.json`에 추가됩니다(커밋).
3. [Play Console](https://play.google.com/console)에서 앱 만들기 — 패키지 이름 **`dev.heonhwi.slpai`** (한 번 올리면 바꿀 수 없으니 필요하면 지금 `app.json`에서 바꾸세요).

빌드·업로드:

```sh
npm run build:android    # EAS 클라우드에서 서명된 .aab 생성 (업로드 키는 EAS가 만들어 보관)
```

- 첫 버전은 Play Console › 테스트 › 내부 테스트에 `.aab`를 직접 올립니다(구글 정책상 첫 업로드는 수동).
- 그다음부터는 Play Console › 설정 › API 액세스에서 서비스 계정 JSON 키를 받아 `mobile/google-service-account.json`(gitignore됨)에 두고 `npm run submit:android` — 내부 테스트 트랙에 초안으로 올라갑니다.
- `versionCode`는 EAS가 빌드마다 자동으로 올립니다(`appVersionSource: remote`). 사용자에게 보이는 버전은 `app.json`의 `version`.

### Play Console에서 채울 것

- **개인정보처리방침 URL**: `https://slpai.heonhwi.dev/privacy`
- **계정 삭제**: 앱 안 메뉴 › 내 계정 › 회원 탈퇴. 웹 URL이 필요하면 같은 기능이 있는 웹 ‘내 계정’ 주소를 적습니다.
- **데이터 보안**: 수집 — 이메일(계정), 아동 이름·생년월일·임상 기록(앱 기능), 오디오 녹음(앱 기능, 받아쓰기 외부 전송: Groq/OpenRouter/OpenAI, 미국). 전송 중 암호화 예. 판매 안 함.
- **포그라운드 서비스 신고**: `FOREGROUND_SERVICE_MICROPHONE` — “치료 수업을 녹음하는 동안 화면이 꺼져도 녹음을 계속하기 위해 사용(사용자가 시작·정지).” 녹음 시작→화면 끄기→정지 영상을 함께 제출합니다.
- **권한**: 마이크(수업 녹음), 알림(녹음 중 표시). 저장소 권한은 쓰지 않습니다.
- **대상 연령**: 18세 이상(치료사용 업무 앱). 아동 대상 앱이 아닙니다.
- 앱 접근 권한(심사용 로그인): 승인된 테스트 기관 계정을 만들어 아이디·비밀번호를 Play Console에 적습니다.

### 버전 올리기

`app.json`의 `version`을 올리고 `npm run build:android` → 업로드. JS만 바뀐 경우에도 스토어 빌드로 배포합니다.
