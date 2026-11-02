import pytest

from app.repo.firestore import FirestoreRepo
from app.repo.memory import MemoryRepo
from tests.test_firestore_knowledge_cache import Client


@pytest.fixture(params=[False, True])
def count_repo(request: pytest.FixtureRequest) -> MemoryRepo | FirestoreRepo:
    if request.param:
        instance = FirestoreRepo.__new__(FirestoreRepo)
        instance.c = Client()
        instance._knowledge_documents_cache = {}
        return instance
    return MemoryRepo()


def test_counts_preserve_organization_filters_and_inclusive_date_range(count_repo: MemoryRepo | FirestoreRepo) -> None:
    for org, day, archived in (("orgA", "2020-10-01", False), ("orgA", "2020-10-31", True),
                               ("orgA", "2020-11-01", False), ("orgB", "2020-10-01", False)):
        count_repo.create("records", org, {"date": day, "archived": archived})
    count_repo.create("records", "orgA", {})

    assert count_repo.count("records", "orgA") == 4
    assert count_repo.count("records", "orgA", archived=True) == 1
    assert count_repo.count("records", "orgB") == 1
    assert count_repo.count("records", "orgC") == 0
    assert count_repo.count_range("records", "orgA", "date", "2020-10-01", "2020-10-31") == 2
    assert count_repo.count_range("records", "orgA", "date", "2020-10-01", "2020-10-31", archived=False) == 1


def test_counts_are_fresh_after_creates_updates_and_deletes(count_repo: MemoryRepo | FirestoreRepo) -> None:
    assert count_repo.count("records", "orgA", archived=True) == 0
    doc = count_repo.create("records", "orgA", {"archived": True})
    assert count_repo.count("records", "orgA", archived=True) == 1
    count_repo.update("records", "orgA", doc["id"], {"archived": False})
    assert count_repo.count("records", "orgA", archived=True) == 0
    assert count_repo.count("records", "orgA") == 1
    count_repo.delete("records", "orgA", doc["id"])
    assert count_repo.count("records", "orgA") == 0


@pytest.mark.parametrize(("documents", "billed_reads"), [(0, 1), (1000, 1), (1001, 2)])
def test_firestore_count_uses_aggregation_instead_of_document_stream(documents: int, billed_reads: int) -> None:
    instance = FirestoreRepo.__new__(FirestoreRepo)
    instance.c = Client()
    collection = instance.c.collection("records")
    for index in range(documents):
        collection.documents[str(index)] = {"organization_id": "orgA"}

    assert instance.count("records", "orgA") == documents
    assert collection.billed_reads == billed_reads
