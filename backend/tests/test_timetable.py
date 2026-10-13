"""Weekly timetable grid: slot math, cell rules, permissions and turning it into dated schedules."""
from tests.conftest import H

ADMIN = H(role="admin")
CFG = {"teachers": [{"id": "eo", "name": "어선생", "short": "어", "color": "#2563eb"},
                    {"id": "sil", "name": "실선생", "short": "실", "color": "#9f1239"}],
       "closed": ["1|11:30|*", "5|14:00|sil"]}


def _entry(client, **kw):
    return client.post("/timetable/entries", headers=H(), json={"day": 1, "slot": "09:00", "teacher_id": "eo", **kw})


def test_default_rotation_is_40_plus_10(client):
    t = client.get("/timetable", headers=H()).json()
    assert t["morning"] == ["09:00", "09:50", "10:40", "11:30"]
    assert t["afternoon"] == ["14:00", "14:50", "15:40", "16:30", "17:20", "18:10", "19:00"]
    assert t["config"]["days"] == [1, 2, 3, 4, 5, 6]


def test_config_is_admin_only_and_rejects_overlap(client):
    assert client.put("/timetable/config", headers=H(), json=CFG).status_code == 403
    bad = client.put("/timetable/config", headers=ADMIN, json={**CFG, "morning_count": 8})  # runs into 14:00
    assert bad.status_code == 422
    assert client.put("/timetable/config", headers=ADMIN, json=CFG).json()["config"]["teachers"][1]["short"] == "실"


def test_cell_rules(client, child):
    client.put("/timetable/config", headers=ADMIN, json=CFG)
    assert _entry(client, label="이준우", note="-20일", valid_to="2026-10-20").status_code == 201
    assert _entry(client, label="다른아동").status_code == 409  # same cell, overlapping period
    assert _entry(client, label="다음아동", valid_from="2026-10-21").status_code == 201  # takes over after the 20th
    assert _entry(client, child_id=child["id"], teacher_id="sil").status_code == 201
    assert _entry(client, child_id=child["id"], teacher_id="sil", day=2).status_code == 201
    assert _entry(client, child_id=child["id"], day=2).status_code == 409  # same child, same time, other teacher
    assert _entry(client, label="x", slot="11:30").status_code == 409  # closed slot
    assert _entry(client, label="x", slot="09:10").status_code == 422
    assert _entry(client, label="x", teacher_id="nobody").status_code == 422
    assert _entry(client, label="x", day=7).status_code == 422
    assert _entry(client).status_code == 422  # neither child nor name
    assert client.post("/timetable/entries", headers=H(role="assistant"), json={"day": 3, "slot": "09:00", "teacher_id": "eo", "label": "x"}).status_code == 403
    assert client.get("/timetable", headers=H("orgB")).json()["entries"] == []


def test_generate_creates_dated_schedules_once(client, child):
    client.put("/timetable/config", headers=ADMIN, json=CFG)
    e = _entry(client, child_id=child["id"], note="(10월-)", valid_from="2026-10-12").json()  # Mondays 09:00
    _entry(client, label="미등록아동", day=2)
    r = client.post("/timetable/generate", headers=H(), json={"start": "2026-10-01", "end": "2026-10-31"}).json()
    assert r["created"] == 3 and r["unlinked"] == 4  # Oct 12, 19, 26; four Tuesdays with an unregistered name
    rows = client.get("/schedules?month=2026-10", headers=H()).json()
    assert [(s["date"], s["start"], s["end"], s["therapist"]) for s in rows][0] == ("2026-10-12", "09:00", "09:40", "어선생")
    assert client.post("/timetable/generate", headers=H(), json={"start": "2026-10-01", "end": "2026-10-31"}).json()["created"] == 0
    client.post(f"/schedules/{rows[0]['id']}/cancel", headers=H())
    assert client.post("/timetable/generate", headers=H(), json={"start": "2026-10-01", "end": "2026-10-31"}).json()["created"] == 0
    assert client.delete(f"/timetable/entries/{e['id']}", headers=H()).status_code == 204
    assert client.post("/timetable/generate", headers=H(), json={"start": "2026-10-01", "end": "2027-01-31"}).status_code == 422
