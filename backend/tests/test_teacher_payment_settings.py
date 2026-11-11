from app.routers import voucher_doc
from tests.conftest import H


def test_pending_voucher_choice_explains_required_setting(client, child):
    row = client.post('/schedules', headers=H(), json={'child_id': child['id'], 'date': '2026-11-04', 'start': '09:00'}).json()
    url = f"/schedules/{row['id']}/pay"
    response = client.put(url, headers=H(), json={'pay': 'voucher'})
    assert response.status_code == 409 and '내 결제 설정' in response.json()['detail']
    assert client.put(url, headers=H(), json={'pay': 'private'}).status_code == 200
    assert client.get('/attendance/day?on=2026-11-04', headers=H()).json()[0]['pay'] == 'private'
    assert client.put(f"/children/{child['id']}/pay-plan?month=2026-11", headers=H(), json={'same_as_actual': False, 'slots': [{'date': '2026-11-04', 'start': '09:00'}]}).status_code == 200
    assert client.put(url, headers=H(), json={'pay': 'voucher'}).status_code == 200
    assert client.get('/attendance/day?on=2026-11-04', headers=H()).json()[0]['pay'] == 'voucher'


def test_teacher_opt_in_manual_exception_and_history(client, child, repo, monkeypatch):
    clock = {"month": "2026-11"}
    monkeypatch.setattr(voucher_doc, "_current_month", lambda: clock["month"])
    cid = child["id"]
    for month in ["2026-10", "2026-11", "2026-12"]:
        for day in range(1, 8):
            response = client.post("/schedules", headers=H(), json={"child_id": cid, "date": f"{month}-{day:02d}",
                "start": "10:00", "pay": "private" if day == 2 else "voucher"})
            assert response.status_code == 201
    client.put(f"/children/{cid}/voucher", headers=H(), json={"voucher_grade": "나"})

    def visits(month):
        return client.get(f"/children/{cid}/voucher-visits?month={month}", headers=H()).json()

    def put_setting(on, revision):
        return client.put("/me/payment-settings", headers=H(), json={"same_as_actual": on, "expected_revision": revision})

    initial = client.get("/me/payment-settings", headers=H()).json()
    assert initial["same_as_actual"] is False
    assert visits("2026-11")["mode"] == "unset" and visits("2026-11")["visits"] == []
    assert len(visits("2026-10")["visits"]) == 5
    [pending] = client.get("/settlement?month=2026-11", headers=H(role="admin")).json()["rows"]
    assert (pending["pending_sessions"], pending["paid_sessions"], pending["day_sessions"]) == (6, 1, 0)
    assert pending["guardian_total"] is None and pending["copay_refund"] is None
    assert client.get("/attendance/day?on=2026-11-01", headers=H()).json()[0]["pay"] == "pending"
    assert client.put(f"/children/{cid}/pay-plan?month=2026-11", headers=H(),
                      json={"expected_revision": None, "same_as_actual": True}).status_code == 409

    saved = put_setting(True, initial["revision"])
    assert saved.status_code == 200 and saved.json()["same_as_actual"] is True
    assert put_setting(False, initial["revision"]).status_code == 409
    assert repo.get("users", "orgA", "u1")["role"] == "therapist"
    for month in ("2026-11", "2026-12"):
        assert [v["date"] for v in visits(month)["visits"]] == [f"{month}-{d:02d}" for d in (1, 3, 4, 5, 6)]

    sibling = client.post("/children", headers=H(), json={"alias": "A-02", "display_name": "가상 아동",
                          "birth_date": "2021-05-01", "therapist": child["therapist"]}).json()["id"]
    assert client.post("/schedules", headers=H(), json={"child_id": sibling, "date": "2026-11-21",
                       "start": "14:00"}).status_code == 201
    manual = client.put(f"/children/{cid}/pay-plan?month=2026-11", headers=H(),
                        json={"expected_revision": None, "same_as_actual": False,
                              "slots": [{"date": "2026-11-07", "start": "12:00"}]})
    assert manual.status_code == 200
    assert visits("2026-11")["mode"] == "manual"
    assert [v["date"] for v in visits("2026-11")["visits"]] == ["2026-11-07"]
    sibling_plan = client.get(f"/children/{sibling}/voucher-visits?month=2026-11", headers=H()).json()
    assert sibling_plan["mode"] == "actual" and [v["date"] for v in sibling_plan["visits"]] == ["2026-11-21"]
    assert len(visits("2026-12")["visits"]) == 5

    clock["month"] = "2027-01"
    assert put_setting(False, saved.json()["revision"]).status_code == 200
    assert len(visits("2026-12")["visits"]) == 5
    assert visits("2027-01")["mode"] == "unset"
    assert len(repo.list("audit_logs", "orgA", action="update_payment_settings")) == 2


def test_only_linked_owner_can_set_their_default(client, repo, child, monkeypatch):
    monkeypatch.setattr(voucher_doc, "_current_month", lambda: "2026-11")
    other = client.post("/children", headers=H(role="admin"), json={"alias": "B", "display_name": "합성",
                        "birth_date": "2020-01-01", "therapist": "다른 치료사"}).json()
    own = client.get("/me/payment-settings", headers=H()).json()
    body = {"expected_revision": own["revision"], "same_as_actual": True}
    assert client.put("/me/payment-settings", headers=H(), json={**body, "uid": "other"}).status_code == 422
    for h in (H(role="assistant"), H(role="admin", uid="other"), H(org="orgB")):
        assert client.put("/me/payment-settings", headers=h, json=body).status_code == 403
    assert client.put("/me/payment-settings", headers=H(), json=body).status_code == 200
    view = client.get(f"/children/{other['id']}/voucher-visits?month=2026-11", headers=H(role="admin")).json()
    assert view["mode"] == "unset"
