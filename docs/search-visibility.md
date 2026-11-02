# 공개 소개페이지와 검색 등록

## 구현

- 운영 canonical: `https://slpai.heonhwi.dev/`.
- 소개 원본: `frontend/public/home.html`, `home.css`. 정적 HTML이라 JavaScript 없이도 기능·FAQ·요금제 제안을 읽을 수 있다.
- `npm run build`는 Vite 빌드 후 SPA를 `dist/app.html`에 보존하고 소개페이지를 `dist/index.html`로 복사한다. Firebase는 정적 파일을 rewrite보다 먼저 처리하므로 이 순서를 유지한다.
- `/login`, `/dashboard`, 기존 업무 경로와 `/privacy`는 `/app.html`로 연결한다. SPA HTML은 `noindex, nofollow`; 홈페이지는 `index, follow`다. robots는 비공개 API·원문 경로를 제외하고 검색봇의 공개 페이지·CSS·로고 접근을 허용한다. robots는 인증 수단이 아니다.
- canonical, description, Open Graph, Twitter 카드, WebSite·Organization·WebApplication·FAQPage JSON-LD, sitemap을 제공한다. FAQ 구조화 데이터는 실제 표시되는 답변과 일치해야 한다.
- `llms.txt`는 공개 정보 요약이다. AI 검색 등록이나 노출을 보장하는 표준이 아니다. 검색엔진과 AI 서비스가 접근할 공개 정보에 임상 데이터나 허가된 검사 원문을 넣지 않는다.
- 요금은 스타터 0원·프로 월 29,000원·기관 월 99,000원의 출시 예정 제안가다. 실제 과금·플랜별 권한·사용량 제한은 구현하지 않았다. 확정·출시 전에는 구매 가능한 Offers 구조화 데이터를 추가하지 않는다.

## 검증

```sh
cd frontend && npm run build
```

저장소 루트에서:

```sh
backend/.venv312/bin/python -m pytest frontend/tests -q
firebase serve --only hosting --port 5174 --project slp-agent-2026
```

`http://localhost:5174/`는 소개, `/login`과 `/dashboard`는 noindex 업무 공간이어야 한다. `/home.html`과 `/index.html`은 `/`로 301 이동한다. Vite 개발 서버에서는 소개 원본을 `/home.html`에서 확인한다.

## 등록 상태

2026-10-26: 사용자 승인 후 현재 작업본을 `firebase deploy --only hosting --project slp-agent-2026`으로 운영 배포했다. 운영 주소는 https://slpai.heonhwi.dev/ 이며, Cloud Run·Firestore는 이 배포에서 변경하지 않았다. Google Search Console·네이버 서치어드바이저·Bing Webmaster Tools의 HTML 메타태그 소유확인을 모두 완료했다.

