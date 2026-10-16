from copy import deepcopy

import app.repo.firestore as firestore_module
from app.repo.firestore import FirestoreRepo


class Snapshot:
    def __init__(self, data):
        self.data = data

    def to_dict(self):
        return deepcopy(self.data)


class Query:
    def __init__(self, collection, filters=()):
        self.collection = collection
        self.filters = filters

    def where(self, field, operator, value):
        return Query(self.collection, (*self.filters, (field, operator, value)))

    def stream(self):
        self.collection.reads += 1
        rows = self.collection.documents.values()
        return [Snapshot(row) for row in rows
                if all(row.get(field) == value for field, operator, value in self.filters)]


class Document:
    def __init__(self, collection, doc_id):
        self.collection = collection
        self.doc_id = doc_id

    def set(self, data):
        self.collection.documents[self.doc_id] = deepcopy(data)


class Collection:
    def __init__(self):
        self.documents = {}
        self.reads = 0

    def where(self, field, operator, value):
        return Query(self).where(field, operator, value)

    def document(self, doc_id):
        return Document(self, doc_id)


class Client:
    def __init__(self):
        self.collections = {"knowledge_documents": Collection()}

    def collection(self, name):
        return self.collections[name]


def test_knowledge_document_cache_is_org_scoped_and_invalidated_on_write():
    repo = FirestoreRepo.__new__(FirestoreRepo)
    repo.c = Client()
    repo._knowledge_documents_cache = {}
    collection = repo.c.collection("knowledge_documents")
    collection.documents.update({
        "a1": {"id": "a1", "organization_id": "orgA", "text": "A"},
        "b1": {"id": "b1", "organization_id": "orgB", "text": "B"},
    })

    first = repo.list("knowledge_documents", "orgA")
    first[0]["text"] = "mutated caller copy"
    assert repo.list("knowledge_documents", "orgA")[0]["text"] == "A"
    assert collection.reads == 1
    assert [row["id"] for row in repo.list("knowledge_documents", "orgB")] == ["b1"]
    assert collection.reads == 2

    repo.create("knowledge_documents", "orgA", {"text": "new"}, doc_id="a2")
    assert {row["id"] for row in repo.list("knowledge_documents", "orgA")} == {"a1", "a2"}
    assert collection.reads == 3


def test_knowledge_document_cache_expires_after_five_minutes(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(firestore_module.time, "monotonic", lambda: now[0])
    repo = FirestoreRepo.__new__(FirestoreRepo)
    repo.c = Client()
    repo._knowledge_documents_cache = {}
    collection = repo.c.collection("knowledge_documents")
    collection.documents["a1"] = {"id": "a1", "organization_id": "orgA", "text": "A"}

    assert len(repo.list("knowledge_documents", "orgA")) == 1
    collection.documents["a2"] = {"id": "a2", "organization_id": "orgA", "text": "B"}
    now[0] += 299
    assert len(repo.list("knowledge_documents", "orgA")) == 1
    now[0] += 1
    assert len(repo.list("knowledge_documents", "orgA")) == 2
    assert collection.reads == 2
