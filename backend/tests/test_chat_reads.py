from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.repo.firestore import FirestoreRepo
from app.repo.memory import MemoryRepo
from app.routers.chat import get_client
from tests.conftest import H
from tests.test_dialogue_security import AnswerClient
from tests.test_firestore_knowledge_cache import Client
from tests.test_firestore_reads import firestore_repo as firestore_repo


def test_conversation_list_reads_only_latest_fifty_for_current_user(
    client: TestClient, firestore_repo: FirestoreRepo,
) -> None:
    collection = firestore_repo.c.collection("chat_conversations")
    for index in range(75):
        conversation = firestore_repo.create("chat_conversations", "orgA", {
            "user_id": "u1", "title": f"Question {index}", "mode": "knowledge",
        }, doc_id=f"conversation-{index}")
        collection.documents[conversation["id"]]["updated_at"] = (
            datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=index)
        ).isoformat()
    firestore_repo.create("chat_conversations", "orgA", {
        "user_id": "someone-else", "title": "Private", "mode": "knowledge",
    })
    firestore_repo.create("chat_conversations", "orgB", {
        "user_id": "u1", "title": "Other organization", "mode": "knowledge",
    })

    response = client.get("/ai/dialogue/conversations", headers=H())

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [f"conversation-{i}" for i in range(74, 24, -1)]
    assert collection.billed_reads == 50


def test_legacy_conversation_title_reads_only_first_user_message(
    client: TestClient, firestore_repo: FirestoreRepo,
) -> None:
    firestore_repo.create("chat_conversations", "orgA", {
        "user_id": "u1", "child_id": None,
    }, doc_id="legacy")
    messages = firestore_repo.c.collection("chat_messages")
    for index in range(200):
        message = firestore_repo.create("chat_messages", "orgA", {
            "conversation_id": "legacy", "role": "user" if index % 2 else "assistant",
            "content": "first@example.com initial question" if index == 1 else f"Message {index}",
        })
        messages.documents[message["id"]]["created_at"] = (
            datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=index)
        ).isoformat()
    foreign = firestore_repo.create("chat_messages", "orgB", {
        "conversation_id": "legacy", "role": "user", "content": "Must stay private",
    })
    messages.documents[foreign["id"]]["created_at"] = "2020-01-01T00:00:00Z"

    response = client.get("/ai/dialogue/conversations", headers=H())

    assert response.status_code == 200
    assert response.json()[0]["title"] == "[이메일] initial question"
    assert response.json()[0]["mode"] == "knowledge"
    assert messages.billed_reads == 1


def test_new_conversation_does_not_query_nonexistent_history(
    client: TestClient, firestore_repo: FirestoreRepo,
) -> None:
    app.dependency_overrides[get_client] = lambda: AnswerClient()

    response = client.post("/ai/dialogue", headers=H(), json={"message": "수용언어 설명"})

    assert response.status_code == 200
    assert len(firestore_repo.c.collection("chat_messages").documents) == 2
    assert firestore_repo.c.collection("chat_messages").billed_reads == 0


def test_ordered_fake_filters_before_limiting_and_keeps_queries_independent() -> None:
    collection = Client().collection("messages")
    collection.documents.update({
        "a": {"organization_id": "orgA", "created_at": "2026-01-01", "role": "user"},
        "b": {"organization_id": "orgA", "created_at": "2026-01-02", "role": "user"},
        "c": {"organization_id": "orgB", "created_at": "2020-01-01", "role": "user"},
        "missing": {"organization_id": "orgA", "role": "user"},
    })
    query = collection.where("organization_id", "==", "orgA")

    oldest = query.order_by("created_at").limit(1).stream()
    newest = query.order_by("created_at", direction="DESCENDING").limit(1).stream()

    assert [row.to_dict()["created_at"] for row in oldest] == ["2026-01-01"]
    assert [row.to_dict()["created_at"] for row in newest] == ["2026-01-02"]
    assert collection.billed_reads == 2


def test_memory_earliest_query_preserves_filters_order_and_copies() -> None:
    repo = MemoryRepo()
    repo.create("messages", "orgA", {"sent_at": "2026-01-02", "role": "user"}, doc_id="new")
    repo.create("messages", "orgA", {"sent_at": "2026-01-01", "role": "user"}, doc_id="old")
    repo.create("messages", "orgA", {"sent_at": "2020-01-01", "role": "assistant"})
    repo.create("messages", "orgA", {"role": "user"})
    repo.create("messages", "orgB", {"sent_at": "2010-01-01", "role": "user"})

    result = repo.list_earliest("messages", "orgA", "sent_at", 1, role="user")
    result[0]["sent_at"] = "changed caller copy"

    assert [row["id"] for row in result] == ["old"]
    assert repo.get("messages", "orgA", "old")["sent_at"] == "2026-01-01"
