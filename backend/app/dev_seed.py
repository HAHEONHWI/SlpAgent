"""Dummy data for local UI checks. Runs only when ENV=development and STORAGE_BACKEND=memory and DEV_SEED=1."""
def seed(repo, org="demo"):
    repo.create("organizations", org, {"name": "데모기관", "behavior_scale": {"min": 1, "max": 3}}, doc_id=org)
    c = repo.create("children", org, {"alias": "A-01", "display_name": "테스트아동", "birth_date": "2022-03-15", "archived": False})
    for i, (d, ok) in enumerate([("2026-09-04", 2), ("2026-09-11", 3), ("2026-09-18", 4), ("2026-09-25", 4)]):
        repo.create("therapy_sessions", org, {"child_id": c["id"], "date": d, "start": "10:00", "end": "10:40", "status": "completed", "therapist": "김재활",
                    "activities": [{"name": "2음절 모방", "correct": ok, "trials": 5, "prompt_level": "모델"}], "utterances": ["공"], "observed_behaviors": [],
                    "minutes": 40, "activity_accuracy": [{"name": "2음절 모방", "accuracy_pct": ok / 5 * 100}]})
    for w, m, s in [("공", "expressive", "independent"), ("멍멍", "expressive", "emerging"), ("사과", "receptive", "with_prompt")]:
        repo.create("vocabulary_records", org, {"child_id": c["id"], "word": w, "modality": m, "status": s, "observed_on": "2026-09-25", "source": "session", "category": "사물", "difficulty": 1, "target": s != "independent"})
    # dummy knowledge pages (not real test material)
    repo.create("knowledge_documents", org, {"source": "샘플 매뉴얼.pdf", "page": 1, "test_code": "REVT", "text": "검사 시 유의사항: 대상자가 틀리게 반응했을 경우라도 계속 격려해준다.", "needs_ocr": False})
    repo.create("knowledge_documents", org, {"source": "샘플 스캔.pdf", "page": 1, "test_code": None, "text": "", "needs_ocr": True})
