from contextvars import copy_context

import anyio
import pytest

from app.repo.base import NotFound
from app.repo.firestore import FirestoreRepo
from app.repo.request_cache import FirestoreReadCacheMiddleware, RequestReads, clear_request_reads, request_reads
from tests.test_firestore_knowledge_cache import Client


@pytest.fixture
def repo():
    instance = FirestoreRepo.__new__(FirestoreRepo)
    instance.c = Client()
    instance._knowledge_documents_cache = {}
    return instance


@pytest.fixture
def request_context():
    token = request_reads.set(RequestReads())
    try:
        yield
    finally:
        clear_request_reads()
        request_reads.reset(token)


@pytest.mark.parametrize("method,args", [
    ("get", ("children", "orgA", "a")), ("list", ("children", "orgA")),
])
def test_cached_results_are_independent_copies(repo, request_context, method, args):
    doc = repo.create("children", "orgA", {"therapist": "A"}, doc_id="a")
    read = getattr(repo, method)
    expected = {"get": doc, "list": [doc]}[method]
    read(*args).clear()

    assert read(*args) == expected
    assert repo.c.collection("children").reads == 1


def test_create_invalidates_cached_missing_document_and_empty_list(repo, request_context):
    with pytest.raises(NotFound):
        repo.get("children", "orgA", "a")
    assert repo.list("children", "orgA") == []

    created = repo.create("children", "orgA", {"therapist": "A"}, doc_id="a")

    assert repo.get("children", "orgA", "a") == created
    assert repo.list("children", "orgA") == [created]


def test_update_invalidates_cached_document_and_list(repo, request_context):
    repo.create("children", "orgA", {"therapist": "A"}, doc_id="a")
    repo.get("children", "orgA", "a")
    repo.list("children", "orgA")

    updated = repo.update("children", "orgA", "a", {"therapist": "B"})

    assert repo.get("children", "orgA", "a")["therapist"] == "B"
    assert repo.list("children", "orgA") == [updated]


def test_delete_invalidates_cached_document_and_list(repo, request_context):
    repo.create("children", "orgA", {"therapist": "A"}, doc_id="a")
    repo.get("children", "orgA", "a")
    repo.list("children", "orgA")

    repo.delete("children", "orgA", "a")

    with pytest.raises(NotFound):
        repo.get("children", "orgA", "a")
    assert repo.list("children", "orgA") == []


def test_caches_preserve_organization_boundaries(repo, request_context):
    repo.create("children", "orgA", {}, doc_id="a")
    repo.create("children", "orgB", {}, doc_id="b")
    repo.get("children", "orgA", "a")
    assert [r["id"] for r in repo.list("children", "orgA")] == ["a"]

    with pytest.raises(NotFound):
        repo.get("children", "orgB", "a")
    assert [r["id"] for r in repo.list("children", "orgB")] == ["b"]


def test_filtered_queries_do_not_reuse_unfiltered_results(repo, request_context):
    repo.create("children", "orgA", {"therapist": "A"}, doc_id="a")
    repo.create("children", "orgA", {"therapist": "B"}, doc_id="b")
    assert len(repo.list("children", "orgA")) == 2

    assert [r["id"] for r in repo.list("children", "orgA", therapist="B")] == ["b"]


def test_reads_outside_requests_remain_fresh(repo):
    repo.create("children", "orgA", {"therapist": "A"}, doc_id="a")
    assert repo.get("children", "orgA", "a")["therapist"] == "A"
    repo.c.collection("children").documents["a"]["therapist"] = "B"

    assert repo.get("children", "orgA", "a")["therapist"] == "B"


async def receive():
    return {"type": "http.disconnect"}


async def send(message):
    assert message["type"] == "http.response.start"


def test_overlapping_requests_keep_separate_snapshots(repo):
    repo.create("children", "orgA", {"therapist": "A"}, doc_id="a")
    observed = {}

    async def scenario():
        ready, resume = anyio.Event(), anyio.Event()

        async def endpoint(scope, receive, send):
            observed[scope["path"]] = repo.get("children", "orgA", "a")["therapist"]
            if scope["path"].endswith("first"):
                ready.set()
                await resume.wait()

        middleware = FirestoreReadCacheMiddleware(endpoint)
        with anyio.fail_after(5):
            async with anyio.create_task_group() as group:
                group.start_soon(middleware, {"type": "http", "path": "/first"}, receive, send)
                await ready.wait()
                repo.c.collection("children").documents["a"]["therapist"] = "B"
                await middleware({"type": "http", "path": "/second"}, receive, send)
                resume.set()

    anyio.run(scenario)

    assert observed == {"/first": "A", "/second": "B"}
    assert request_reads.get() is None


def test_failed_request_disables_inherited_cache_context(repo):
    repo.create("children", "orgA", {"therapist": "A"}, doc_id="a")
    inherited = []

    async def endpoint(scope, receive, send):
        repo.get("children", "orgA", "a")
        inherited.append(copy_context())
        raise RuntimeError("synthetic failure")

    with pytest.raises(RuntimeError, match="synthetic failure"):
        anyio.run(FirestoreReadCacheMiddleware(endpoint), {"type": "http"}, receive, send)
    repo.c.collection("children").documents["a"]["therapist"] = "B"

    assert request_reads.get() is None
    assert inherited[0].run(repo.get, "children", "orgA", "a")["therapist"] == "B"
    repo.c.collection("children").documents["a"]["therapist"] = "C"
    assert inherited[0].run(repo.get, "children", "orgA", "a")["therapist"] == "C"
