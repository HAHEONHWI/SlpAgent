from app.services.billing import attendance_summary
from app.services.accounts import PLATFORM
from tests.conftest import H


def _schedule(client, child, d, start="10:00", end="10:40", therapist="김"):
    return client.post("/schedules", headers=H(), json={"child_id": child["id"], "date": d, "start": start, "end": end, "therapist": therapist}).json()


def test_summary_math_excludes_excused_and_counts_makeup():
    s = attendance_summary([{"status": "present"}, {"status": "late"}, {"status": "absent"}, {"status": "excused"}, {"status": "makeup"}])
    assert (s["attended"], s["marked"], s["rate_pct"]) == (3, 5, 75.0)  # 3 / (3 + 1 absent)
    assert attendance_summary([])["rate_pct"] is None
    assert attendance_summary([{"status": "excused"}])["rate_pct"] is None


def test_mark_roll_call_and_monthly_summary(client, child):
    a = _schedule(client, child, "2020-10-13")
    b = _schedule(client, child, "2020-10-20")
    c = _schedule(client, child, "2020-10-13", "11:00", "11:40", "이")
    f = _schedule(client, child, "2099-10-13")
    assert client.put(f"/schedules/{a['id']}/attendance", headers=H(), json={"status": "late", "minutes_late": 10}).status_code == 200
    # re-marking replaces the mark instead of adding another
    r = client.put(f"/schedules/{a['id']}/attendance", headers=H(), json={"status": "present", "minutes_late": 5})
    assert r.json()["status"] == "present" and r.json()["minutes_late"] is None
    client.put(f"/schedules/{b['id']}/attendance", headers=H(), json={"status": "absent", "note": "감기"})
    day = client.get("/attendance/day?on=2020-10-13", headers=H()).json()
    # nobody marked 11:00, and its day has passed: 출석 by default
    assert [(d["start"], d["state"]["status"], d["state"]["auto"]) for d in day] == [("10:00", "present", False), ("11:00", "present", True)]
    mine = client.get(f"/children/{child['id']}/attendance?month=2020-10", headers=H()).json()
    assert len(mine["records"]) == 3 and mine["summary"]["rate_pct"] == 66.7 and mine["summary"]["auto"] == 1
    org = client.get("/attendance/summary?month=2020-10", headers=H()).json()
    assert org == [{"child_id": child["id"], "scheduled": 3, **mine["summary"]}]
    assert client.get(f"/children/{child['id']}/attendance?month=2099-10", headers=H()).json()["summary"]["upcoming"] == 1
    assert client.delete(f"/schedules/{b['id']}/attendance", headers=H()).status_code == 204  # back to the default
    assert client.get(f"/children/{child['id']}/attendance?month=2020-10", headers=H()).json()["summary"]["rate_pct"] == 100.0
    assert client.get("/attendance/summary?month=bad", headers=H()).status_code == 422
    assert f


def test_attendance_permissions_and_isolation(client, child):
    a = _schedule(client, child, "2026-10-13")
    assert client.put(f"/schedules/{a['id']}/attendance", headers=H(role="assistant"), json={"status": "present"}).status_code == 403
    assert client.put(f"/schedules/{a['id']}/attendance", headers=H("orgB"), json={"status": "present"}).status_code == 404
    assert client.get(f"/children/{child['id']}/attendance", headers=H("orgB")).status_code == 404
    assert client.get("/attendance/day?on=2026-10-13", headers=H("orgB")).json() == []
    # 출결 관리: everyone but admins sees and touches only their own 담당 아동
    other, aide = H(uid="u2"), H(role="assistant", uid="u3")
    assert client.get("/attendance/day?on=2026-10-13", headers=other).json() == []
    assert client.get("/attendance/day?on=2026-10-13", headers=aide).json() == []
    assert client.get("/attendance/summary?month=2026-10", headers=aide).json() == []
    assert client.get(f"/children/{child['id']}/attendance", headers=aide).status_code == 404
    assert client.put(f"/schedules/{a['id']}/attendance", headers=other, json={"status": "absent"}).status_code == 404
    assert client.post(f"/schedules/{a['id']}/move", headers=other, json={"date": "2026-10-14", "start": "10:00"}).status_code == 404
    assert len(client.get("/attendance/day?on=2026-10-13", headers=H(role="admin", uid="u9")).json()) == 1
    client.post(f"/schedules/{a['id']}/cancel", headers=H())
    assert client.put(f"/schedules/{a['id']}/attendance", headers=H(), json={"status": "present"}).status_code == 409
    assert client.put(f"/schedules/{a['id']}/attendance", headers=H(), json={"status": "sick"}).status_code in (409, 422)


