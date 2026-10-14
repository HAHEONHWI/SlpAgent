"""수업 기록 조회: classes of a month with attendance state and the records written for them."""
from tests.conftest import H


def test_class_records_join_schedule_state_and_records(client, child):
    cid = child["id"]
    s1 = client.post("/schedules", headers=H(), json={"child_id": cid, "date": "2020-10-06", "start": "10:00", "end": "10:40", "therapist": "김치료"}).json()
    s2 = client.post("/schedules", headers=H(), json={"child_id": cid, "date": "2020-10-13", "start": "10:00", "end": "10:40", "therapist": "박선생"}).json()
    client.put(f"/schedules/{s2['id']}/attendance", headers=H(), json={"status": "absent", "note": "감기"})
    sess = client.post(f"/children/{cid}/sessions", headers=H(), json={"date": "2020-10-06", "start": "10:00", "end": "10:40", "therapist": "김치료",
                                                                      "activities": [{"name": "2음절 모방", "correct": 7, "trials": 10}]}).json()
    client.post(f"/sessions/{sess['id']}/note", headers=H(), json={"text": "FAKE 노트"})
    client.post(f"/children/{cid}/sessions", headers=H(), json={"date": "2020-10-08", "start": "15:00", "end": "15:40", "therapist": "김치료"})
    rows = client.get("/class-records?month=2020-10", headers=H()).json()
    assert [(r["date"], r["state"]["status"]) for r in rows] == [("2020-10-13", "absent"), ("2020-10-08", "present"), ("2020-10-06", "present")]
    first = next(r for r in rows if r["date"] == "2020-10-06")
    assert first["sessions"][0]["note"] == "FAKE 노트" and first["sessions"][0]["activities"][0]["accuracy_pct"] == 70.0
    assert [r["date"] for r in client.get("/class-records?month=2020-10&therapist=박선생", headers=H()).json()] == ["2020-10-13"]
    assert client.get("/class-records?month=2020-10", headers=H("orgB")).json() == []
    assert client.get("/class-records?month=bad", headers=H()).status_code == 422
    assert s1
