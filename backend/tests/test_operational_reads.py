from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.repo.firestore import FirestoreRepo
from tests.conftest import H
from tests.test_firestore_reads import firestore_repo as firestore_repo


def test_daily_attendance_does_not_load_other_days_or_session_history(
    client: TestClient, firestore_repo: FirestoreRepo,
) -> None:
    firestore_repo.create("timetable_sync", "orgA", {"rev": ":"}, doc_id="orgA-2020-10")
    for index in range(500):
        firestore_repo.create("schedules", "orgA", {
            "child_id": "own", "date": "2020-10-15", "start": "10:00", "end": "10:40", "status": "scheduled",
        }, doc_id=f"other-day-{index}")
    for index in range(50):
        firestore_repo.create("therapy_sessions", "orgA", {
            "child_id": "own", "date": "2020-10-15", "start": "10:00", "status": "completed",
        })
    firestore_repo.create("schedules", "orgA", {
        "child_id": "own", "date": "2020-10-01", "start": "10:00", "end": "10:40", "status": "scheduled",
    }, doc_id="today")

    response = client.get("/attendance/day?on=2020-10-01", headers=H())

    assert response.status_code == 200
    [row] = response.json()
    assert row["schedule_id"] == "today" and row["pay"] == "voucher" and row["pay_auto"]
    assert row["state"]["status"] == "present"
    assert firestore_repo.c.collection("schedules").billed_reads == 1
    assert firestore_repo.c.collection("therapy_sessions").billed_reads == 0


def test_child_attendance_reuses_loaded_month_for_payment_categories(
    client: TestClient, firestore_repo: FirestoreRepo,
) -> None:
    firestore_repo.create("timetable_sync", "orgA", {"rev": ":"}, doc_id="orgA-2020-10")
    for index, pay in enumerate(("voucher", "private", "cognitive")):
        firestore_repo.create("schedules", "orgA", {
            "child_id": "own", "date": f"2020-10-0{index + 1}", "start": "10:00", "end": "10:40",
            "status": "scheduled", "pay": pay,
        })

    response = client.get("/children/own/attendance?month=2020-10", headers=H())

    assert response.status_code == 200
    assert [row["pay"] for row in response.json()["records"]] == ["voucher", "private", "cognitive"]
    assert firestore_repo.c.collection("schedules").billed_reads == 3
    assert firestore_repo.c.collection("attendance").reads == 1
    assert firestore_repo.c.collection("therapy_sessions").billed_reads == 0


def test_billing_summary_reads_only_selected_child_and_month(
    client: TestClient, firestore_repo: FirestoreRepo,
) -> None:
    for index in range(300):
        firestore_repo.create("therapy_sessions", "orgA", {
            "child_id": "own", "date": "2019-10-01", "start": "10:00", "end": "10:40", "status": "completed",
        })
    for org, child, status in (("orgA", "own", "completed"), ("orgA", "own", "cancelled"),
                                ("orgA", "other-0", "completed"), ("orgB", "own", "completed")):
        firestore_repo.create("therapy_sessions", org, {
            "child_id": child, "date": "2020-10-01", "start": "10:00", "end": "10:40", "status": status,
        })

    response = client.get("/billing/summary?child_id=own&month=2020-10&unit_price=40000", headers=H())

    assert response.status_code == 200
    assert response.json()["session_count"] == 1
    assert response.json()["total_minutes"] == 40
    assert response.json()["total_amount"] == 40000
    assert firestore_repo.c.collection("therapy_sessions").billed_reads == 2
    assert client.get("/billing/summary?child_id=other-0&month=2020-10", headers=H()).status_code == 404
    assert firestore_repo.c.collection("therapy_sessions").billed_reads == 2


@pytest.mark.parametrize("route", ["/platform/summary", "/platform/organizations"])
def test_platform_counts_do_not_download_clinical_documents(
    client: TestClient, firestore_repo: FirestoreRepo, route: str,
) -> None:
    firestore_repo.create("organization_registry", "_platform", {"org_id": "orgA", "name": "Synthetic"})
    firestore_repo.create("children", "orgA", {"archived": True})
    firestore_repo.create("children", "orgA", {"display_name": "LEGACY_PRIVATE_CHILD"})
    day = datetime.now(timezone.utc).date().isoformat()
    for index in range(200):
        firestore_repo.create("therapy_sessions", "orgA", {
            "date": day, "child_id": "own", "private_notes": "PRIVATE_CLINICAL_MARKER",
        })
    firestore_repo.create("therapy_sessions", "orgA", {"date": "2000-01-01"})
    firestore_repo.create("therapy_sessions", "orgB", {"date": day})

    response = client.get(route, headers=H("-", "site_admin", "root"))

    assert response.status_code == 200
    data = response.json() if route.endswith("summary") else response.json()[0]
    assert (data["children"], data["users"], data["sessions_30d"]) == (102, 1, 200)
    assert "PRIVATE" not in response.text
    assert firestore_repo.c.collection("children").billed_reads == 2
    assert firestore_repo.c.collection("therapy_sessions").billed_reads == 1
    assert firestore_repo.c.collection("users").billed_reads == 1
    assert client.get(route, headers=H(role="admin")).status_code == 403


def test_attendance_payment_categories_preserve_legacy_absence_and_move_semantics(client, repo, child) -> None:
    cases = [{"pay": "voucher"}, {"pay": "private"}, {"pay": "cognitive"}, {"extra": "paid"}, {},
             {"status": "moved"}, {"mark": "absent"}, {"mark": "excused"}, {"mark": "present"}]
    for index, case in enumerate(cases):
        schedule = repo.create("schedules", "orgA", {
            "child_id": child["id"], "date": "2020-10-01", "start": f"{index + 9:02}:00",
            "end": f"{index + 9:02}:40", "status": "scheduled", **{k: v for k, v in case.items() if k != "mark"},
        })
        if case.get("mark"):
            repo.create("attendance", "orgA", {"schedule_id": schedule["id"], "child_id": child["id"],
                        "date": "2020-10-01", "status": case["mark"]})

    daily = client.get("/attendance/day?on=2020-10-01", headers=H())
    monthly = client.get(f"/children/{child['id']}/attendance?month=2020-10", headers=H())

    assert daily.status_code == monthly.status_code == 200
    expected = [("voucher", False), ("private", False), ("cognitive", False), ("private", False), ("voucher", True),
                (None, False), (None, False), (None, False), ("voucher", True)]
    assert [(row["pay"], row["pay_auto"]) for row in daily.json()] == expected
    assert [row["pay"] for row in monthly.json()["records"]] == [pay for pay, _ in expected]


@pytest.mark.parametrize("month", ["bad", "2020", "2020-00", "2020-13", "2020-01-01"])
def test_billing_summary_rejects_invalid_month_before_querying_history(client, firestore_repo, month: str) -> None:
    response = client.get(f"/billing/summary?child_id=own&month={month}", headers=H())

    assert response.status_code == 422
    assert firestore_repo.c.collection("therapy_sessions").reads == 0
