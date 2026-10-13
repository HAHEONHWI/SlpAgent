from app.services.billing import attendance_summary
from tests.conftest import H


def _schedule(client, child, d, start="10:00", end="10:40", therapist="김"):
    return client.post("/schedules", headers=H(), json={"child_id": child["id"], "date": d, "start": start, "end": end, "therapist": therapist}).json()


def test_summary_math_excludes_excused_and_counts_makeup():
    s = attendance_summary([{"status": "present"}, {"status": "late"}, {"status": "absent"}, {"status": "excused"}, {"status": "makeup"}])
    assert (s["attended"], s["marked"], s["rate_pct"]) == (3, 5, 75.0)  # 3 / (3 + 1 absent)
    assert attendance_summary([])["rate_pct"] is None
    assert attendance_summary([{"status": "excused"}])["rate_pct"] is None


def test_mark_roll_call_and_monthly_summary(client, child):
    a = _schedule(client, child, "2026-10-13")
    b = _schedule(client, child, "2026-10-20")
    c = _schedule(client, child, "2026-10-13", "11:00", "11:40", "이")
    assert client.put(f"/schedules/{a['id']}/attendance", headers=H(), json={"status": "late", "minutes_late": 10}).status_code == 200
    # re-marking replaces the mark instead of adding another
    r = client.put(f"/schedules/{a['id']}/attendance", headers=H(), json={"status": "present", "minutes_late": 5})
    assert r.json()["status"] == "present" and r.json()["minutes_late"] is None
    client.put(f"/schedules/{b['id']}/attendance", headers=H(), json={"status": "absent", "note": "감기"})
    day = client.get("/attendance/day?on=2026-10-13", headers=H()).json()
    assert [(d["start"], (d["attendance"] or {}).get("status")) for d in day] == [("10:00", "present"), ("11:00", None)]
    mine = client.get(f"/children/{child['id']}/attendance?month=2026-10", headers=H()).json()
    assert len(mine["records"]) == 2 and mine["summary"]["rate_pct"] == 50.0
    org = client.get("/attendance/summary?month=2026-10", headers=H()).json()
    assert org == [{"child_id": child["id"], "scheduled": 3, **mine["summary"]}]
    assert client.get("/attendance/summary?month=bad", headers=H()).status_code == 422


def test_attendance_permissions_and_isolation(client, child):
    a = _schedule(client, child, "2026-10-13")
    assert client.put(f"/schedules/{a['id']}/attendance", headers=H(role="assistant"), json={"status": "present"}).status_code == 403
    assert client.put(f"/schedules/{a['id']}/attendance", headers=H("orgB"), json={"status": "present"}).status_code == 404
    assert client.get(f"/children/{child['id']}/attendance", headers=H("orgB")).status_code == 404
    assert client.get("/attendance/day?on=2026-10-13", headers=H("orgB")).json() == []
    client.post(f"/schedules/{a['id']}/cancel", headers=H())
    assert client.put(f"/schedules/{a['id']}/attendance", headers=H(), json={"status": "present"}).status_code == 409
    assert client.put(f"/schedules/{a['id']}/attendance", headers=H(), json={"status": "sick"}).status_code in (409, 422)
