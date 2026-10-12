# 기관 지식검색

`knowledge.search`는 `organization_id`로 조회하고 `needs_ocr`, `needs_review` 페이지를 건너뛴다. 응답에는 `document`, `page`, `text`가 포함된다. 검색 API의 자료 원문은 로그인한 기관 사용자에게만 반환한다.

AI 도구에는 원문 `text`를 넣지 않는다. 도구 호출에는 문서명·페이지·검사 코드·문항 ID만 전달하며, 자료의 지시문은 데이터로만 취급한다. 원문이 필요한 사용자는 기관 내부 `/knowledge/search` API를 이용한다.

임베딩 벡터는 문서에 저장하고 cosine 점수는 Repo 인터페이스 뒤에서 기관별 결과에 대해 계산한다. 현재 Repo에는 벡터 검색 메서드가 없고 Firestore의 대규모 nearest-neighbor 검색을 직접 쓰지 않아 메모리 저장소와 테스트에서 같은 동작을 재현할 수 있다. 이 방식은 기관 문서 전체를 읽으므로 규모가 커지면 org 필터를 유지하는 벡터 어댑터로 교체해야 한다.

저작권 자료의 파생 텍스트가 원격 Firestore로 가는 ingest는 `--allow-reference-text-upload` 없이는 중단된다. OpenAI 임베딩은 `OPENAI_EMBEDDING_MODEL`과 `OPENAI_ALLOW_REFERENCE_EMBEDDING_UPLOAD=true`를 모두 설정해야 활성화된다. 기본 설정에서는 한국어 bigram 검색으로 폴백하고 원문을 외부 임베딩 API로 보내지 않는다. 활성화 전 사용 권한과 기관 정책을 확인한다.

텍스트 PDF 추출 JSON과 문항 ID 메타데이터를 기관 저장소로 가져오는 스크립트는 `cd backend && .venv/bin/python -m scripts.ingest_knowledge ORG_ID ../extracted --allow-reference-text-upload`다. 권리 검토 전에는 실행하지 않는다.