def test_makeup_move_long_absence_and_holidays_reach_the_voucher(client, repo, child):
    cid = child["id"]
    a = _schedule(client, child, "2020-10-06")
    b = _schedule(client, child, "2020-10-13")
    c = _schedule(client, child, "2020-10-20")
    d = _schedule(client, child, "2020-10-27")
    # 보강: 10/13 -> 10/15 11:00
    mv = client.post(f"/schedules/{b['id']}/move", headers=H(), json={"date": "2020-10-15", "start": "11:00", "reason": "보호자 요청"}).json()
    assert mv["moved"]["status"] == "moved" and mv["makeup"]["date"] == "2020-10-15" and mv["makeup"]["end"] == "11:40"
    assert client.post(f"/schedules/{b['id']}/move", headers=H(), json={"date": "2020-10-16", "start": "11:00"}).status_code == 409
    # 결강 with a reason, and a 장기결강 over 10/27
    client.put(f"/schedules/{c['id']}/attendance", headers=H(), json={"status": "excused", "note": "독감"})
    ab = client.post("/absences", headers=H(), json={"child_id": cid, "start": "2020-10-26", "end": "2020-11-08", "reason": "입원"}).json()
    assert client.post("/absences", headers=H(), json={"child_id": cid, "start": "2020-11-01", "end": "2020-11-02"}).status_code == 409
    v = client.get(f"/children/{cid}/voucher-visits?month=2020-10", headers=H()).json()
    assert [x["date"] for x in v["visits"]] == ["2020-10-06", "2020-10-15"]  # held classes only, 보강 included
    assert v["other"] == [{"date": "10/13", "text": "수업일 변경 → 10/15 11:00 보강 (보호자 요청)"},
                          {"date": "10/20", "text": "결강 (독감)"},
                          {"date": "10/26~11/8", "text": "장기결강 (입원)"}]
    s = client.get(f"/children/{cid}/attendance?month=2020-10", headers=H()).json()["summary"]
    assert (s["present"], s["excused"], s["moved"]) == (2, 2, 1)
    # undo the move
    client.post(f"/schedules/{b['id']}/unmove", headers=H())
    assert [x["date"] for x in client.get(f"/children/{cid}/voucher-visits?month=2020-10", headers=H()).json()["visits"]] == ["2020-10-06", "2020-10-13"]
    assert client.delete(f"/absences/{ab['id']}", headers=H()).status_code == 204
    assert client.post("/absences", headers=H("orgB"), json={"child_id": cid, "start": "2020-10-01", "end": "2020-10-02"}).status_code == 404
    # 휴무일: admin only; the timetable makes no class that day
    client.put("/timetable/config", headers=H(role="admin"), json={"teachers": [{"id": "t", "name": "김", "short": "김", "color": "#2563eb"}]})
    client.post("/timetable/entries", headers=H(), json={"day": 1, "slot": "09:00", "teacher_id": "t", "child_id": cid})
    assert client.put("/org/holidays", headers=H(), json={"holidays": []}).status_code == 403
    client.get("/schedules?month=2099-03", headers=H())  # Mondays in March 2099 are made
    assert client.put("/org/holidays", headers=H(role="admin"), json={"holidays": [{"date": "2099-03-02", "name": "대체휴일"}]}).json() == [{"date": "2099-03-02", "name": "대체휴일", "scope": "org"}]
    days = [x["date"] for x in client.get("/schedules?month=2099-03", headers=H()).json()]
    assert "2099-03-02" not in days and "2099-03-09" in days
    # 전체 휴무일: the site admin closes a day in every organization; orgs see it but cannot change it
    repo.create("organization_registry", PLATFORM, {"org_id": "orgA", "name": "A"}, doc_id="orgA")
    site = H("-", "site_admin", "root")
    assert client.put("/platform/holidays", headers=H(role="admin"), json={"holidays": []}).status_code == 403
    assert client.put("/platform/holidays", headers=site, json={"holidays": [{"date": "2099-03-09", "name": "설날"}]}).status_code == 200
    assert client.get("/platform/holidays", headers=site).json() == [{"date": "2099-03-09", "name": "설날"}]
    assert client.get("/org/holidays", headers=H()).json() == [{"date": "2099-03-02", "name": "대체휴일", "scope": "org"},
                                                               {"date": "2099-03-09", "name": "설날", "scope": "site"}]
    days = [x["date"] for x in client.get("/schedules?month=2099-03", headers=H()).json()]
    assert "2099-03-09" not in days and "2099-03-16" in days
    client.put("/org/holidays", headers=H(role="admin"), json={"holidays": []})  # an org cannot drop it
    assert [h["date"] for h in client.get("/org/holidays", headers=H()).json()] == ["2099-03-09"]
    assert a and d


