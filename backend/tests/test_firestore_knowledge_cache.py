from copy import copy, deepcopy
from collections import defaultdict
from types import SimpleNamespace
from operator import eq, ge, le

import app.repo.firestore as firestore_module
from app.repo.firestore import FirestoreRepo


class Snapshot:
    def __init__(self, data):
        self.data = deepcopy(data)
        self.exists = data is not None

    def to_dict(self):
        return deepcopy(self.data)


class Query:
    def __init__(self, collection, filters=()):
        self.collection = collection
        self.filters = filters
        self.ordering = None
        self.max_results = None

    def where(self, field, operator, value):
        query = copy(self)
        query.filters = (*self.filters, (field, operator, value))
        return query

    def order_by(self, field: str, direction: str = "ASCENDING") -> "Query":
        query = copy(self)
        query.ordering = (field, direction)
        return query

    def limit(self, count: int) -> "Query":
        query = copy(self)
        query.max_results = count
        return query

    def _rows(self):
        rows = self.collection.documents.values()
        for field, operator, value in self.filters:
            compare = {"==": eq, ">=": ge, "<=": le}[operator]
            rows = [row for row in rows if field in row and (operator == "==" or row[field] is not None)
                    and compare(row[field], value)]
        found = list(rows)
        if self.ordering is not None:
            field, direction = self.ordering
            found = sorted((row for row in found if field in row), key=lambda row: row[field],
                           reverse=direction == "DESCENDING")
        if self.max_results is not None:
            found = found[:self.max_results]
        return found

    def stream(self):
        self.collection.reads += 1
        found = self._rows()
        self.collection.billed_reads += max(1, len(found))
        return [Snapshot(row) for row in found]

    def count(self):
        return Aggregation(self)


class Aggregation:
    def __init__(self, query):
        self.query = query

    def get(self):
        count = len(self.query._rows())
        self.query.collection.reads += 1
        self.query.collection.billed_reads += max(1, (count + 999) // 1000)
        return [[SimpleNamespace(value=count)]]


class Document:
    def __init__(self, collection, doc_id):
        self.collection = collection
        self.doc_id = doc_id

    def set(self, data):
        self.collection.documents[self.doc_id] = deepcopy(data)

    def get(self):
        self.collection.reads += 1
        self.collection.billed_reads += 1
        return Snapshot(self.collection.documents.get(self.doc_id))

    def update(self, patch):
        self.collection.documents[self.doc_id].update(deepcopy(patch))

    def delete(self):
        del self.collection.documents[self.doc_id]


class Collection:
    def __init__(self):
        self.documents = {}
        self.reads = 0
        self.billed_reads = 0

    def where(self, field, operator, value):
        return Query(self).where(field, operator, value)

    def document(self, doc_id):
        return Document(self, doc_id)


class Client:
    def __init__(self):
        self.collections = defaultdict(Collection)

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
