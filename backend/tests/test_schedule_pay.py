from tests.conftest import H


def test_new_schedule_defaults_to_voucher_without_a_grade(client, child):
    response = client.post("/schedules", headers=H(), json={
        "child_id": child["id"], "date": "2020-10-06", "start": "10:00"})
    assert response.status_code == 201
    assert response.json()["pay"] == "voucher"
    [row] = client.get("/attendance/day?on=2020-10-06", headers=H()).json()
    assert row["pay"] == "voucher"
    visits = client.get(f"/children/{child['id']}/voucher-visits?month=2020-10", headers=H()).json()["visits"]
    assert [v["date"] for v in visits] == ["2020-10-06"]


def test_private_schedule_stays_private_when_moved_and_can_be_edited(client, child):
    response = client.post("/schedules", headers=H(), json={
        "child_id": child["id"], "date": "2020-10-06", "start": "10:00", "pay": "private"})
    assert response.status_code == 201
    schedule = response.json()
    moved = client.post(f"/schedules/{schedule['id']}/move", headers=H(), json={
        "date": "2020-10-07", "start": "10:00"}).json()["makeup"]
    assert moved["pay"] == "private"
    assert client.get(f"/children/{child['id']}/voucher-visits?month=2020-10", headers=H()).json()["visits"] == []
    edited = client.put(f"/schedules/{moved['id']}", headers=H(), json={
        "date": "2020-10-07", "start": "10:00", "pay": "voucher"})
    assert edited.status_code == 200
    visits = client.get(f"/children/{child['id']}/voucher-visits?month=2020-10", headers=H()).json()["visits"]
    assert [v["date"] for v in visits] == ["2020-10-07"]


def test_weekly_payment_flows_into_schedules_and_edits(client, child):
    settings = client.get("/me/payment-settings", headers=H()).json()
    assert client.put("/me/payment-settings", headers=H(), json={
        "same_as_actual": True, "expected_revision": settings["revision"]}).status_code == 200
    config = {"teachers": [{"id": "t", "name": child["therapist"], "short": "김", "color": "#2563eb"}]}
    assert client.put("/timetable/config", headers=H(role="admin"), json=config).status_code == 200
    entry = {"day": 1, "slot": "09:00", "teacher_id": "t", "child_id": child["id"]}
    assert client.post("/timetable/entries", headers=H(), json=entry).json()["pay"] == "voucher"
    private_entry = {**entry, "day": 2, "pay": "private"}
    response = client.post("/timetable/entries", headers=H(), json=private_entry)
    assert response.status_code == 201
    rows = client.get("/schedules?month=2099-03", headers=H()).json()
    assert [(s["date"], s["pay"]) for s in rows[:2]] == [("2099-03-02", "voucher"), ("2099-03-03", "private")]
    assert sum(s["pay"] == "voucher" for s in rows) == 5
    assert sum(s["pay"] == "private" for s in rows) == 5
    updated = client.put(f"/timetable/entries/{response.json()['id']}", headers=H(), json={**private_entry, "pay": "voucher"})
    assert updated.status_code == 200
    rows = client.get("/schedules?month=2099-03", headers=H()).json()
    # 실제와 동일: only the month's first 5 classes are 바우처, the rest become 사비 automatically
    assert [s["date"] for s in rows if s["pay"] == "voucher"] == ["2099-03-02", "2099-03-03", "2099-03-09", "2099-03-10", "2099-03-16"]
    assert all(s["pay_auto"] for s in rows if s["pay"] == "private")


def test_cancelled_private_class_does_not_become_a_voucher_session(client, repo, child):
    schedule = client.post("/schedules", headers=H(), json={
        "child_id": child["id"], "date": "2020-10-06", "start": "10:00", "pay": "private"}).json()
    client.post(f"/schedules/{schedule['id']}/cancel", headers=H())
    repo.create("therapy_sessions", "orgA", {"child_id": child["id"], "date": "2020-10-06",
                "start": "10:00", "end": "10:40", "status": "completed"})
    assert client.get(f"/children/{child['id']}/voucher-visits?month=2020-10", headers=H()).json()["visits"] == []


def test_schedule_inputs_reject_unknown_payment_categories(client, child):
    response = client.post("/schedules", headers=H(), json={
        "child_id": child["id"], "date": "2020-10-06", "start": "10:00", "pay": "unknown"})
    assert response.status_code == 422
    response = client.post("/timetable/entries", headers=H(), json={
        "day": 1, "slot": "09:00", "teacher_id": "t", "child_id": child["id"], "pay": "unknown"})
    assert response.status_code == 422


def _eight_classes(client, child):
    days = ("05", "06", "07", "08", "09", "12", "13", "14")
    return [client.post("/schedules", headers=H(), json={"child_id": child["id"], "date": f"2020-10-{d}", "start": "10:00"}).json()
            for d in days]


