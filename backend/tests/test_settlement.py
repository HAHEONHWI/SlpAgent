from app.services.billing import is_night, settlement, voucher_price
from tests.conftest import H

DAY = {"date": "2020-10-06", "start": "10:00"}    # 화요일 오전: 일반
NIGHT = {"date": "2020-10-06", "start": "19:00"}  # 19:00 이후: 야간
SAT = {"date": "2020-10-10", "start": "10:00"}    # 토요일: 야간


def test_night_is_seven_pm_or_saturday():
    assert not is_night(DAY["date"], DAY["start"]) and is_night(NIGHT["date"], NIGHT["start"]) and is_night(SAT["date"], SAT["start"])
    assert not is_night("2020-10-06", "18:50")
    assert voucher_price([DAY] * 5) == 52_000 and voucher_price([SAT] * 4) == 65_000


def test_copay_is_refunded_for_classes_not_used():
    # 라형 본인부담금 6만. 일반 수업 3회 = 3/5 → 36,000 받고 24,000 환불
    s = settlement("라", [DAY] * 3, 0, None)
    assert (s["copay"], s["copay_charged"], s["copay_refund"], s["voucher_amount"], s["support"]) == (60_000, 36_000, 24_000, 156_000, 120_000)
    # 야간 수업은 4회가 한 달: 3회 = 3/4 → 45,000, 15,000 환불
    s = settlement("라", [SAT] * 3, 0, None)
    assert (s["copay_charged"], s["copay_refund"], s["voucher_amount"]) == (45_000, 15_000, 195_000)
    # 다 쓰면 환불 없음: 일반 5회, 야간 4회 모두 26만원
    for full in ([DAY] * 5, [NIGHT] * 4):
        s = settlement("마", full, 0, None)
        assert (s["copay_charged"], s["copay_refund"], s["voucher_amount"], s["support"], s["over_budget"]) == (80_000, 0, 260_000, 180_000, False)
    assert settlement("마", [DAY] * 6, 0, None)["over_budget"]  # 31.2만 > 26만
    assert settlement("나", [DAY] * 2 + [SAT] * 2, 0, None)["copay_charged"] == 36_000  # 4만 × (2/5 + 2/4)
    assert settlement("다", [DAY], 0, None)["copay_charged"] == 0  # 기초: 면제
    assert settlement("가", [], 0, None)["copay_refund"] == 20_000
    # 유료 수업은 보호자 청구에 더해지고, 단가가 없으면 계산하지 않음
    assert settlement("가", [DAY] * 5, 2, 50_000)["guardian_total"] == 20_000 + 100_000
    assert settlement(None, [], 4, None)["guardian_total"] is None


def test_month_settlement_follows_attendance(client, child):
    cid = child["id"]
    client.put("/org", headers=H(role="admin"), json={"name": "센터", "paid_price": 50_000})
    assert client.put(f"/children/{cid}/voucher", headers=H(), json={"voucher_grade": "나"}).status_code == 200
    assert client.put(f"/children/{cid}/voucher", headers=H(), json={"voucher_grade": "바"}).status_code == 422
    ids = [client.post("/schedules", headers=H(), json={"child_id": cid, "date": d, "start": "10:00", "extra": "voucher"}).json()["id"]
           for d in ("2020-10-06", "2020-10-13", "2020-10-20")]
    client.post("/schedules", headers=H(), json={"child_id": cid, "date": "2020-10-21", "start": "10:00", "extra": "paid"})
    client.put(f"/schedules/{ids[1]}/attendance", headers=H(), json={"status": "absent"})
    admin = H(role="admin", uid="boss")
    [row] = client.get("/settlement?month=2020-10", headers=admin).json()["rows"]
    # 나형 4만, 일반 2회 → 16,000 청구 / 24,000 환불; 유료 1회 50,000
    assert (row["day_sessions"], row["copay_charged"], row["copay_refund"], row["paid_sessions"], row["guardian_total"]) == (2, 16_000, 24_000, 1, 66_000)
    v = client.get(f"/children/{cid}/voucher-visits?month=2020-10", headers=H()).json()
    assert (v["unit_price"], v["copay"]) == (52_000, 40_000)
    # without a 바우처 유형 every class is 유료
    client.put(f"/children/{cid}/voucher", headers=H(), json={"voucher_grade": None})
    [row] = client.get("/settlement?month=2020-10", headers=admin).json()["rows"]
    assert (row["day_sessions"], row["paid_sessions"], row["guardian_total"]) == (0, 3, 150_000)
    g = client.get("/settlement/grades", headers=admin).json()
    assert (g["total"], g["day_price"], g["night_price"]) == (260_000, 52_000, 65_000)
    assert [(x["grade"], x["support"]) for x in g["grades"]][:2] == [("다", 260_000), ("가", 240_000)]


def test_only_admins_and_accountants_see_settlement(client, repo, child):
    repo.create("users", "orgA", {"uid": "acc", "email": "acc@example.com", "name": "회계", "role": "assistant"}, doc_id="acc")
    acc, admin = H(role="assistant", uid="acc"), H(role="admin", uid="boss")
    for who in (H(), acc):  # the child's own therapist, and an assistant not yet picked
        assert client.get("/settlement?month=2020-10", headers=who).status_code == 403
        assert client.get("/me", headers=who).json()["can_settle"] is False
    assert client.get("/me", headers=admin).json()["can_settle"] is True
    # only an admin picks 회계 담당, from the organization's own accounts
    assert client.put("/org/accountants", headers=H(), json={"accountants": ["u1"]}).status_code == 403
    assert client.put("/org/accountants", headers=admin, json={"accountants": ["nobody"]}).status_code == 422
    assert client.put("/org/accountants", headers=admin, json={"accountants": ["acc"]}).json() == {"accountants": ["acc"]}
    assert client.get("/org/accountants", headers=admin).json() == {"accountants": ["acc"]}
    assert client.get("/me", headers=acc).json()["can_settle"] is True
    client.put(f"/children/{child['id']}/voucher", headers=H(), json={"voucher_grade": "가"})
    rows = client.get("/settlement?month=2020-10", headers=acc).json()["rows"]
    assert [r["child_id"] for r in rows] == [child["id"]]  # every child, not only their own
    assert client.get("/settlement?month=2020-10", headers=H()).status_code == 403
    client.put("/org/accountants", headers=admin, json={"accountants": []})
    assert client.get("/settlement?month=2020-10", headers=acc).status_code == 403