def test_extra_classes_voucher_and_paid(client, child):
    cid = child["id"]
    # therapist and end default to the child's 담당 and the timetable's class length
    v = client.post("/schedules", headers=H(), json={"child_id": cid, "date": "2020-10-29", "start": "15:00", "extra": "voucher"})
    assert v.status_code == 201
    v = v.json()
    assert (v["end"], v["therapist"], v["note"], v["source"], v["extra"]) == ("15:40", child["therapist"], "추가(바우처 5회)", "extra", "voucher")
    paid = client.post("/schedules", headers=H(), json={"child_id": cid, "date": "2020-10-30", "start": "15:00", "extra": "paid"}).json()
    assert paid["note"] == "추가(유료)"
    assert client.post("/schedules", headers=H(), json={"child_id": cid, "date": "2020-10-30", "start": "15:00", "extra": "free"}).status_code == 422
    day = client.get("/attendance/day?on=2020-10-30", headers=H()).json()
    assert [d["extra"] for d in day] == ["paid"]
    # both are classes for 출결; only the 바우처 one goes into the voucher form, even with a 결강 or a moved 유료 class
    assert client.get("/attendance/summary?month=2020-10", headers=H()).json()[0]["scheduled"] == 2
    visits = client.get(f"/children/{cid}/voucher-visits?month=2020-10", headers=H()).json()
    assert [x["date"] for x in visits["visits"]] == ["2020-10-29"]
    mv = client.post(f"/schedules/{paid['id']}/move", headers=H(), json={"date": "2020-10-31", "start": "10:00"}).json()
    assert mv["makeup"]["extra"] == "paid"
    visits = client.get(f"/children/{cid}/voucher-visits?month=2020-10", headers=H()).json()
    assert [x["date"] for x in visits["visits"]] == ["2020-10-29"] and visits["other"] == []


def test_added_class_time_can_be_fixed(client, child):
    cid = child["id"]
    a = client.post("/schedules", headers=H(), json={"child_id": cid, "date": "2020-10-29", "start": "15:00", "extra": "voucher"}).json()
    other = client.post("/schedules", headers=H(), json={"child_id": cid, "date": "2020-10-29", "start": "17:00", "extra": "paid"}).json()
    client.put(f"/schedules/{a['id']}/attendance", headers=H(), json={"status": "late", "minutes_late": 5})
    # wrong time: keeps the 40-minute length and the attendance mark follows
    r = client.put(f"/schedules/{a['id']}", headers=H(), json={"date": "2020-10-30", "start": "16:10"})
    assert r.status_code == 200 and (r.json()["date"], r.json()["start"], r.json()["end"]) == ("2020-10-30", "16:10", "16:50")
    day = client.get("/attendance/day?on=2020-10-30", headers=H()).json()
    assert [(d["start"], d["state"]["status"]) for d in day] == [("16:10", "late")]
    # the kind can be switched, and the default note follows it
    r = client.put(f"/schedules/{a['id']}", headers=H(), json={"date": "2020-10-30", "start": "16:10", "extra": "paid"}).json()
    assert (r["extra"], r["note"]) == ("paid", "추가(유료)")
    assert client.put(f"/schedules/{a['id']}", headers=H(), json={"date": "2020-10-29", "start": "16:50"}).status_code == 409  # clashes with 17:00
    assert client.put(f"/schedules/{a['id']}", headers=H(), json={"date": "2020-10-30", "start": "16:10", "end": "16:00"}).status_code == 422
    assert client.put(f"/schedules/{a['id']}", headers=H(uid="u2"), json={"date": "2020-10-30", "start": "09:00"}).status_code == 404
    assert client.put(f"/schedules/{a['id']}", headers=H(role="assistant", uid="u3"), json={"date": "2020-10-30", "start": "09:00"}).status_code == 403
    assert other