def test_same_as_actual_makes_only_the_first_five_held_classes_voucher(client, child):
    classes = _eight_classes(client, child)
    assert client.put(f"/schedules/{classes[1]['id']}/attendance", headers=H(), json={"status": "absent"}).status_code == 200
    visits = client.get(f"/children/{child['id']}/voucher-visits?month=2020-10", headers=H()).json()
    assert visits["same_as_actual"] is True
    # the absent class does not use a voucher session: the next held one does
    assert [v["date"] for v in visits["visits"]] == ["2020-10-05", "2020-10-07", "2020-10-08", "2020-10-09", "2020-10-12"]
    [row] = client.get("/attendance/day?on=2020-10-13", headers=H()).json()
    assert (row["pay"], row["pay_auto"]) == ("private", True)
    [plan] = client.get("/month-sheet?month=2020-10", headers=H()).json()["plans"]
    assert plan["same_as_actual"] is True and [s["date"] for s in plan["slots"]] == [v["date"] for v in visits["visits"]]


def test_pay_plan_dates_go_on_the_voucher_form_and_settlement(client, child):
    _eight_classes(client, child)
    client.put("/org", headers=H(role="admin"), json={"name": "센터", "paid_price": 50_000})
    client.put(f"/children/{child['id']}/voucher", headers=H(), json={"voucher_grade": "나"})
    slots = [{"date": f"2020-10-{d}", "start": "18:00"} for d in ("06", "08", "12", "14", "20")]
    saved = client.put(f"/children/{child['id']}/pay-plan?month=2020-10", headers=H(), json={"same_as_actual": False, "slots": slots})
    assert saved.status_code == 200
    visits = client.get(f"/children/{child['id']}/voucher-visits?month=2020-10", headers=H()).json()
    assert visits["same_as_actual"] is False
    assert [(v["date"], v["start"], v["therapist"]) for v in visits["visits"]] == [
        (s["date"], "18:00", child["therapist"]) for s in slots]
    # classes on a 결제 날짜 are 바우처, the other actual classes 사비
    pays = {s["date"]: s["pay"] for s in client.get("/schedules?month=2020-10", headers=H()).json()}
    assert [d for d, pay in sorted(pays.items()) if pay == "voucher"] == ["2020-10-06", "2020-10-08", "2020-10-12", "2020-10-14"]
    [row] = client.get("/settlement?month=2020-10", headers=H(role="admin")).json()["rows"]
    assert (row["day_sessions"], row["paid_sessions"]) == (5, 4)
    form = client.post(f"/children/{child['id']}/voucher-hwpx", headers=H(), json={"months": [{"month": "2020-10"}]})
    assert form.status_code == 200
    back = client.put(f"/children/{child['id']}/pay-plan?month=2020-10", headers=H(),
                      json={"same_as_actual": True, "slots": slots, "expected_revision": saved.json()["updated_at"]})
    assert back.json()["slots"] == []
    assert len(client.get(f"/children/{child['id']}/voucher-visits?month=2020-10", headers=H()).json()["visits"]) == 5


def test_pay_plan_rejects_other_months_and_other_therapists_children(client, child):
    other_month = {"same_as_actual": False, "slots": [{"date": "2020-11-02", "start": "10:00"}]}
    assert client.put(f"/children/{child['id']}/pay-plan?month=2020-10", headers=H(), json=other_month).status_code == 422
    ok = {"same_as_actual": False, "slots": [{"date": "2020-10-02", "start": "10:00"}]}
    assert client.put(f"/children/{child['id']}/pay-plan?month=2020-10", headers=H(uid="u2"), json=ok).status_code == 404
    assert client.get("/month-sheet?month=2020-10", headers=H(uid="u2")).json()["plans"] == []


def test_month_sheet_shows_a_therapist_only_their_own_classes_and_admins_pick_the_teacher(client, child):
    other = client.post("/children", headers=H(role="admin"), json={"alias": "B-01", "display_name": "다른아동",
                                                                      "birth_date": "2021-01-01", "therapist": "다른치료사"}).json()
    client.post("/schedules", headers=H(), json={"child_id": child["id"], "date": "2020-10-05", "start": "10:00"})
    client.post("/schedules", headers=H(role="admin"), json={"child_id": other["id"], "date": "2020-10-05", "start": "11:00"})
    linked = [{"name": child["therapist"], "uid": "u1"}, {"name": "다른치료사"}]
    client.put("/org", headers=H(role="admin"), json={"name": "센터", "therapists": linked})
    mine = client.get("/month-sheet?month=2020-10&therapist=다른치료사", headers=H()).json()
    assert mine["therapist"] == child["therapist"] and mine["therapists"] is None
    assert [c["child_id"] for c in mine["classes"]] == [child["id"]] and list(mine["names"]) == [child["id"]]
    admin = client.get("/month-sheet?month=2020-10&therapist=다른치료사", headers=H(role="admin", uid="a1")).json()
    assert admin["therapists"] == sorted([child["therapist"], "다른치료사"])
    assert [c["child_id"] for c in admin["classes"]] == [other["id"]]
    assert [p["child_id"] for p in admin["plans"]] == [other["id"]]
