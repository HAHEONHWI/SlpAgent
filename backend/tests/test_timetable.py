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
    _entry(client, label="미등록아동", day=2, valid_from="2026-10-01")
    r = client.post("/timetable/generate", headers=H(), json={"start": "2026-10-01", "end": "2026-10-31"}).json()
    assert r["created"] == 3 and r["unlinked"] == 4  # Oct 12, 19, 26; four Tuesdays with an unregistered name
    rows = client.get("/schedules?month=2026-10", headers=H()).json()
    assert [(s["date"], s["start"], s["end"], s["therapist"]) for s in rows][0] == ("2026-10-12", "09:00", "09:40", "어선생")
    assert client.post("/timetable/generate", headers=H(), json={"start": "2026-10-01", "end": "2026-10-31"}).json()["created"] == 0
    client.post(f"/schedules/{rows[0]['id']}/cancel", headers=H())
    assert client.post("/timetable/generate", headers=H(), json={"start": "2026-10-01", "end": "2026-10-31"}).json()["created"] == 0
    assert client.delete(f"/timetable/entries/{e['id']}", headers=H()).status_code == 204
    assert client.post("/timetable/generate", headers=H(), json={"start": "2026-10-01", "end": "2027-01-31"}).status_code == 422


def test_dated_classes_follow_the_timetable_automatically(client, child):
    client.put("/timetable/config", headers=ADMIN, json=CFG)
    e = _entry(client, child_id=child["id"]).json()  # Mondays 09:00 with 어선생
    rows = client.get("/schedules?month=2099-03", headers=H()).json()  # no "generate" needed
    assert [(s["date"], s["start"], s["therapist"]) for s in rows] == [(d, "09:00", "어선생") for d in ("2099-03-02", "2099-03-09", "2099-03-16", "2099-03-23", "2099-03-30")]
    assert len(client.get("/schedules?month=2099-03", headers=H()).json()) == 5  # idempotent
    day = client.get("/attendance/day?on=2099-03-09", headers=H()).json()
    assert len(day) == 1
    client.put(f"/schedules/{day[0]['schedule_id']}/attendance", headers=H(), json={"status": "present"})
    client.post(f"/schedules/{rows[1 + 1]['id']}/cancel", headers=H())  # 3/16 cancelled by hand
    # move the class to Tuesday 09:50: untouched upcoming Monday classes go, marked/cancelled ones stay
    client.put(f"/timetable/entries/{e['id']}", headers=H(), json={"day": 2, "slot": "09:50", "teacher_id": "sil", "child_id": child["id"]})
    after = client.get("/schedules?month=2099-03", headers=H()).json()
    kept = {(s["date"], s["status"]) for s in after if s["date"] in ("2099-03-09", "2099-03-16")}
    assert kept == {("2099-03-09", "scheduled"), ("2099-03-16", "cancelled")}
    assert {s["date"] for s in after if s["start"] == "09:50"} == {"2099-03-03", "2099-03-10", "2099-03-17", "2099-03-24", "2099-03-31"}
    assert client.get("/schedules?month=2026-01", headers=H()).json() == []  # before the entry was added


def test_a_synced_month_is_not_synced_again_until_something_changes(client, repo, child):
    from app.routers import timetable
    calls = []
    real = timetable.sync_schedules
    timetable.sync_schedules = lambda *a, **k: calls.append(a[2:]) or real(*a, **k)
    try:
        client.put("/timetable/config", headers=ADMIN, json=CFG)
        _entry(client, child_id=child["id"])
        client.get("/schedules?month=2099-03", headers=H())
        client.get("/attendance/day?on=2099-03-09", headers=H())
        client.get("/attendance/summary?month=2099-03", headers=H())
        assert len(calls) == 1  # every screen after the first reuses the synced month
        # each change that alters the classes makes the next view sync again
        second = _entry(client, child_id=child["id"], day=3).json()  # new cell
        assert len([s for s in client.get("/schedules?month=2099-03", headers=H()).json() if s["start"] == "09:00"]) == 9
        client.put("/org/holidays", headers=ADMIN, json={"holidays": [{"date": "2099-03-04"}]})
        assert "2099-03-04" not in {s["date"] for s in client.get("/schedules?month=2099-03", headers=H()).json()}
        client.put("/org/holidays", headers=ADMIN, json={"holidays": []})  # the day's class comes back
        assert "2099-03-04" in {s["date"] for s in client.get("/schedules?month=2099-03", headers=H()).json()}
        client.put("/platform/holidays", headers=H("-", "site_admin", "root"), json={"holidays": [{"date": "2099-03-11"}]})
        repo.create("organization_registry", "_platform", {"org_id": "orgA"}, doc_id="orgA")
        client.put("/platform/holidays", headers=H("-", "site_admin", "root"), json={"holidays": [{"date": "2099-03-11"}]})
        assert "2099-03-11" not in {s["date"] for s in client.get("/schedules?month=2099-03", headers=H()).json()}
        client.post(f"/children/{child['id']}/archive", headers=H())
        client.post(f"/children/{child['id']}/restore", headers=H())
        assert client.get("/schedules?month=2099-04", headers=H()).json()  # restored child's classes are made again
        client.get("/schedules?month=2099-03", headers=H())  # first view after the restore syncs March again
        n = len(calls)
        client.get("/schedules?month=2099-03", headers=H())
        client.get("/settlement?month=2099-03", headers=ADMIN)
        assert len(calls) == n and second  # …and then not again
    finally:
        timetable.sync_schedules = real


def test_every_range_and_ordered_query_has_a_firestore_index():
    """Range and ordered queries need composite indexes before backend deployment."""
    import json, pathlib, re
    idx = json.loads((pathlib.Path(__file__).parents[2] / "firestore.indexes.json").read_text())["indexes"]
    have = {(i["collectionGroup"], tuple(f["fieldPath"] for f in i["fields"])) for i in idx}
    have_desc = {(i["collectionGroup"], tuple(f["fieldPath"] for f in i["fields"])) for i in idx
                 if i["fields"][-1]["order"] == "DESCENDING"}
    have_asc = {(i["collectionGroup"], tuple(f["fieldPath"] for f in i["fields"])) for i in idx
                if i["fields"][-1]["order"] == "ASCENDING"}
    src = "\n".join(p.read_text() for p in (pathlib.Path(__file__).parents[1] / "app").rglob("*.py"))
    needed, needed_desc, needed_asc = set(), set(), set()
    by_kind = {"range": needed, "latest": needed_desc, "earliest": needed_asc}
    for m in re.finditer(r'(?:list|count)_(range|latest|earliest)\((\w+|"\w+"), [^,]+, "(\w+)"[^)]*?((?:,\s+\w+=[^,)]+|,\s+\*\*\w+)*)\)', src):
        kind, col, field, rest = m.groups()
        cols = [col.strip('"')] if col.startswith('"') else ["therapy_sessions", "parent_consultations", "recording_records"]  # latest(col)
        eqs = tuple(re.findall(r",\s+(\w+)=", rest))
        for c in cols:
            key = (c, ("organization_id", *eqs, field))
            by_kind[kind].add(key)
            if "**flt" in rest:
                needed.add((c, ("organization_id", "child_id", field)))
    assert needed and needed_desc, "pattern found no queries"
    assert needed - have == set()
    assert needed_desc - have_desc == set()  # newest-first reads need a DESCENDING index
    assert needed_asc and needed_asc - have_asc == set()