- Google: `/sitemap.xml` 제출 후 상태 `성공`, 발견된 페이지 1개를 확인했다. 실시간 URL 검사 결과는 `URL을 Google에 등록할 수 있음`·`페이지 색인을 생성할 수 있음`이다. 추가 요청은 처음 두 번 reCAPTCHA 연결 오류로 실패했으나, 같은 날 Search Console을 새로고침한 뒤 다시 요청해 `색인 생성 요청됨`과 우선순위 크롤링 대기열 등록을 확인했다. 이때 reCAPTCHA iframe도 정상 로드됐다. 사이트 코드는 변경하지 않았으며, 이전 연결 오류의 정확한 원인은 확정하지 않았다. 요청 접수는 실제 색인 완료를 의미하지 않는다.
- 네이버: 사이트맵과 홈페이지 수집 요청 접수를 확인했다. 등록일은 각각 `26.10.26 12:24:37`, `26.10.26 12:25:02`다. 소유확인 CAPTCHA는 사용자 허가 후 처리했다.
- Bing: 사이트맵 제출 상태 `Processing`, 오류·경고 0개를 확인했다. 홈페이지 URL 제출 내역 1건이 등록됐다. Live URL 검사 결과 `URL can be indexed by Bing`, `No SEO/GEO issues found`다. 기존 색인 상태는 `Discovered but not crawled`이므로 검색 노출은 아직 확인되지 않았다.
- 검토용 Hosting 채널: https://slp-agent-2026--introduction-c3u6ltsn.web.app, version `18ba8ec2ea94260a`, 2026-10-27 12:09 KST 만료 예정. Preview 채널에는 Firebase가 `X-Robots-Tag: noindex`를 붙이며 운영 홈페이지에는 이 헤더가 없다.
- 공개 문의: 하단 `문의하기`와 이메일은 `mailto:contact@heonhwi.dev`로 연결한다. Organization JSON-LD와 llms.txt에도 같은 공개 연락처를 제공한다. 방문자의 메일 앱에서 작성하며 서버가 자동 발송하지 않는다. 320·390·1440px에서 링크 목적지와 44px 터치 영역, 가로 overflow 없음 확인. 실제 메일 앱 실행·발송·수신은 시험하지 않았다.
- 검증: production build, frontend pytest 14개, Python 3.12 backend pytest 192개 통과. 운영 `/` 정적 소개·업무 경로 noindex·익명 `/api/children` 401·`/api/healthz` 200 확인. 공개 HTML·CSS의 배포본과 로컬 원본 일치 확인.
- 화면: 390·1440·1920px, 양쪽 OS 테마 환경에서 기존 light 디자인 유지, JavaScript 없는 소개, FAQ Enter 펼침·포커스, 로그인, 개발용 가상 데이터의 대시보드 이동·새로고침 확인. 모든 공개 링크·summary는 44px 이상. 200%는 720 CSS px와 device scale 2의 reflow emulation으로 확인했으며 실제 기기·native browser zoom·Lighthouse 점수는 검증하지 않았다.
- 독립 검토: 기능·보안 PASS, 시각 검토 round 2 PASS. Round 1의 하단 로그인 링크 폭과 캡처 시점 문제는 수정·재촬영했다. 기존 SPA의 큰 chunk 및 중복 import build 경고는 이 범위에서 변경하지 않았다.
- 대기: 검색엔진의 실제 수집·색인 처리, AI 검색 인용. Google의 추가 수동 색인 요청은 접수됐으므로 반복 제출할 필요가 없다.

## ChatGPT·Gemini 접근

