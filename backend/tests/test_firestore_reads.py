import pytest

from app.deps import get_repo
from app.main import app
from app.repo.firestore import FirestoreRepo
from tests.conftest import H, THERAPIST
from tests.test_firestore_knowledge_cache import Client


@pytest.fixture
def firestore_repo(client):
    repo = FirestoreRepo.__new__(FirestoreRepo)
    repo.c = Client()
    repo._knowledge_documents_cache = {}
    repo.create("organizations", "orgA", {
        "name": "Synthetic organization", "therapists": [{"uid": "u1", "name": THERAPIST}],
    }, doc_id="orgA")
    repo.create("users", "orgA", {"uid": "u1", "name": THERAPIST}, doc_id="u1")
    repo.create("children", "orgA", {
        "therapist": f" {THERAPIST} ", "birth_date": "2022-01-01", "archived": False,
    }, doc_id="own")
    for i in range(100):
        repo.create("children", "orgA", {
            "therapist": "Other therapist", "birth_date": "2022-01-01", "archived": False,
        }, doc_id=f"other-{i}")
    app.dependency_overrides[get_repo] = lambda: repo
    return repo


def test_recording_list_reads_only_selected_child(client, firestore_repo):
    response = client.get("/children/own/recordings", headers=H())

    assert response.status_code == 200
    assert response.json() == []
    assert sum(col.billed_reads for col in firestore_repo.c.collections.values()) == 4


def test_child_list_reads_collection_once(client, firestore_repo):
    response = client.get("/children", headers=H())

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == ["own"]
    assert firestore_repo.c.collection("children").reads == 1


def test_me_reads_organization_once(client, firestore_repo):
    response = client.get("/me", headers=H())

    assert response.status_code == 200
    assert response.json()["therapist_name"] == THERAPIST
    assert firestore_repo.c.collection("organizations").reads == 1


def test_record_ownership_avoids_reading_all_children(client, firestore_repo):
    firestore_repo.create("ai_analyses", "orgA", {
        "child_id": "own", "status": "draft", "kind": "session_note", "payload": {},
    }, doc_id="draft")

    response = client.post("/proposals/draft/reject", headers=H())

    assert response.status_code == 200
    assert response.json()["status"] == "rejected"
    assert firestore_repo.c.collection("children").reads == 1
    assert firestore_repo.c.collection("children").billed_reads == 1


@pytest.mark.parametrize("uid", ["u1", "unlinked"])
def test_next_request_observes_child_assignment(client, firestore_repo, uid):
    assert client.get("/children/own/recordings", headers=H()).status_code == 200
    firestore_repo.c.collection("children").documents["own"]["therapist"] = "Other therapist"

    response = client.get("/children/own/recordings", headers=H(uid=uid))

    assert response.status_code == 404


def test_next_request_observes_account_suspension(client, firestore_repo):
    assert client.get("/children/own/recordings", headers=H()).status_code == 200
    firestore_repo.c.collection("account_access").documents["u1"] = {
        "organization_id": "_platform", "disabled": True,
    }

    response = client.get("/children/own/recordings", headers=H())

    assert response.status_code == 403


def test_next_request_observes_organization_merge(client, firestore_repo):
    assert client.get("/children/own/recordings", headers=H()).status_code == 200
    firestore_repo.c.collection("organizations").documents["orgA"]["status"] = "merged"

    response = client.get("/children/own/recordings", headers=H())

    assert response.status_code == 403
