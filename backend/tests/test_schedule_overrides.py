"""One dated class may change without changing its fixed weekly timetable."""
import pytest

from app.routers.timetable import touch_timetable
from tests.conftest import H


@pytest.fixture
def weekly(client, repo, child):
    config = {"teachers": [{"id": "t", "name": child["therapist"], "short": "김", "color": "#2563eb"}]}
    assert client.put("/timetable/config", headers=H(role="admin"), json=config).status_code == 200
    entry = client.post("/timetable/entries", headers=H(), json={
        "day": 1, "slot": "09:00", "teacher_id": "t", "child_id": child["id"], "note": "고정 메모"}).json()
    rows = client.get("/schedules?month=2099-03", headers=H()).json()
    return entry, repo.get("schedules", "orgA", rows[0]["id"])


@pytest.mark.parametrize("day", ["2099-03-03", "2099-04-01"])
def test_edited_weekly_class_stays_changed_after_resync(client, repo, weekly, day):
    entry, schedule = weekly

    response = client.put(f"/schedules/{schedule['id']}", headers=H(), json={
        "date": day, "start": "09:50", "note": "이 날짜만 변경"})

    assert response.status_code == 200
    assert (response.json()["date"], response.json()["end"], response.json()["note"]) == (day, "10:30", "이 날짜만 변경")
    assert repo.get("timetable_entries", "orgA", entry["id"]) == entry
    touch_timetable(repo, "orgA")
    march = client.get("/schedules?month=2099-03", headers=H()).json()
    client.get("/schedules?month=2099-04", headers=H())
    assert "2099-03-02" not in {row["date"] for row in march}
    assert repo.get("schedules", "orgA", schedule["id"])["date"] == day
    assert repo.get("schedules", "orgA", schedule["id"])["note"] == "이 날짜만 변경"


def test_manual_class_survives_weekly_config_and_holiday_changes(client, repo, weekly):
    entry, schedule = weekly
    response = client.put(f"/schedules/{schedule['id']}", headers=H(), json={"date": "2099-03-03", "start": "09:50"})
    assert response.status_code == 200

    client.put("/timetable/entries/" + entry["id"], headers=H(), json={
        "day": 1, "slot": "10:40", "teacher_id": "t", "child_id": schedule["child_id"]})
    client.put("/org/holidays", headers=H(role="admin"), json={"holidays": [{"date": "2099-03-03"}]})
    client.put("/org/holidays", headers=H(role="admin"), json={"holidays": []})
    rows = client.get("/schedules?month=2099-03", headers=H()).json()

    assert [(row["date"], row["start"]) for row in rows if row["id"] == schedule["id"]] == [("2099-03-03", "09:50")]
    assert repo.get("schedules", "orgA", schedule["id"])["note"] == "고정 메모"


def test_dated_edit_preserves_attendance_and_unspecified_note(client, repo, weekly):
    _, schedule = weekly
    client.put(f"/schedules/{schedule['id']}/attendance", headers=H(), json={"status": "late", "minutes_late": 5})

    response = client.put(f"/schedules/{schedule['id']}", headers=H(), json={"date": "2099-03-03", "start": "09:50"})

    assert response.status_code == 200 and response.json()["note"] == "고정 메모"
    mark = repo.get("attendance", "orgA", schedule["id"])
    assert (mark["date"], mark["start"], mark["status"]) == ("2099-03-03", "09:50", "late")


@pytest.mark.parametrize("day", ["2099-03-09", "2099-04-06"])
def test_dated_edit_still_rejects_overlapping_classes(client, repo, weekly, day):
    _, schedule = weekly

    response = client.put(f"/schedules/{schedule['id']}", headers=H(), json={"date": day, "start": "09:00"})

    assert response.status_code == 409
    assert repo.get("schedules", "orgA", schedule["id"])["date"] == "2099-03-02"


def test_repeated_moves_keep_the_original_timetable_date_and_can_clear_note(client, repo, weekly):
    entry, schedule = weekly
    client.put(f"/schedules/{schedule['id']}", headers=H(), json={"date": "2099-03-03", "start": "09:50", "note": "변경 메모"})

    response = client.put(f"/schedules/{schedule['id']}", headers=H(), json={"date": "2099-04-01", "start": "10:40", "note": None})

    assert response.status_code == 200 and response.json()["note"] is None
    assert response.json()["timetable_date"] == "2099-03-02"
    touch_timetable(repo, "orgA")
    rows = client.get("/schedules?month=2099-03", headers=H()).json()
    assert "2099-03-02" not in {row["date"] for row in rows}
    assert repo.get("timetable_entries", "orgA", entry["id"]) == entry


@pytest.mark.parametrize("headers,status", [(H("orgB"), 404), (H(uid="u2"), 404), (H(role="assistant"), 403)])
def test_dated_edit_keeps_role_and_child_permissions(client, repo, weekly, headers, status):
    _, schedule = weekly

    response = client.put(f"/schedules/{schedule['id']}", headers=headers, json={"date": "2099-03-03", "start": "09:50"})

    assert response.status_code == status
    assert repo.get("schedules", "orgA", schedule["id"]) == schedule