- 운영 `robots.txt`의 `User-agent: *` 규칙은 공개 소개페이지·CSS·로고·사이트맵·`llms.txt`를 허용한다. `OAI-SearchBot`, `ChatGPT-User`, `Googlebot`, `Google-Extended`에도 적용된다. 별도 그룹을 추가해 API 제외 규칙을 누락시키지 않는다.
- OpenAI Docs에서 검색용 `OAI-SearchBot`과 사용자 요청용 `ChatGPT-User`를 확인했다. 운영 홈페이지는 두 User-Agent를 사용한 HTTP 요청에 정적 소개 HTML과 200을 반환했다. 이는 해당 헤더의 차단 여부를 확인한 것이며 실제 OpenAI IP의 방문 증명은 아니다.
- Google 공식 문서에서 `Google-Extended`는 Gemini의 grounding·모델 학습을 제어하는 robots 토큰이고 별도 HTTP User-Agent는 없음을 확인했다. 이 토큰과 Googlebot의 공개 페이지 허용·API 제외 규칙을 검사했다. Google Search Console의 실시간 검사도 색인 가능으로 통과했다.
- 초기 Codex 웹 도구는 운영 도메인과 기본 Hosting 도메인 모두 `Internal Error`로 읽지 못했다. 이 결과를 실제 ChatGPT·Gemini 앱의 접근 결과로 간주하지 않고 별도로 시험했다.
- ChatGPT 실제 읽기 성공: 로그인된 웹 앱의 일반 채팅에서 `웹 검색`을 선택해 운영 URL만 전달했다. [검증 대화](https://chatgpt.com/c/6adecda8-656c-83ee-b9f8-92c3e869f8d6)에서 운영 URL을 출처로 인용하고, 첫 제목·스타터/프로/기관 월 요금·문의 이메일·가격 유의 문구를 배포본과 일치하게 답했다. 출처 카드에도 `SLP AI`, `Total lines: 176`이 표시됐다. 정답이나 본문은 프롬프트에 제공하지 않았다. 임시 채팅에서는 웹 검색 없는 `2+2` 질문도 `이 응답을 불러오지 못했습니다`로 실패했으므로 이를 사이트 차단으로 판단하지 않는다.
- Gemini 실제 읽기 성공: 일반 채팅의 `3.5 Flash-Lite`에서 운영 도메인과 기본 Hosting URL을 각각 읽도록 요청했다. [검증 대화](https://gemini.google.com/app/180850a86aa7fd39)에서 두 주소 모두 `읽기 성공`으로 답했고, 첫 제목·스타터 0원/프로 29,000원/기관 99,000원·`contact@heonhwi.dev`와 각 플랜의 설명이 배포본과 일치했다. 정답이나 본문은 전달하지 않았다. 초기 임시 채팅은 접속 실패를 답했고 Pro·Flash 시도에는 응답 지연도 있어, 성공은 이 일반 Flash-Lite 채팅의 관찰 결과로 한정한다. DNS 장애나 봇 차단이 원인이었다고 확정하지 않는다.
- 두 웹 앱의 실제 응답과 배포 본문을 대조한 검증이다. Gemini 내부 HTTP 로그나 모든 모델·모든 세션의 읽기 성공은 검증하지 않았다. 사이트 코드는 이 재검증에서 변경하거나 재배포하지 않았다.
- 접근 허용·구조화 데이터·`llms.txt` 제공이나 한 번의 읽기 성공으로 검색 순위·모든 후속 요청의 성공·AI 인용을 보장하지 않는다.

## 일반 검색 확인·개선: 2026-10-26

- 로그인된 한국어 브라우저 세션에서 Google·네이버·Bing의 `SLP AI`, `언어치료 AI` 검색 결과 첫 페이지를 각각 확인했다. 6개 결과 화면 모두 운영 도메인 `slpai.heonhwi.dev`가 없었다. 다른 이름이 비슷한 서비스는 이 사이트의 노출로 집계하지 않았다. Google 브랜드 검색은 화면의 맞춤설정 중지 보기를 사용했으며, 일반 검색을 포함한 결과 전체를 비개인화 순위나 모든 결과 페이지의 판정으로 해석하지 않는다.
- Gemini의 새 임시 채팅 `3.5 Flash-Lite`에서 `언어치료 AI 서비스 검색해줘.`, 별도 새 임시 채팅에서 `언어재활사가 수업 기록, 치료계획, 바우처 업무에 쓸 수 있는 AI 서비스를 검색해줘.`를 요청했다. 브랜드·URL·정답을 프롬프트에 넣지 않았고 두 응답 모두 SLP AI를 언급하지 않았다. 이전의 URL 직접 읽기 성공과 일반 질의의 추천 여부는 별개다.
- Google의 저장된 색인 검사 결과는 여전히 `URL이 Google에 등록되어 있지 않음`, `Google에는 아직 알려지지 않은 URL입니다.`다. 앞서 접수된 색인 생성 요청은 크롤링 대기 상태이며 실시간 검사의 색인 가능 판정으로 실제 등록을 대신하지 않는다.
- 소개 제목·description·OG/Twitter·WebApplication 설명과 첫 소개 문단에 언어재활사·언어치료 기관 대상과 실제 업무를 명확히 적었다. `언어치료 AI`, `언어재활사 AI`, 언어치료 기록·치료계획, 발달재활 바우처 기록지·정산의 검색 의도에 맞춰 기존 본문과 FAQ를 보강했다. FAQPage와 표시 답변을 동기화했고 `llms.txt` 요약, 실제 변경일인 sitemap `lastmod` 2026-10-26을 갱신했다. 특정 순위를 약속하거나 유사 키워드 페이지를 대량 추가하지 않았다.
- 최종 production build·frontend pytest 14개·Python 3.12 backend pytest 192개·draft guard 통과. 변경 대상 4개 HTML/요약/사이트맵 파일을 제외한 배포 파일 45개의 SHA-256 manifest는 앞선 운영 배포본과 동일하다. 390·1440·1920px의 두 테마 환경에서 소개·FAQ·하단을 비교했다. 실제 기기·native zoom·Lighthouse는 이번 문구 변경에서 측정하지 않았다.
- 기능 검토 PASS, 시각 검토 round 2 PASS 후 13:40 KST에 Firebase Hosting 49개 파일을 운영 배포했다. 홈페이지 HTML·CSS·robots·sitemap·llms는 200과 원본 일치, 홈페이지 index/follow와 업무 경로 noindex, `/api/healthz` 200·익명 `/api/children` 401을 다시 확인했다. 네이버 수정 홈페이지 수집 요청은 `26.10.26 13:41:33`, Bing은 `Indexing requested.`로 접수됐다. Google의 기존 요청은 대기열에 있으므로 반복 제출하지 않았다.
- 배포 직후 새 임시 Gemini Flash-Lite 채팅의 같은 일반 질의에도 SLP AI는 없었다. Google·네이버·Bing의 `언어치료 AI` 첫 페이지를 다시 확인해 운영 도메인이 없음을 기록했다. 이번 배포로 실제 일반 검색 노출이나 상위노출을 달성했다고 주장하지 않는다. 수집·색인 및 추천 반영은 아직 대기 상태다.

검증 증거는 로컬 `.omo/evidence/search-discovery/qa-notes.md`와 `slp-public-qa/production/discovery/` 캡처에 보관한다. [Google AI 최적화 가이드](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)는 명확한 본문·일반 검색의 색인 가능성을 기본으로 설명하며 특별한 AI 전용 파일이나 마크업을 요구하지 않는다. `llms.txt`가 Google 순위를 올린다고 해석하지 않는다. [네이버 콘텐츠 가이드](https://searchadvisor.naver.com/guide/markup-content)에 맞춰 제목·설명은 실제 내용과 일치시키고 키워드 반복을 피한다.

## 운영 절차

1. 검증된 Hosting 작업본의 운영 배포를 승인받는다. 기존 미커밋 frontend 변경도 전체 빌드에 들어가므로 포함 범위를 확인한다.
2. `firebase deploy --only hosting --project slp-agent-2026` 실행 후 공개 URL·robots·sitemap·noindex 경로를 확인한다. Cloud Run이나 Firestore는 이 배포 대상이 아니다.
3. Google Search Console에서 HTML 태그로 소유확인 후 `https://slpai.heonhwi.dev/sitemap.xml`을 제출하고 홈페이지 색인 생성을 요청한다.
4. 네이버 서치어드바이저에서 HTML 태그 소유확인 후 같은 사이트맵을 제출하고 홈페이지 수집을 요청한다. CAPTCHA가 나오면 사용자 확인을 받는다.
5. Bing Webmaster Tools에서 HTML Meta Tag로 소유확인 후 같은 사이트맵과 홈페이지 URL을 제출한다.
6. 등록 성공과 실제 색인·검색 노출은 분리해서 기록한다. 노출 순위나 AI 인용은 보장하지 않는다.

공식 기준: [Google AI 기능](https://developers.google.com/search/docs/appearance/ai-features), [OpenAI 검색 크롤러](https://developers.openai.com/api/docs/bots), [네이버 콘텐츠 마크업](https://searchadvisor.naver.com/guide/markup-content), [Bing 사이트 추가·인증](https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b).
