import os
os.environ.update(ENV="test", AUTH_MODE="dev", STORAGE_BACKEND="memory", OPENAI_API_KEY="x", OPENAI_MODEL="test-model")
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.deps import get_repo
from app.repo.memory import MemoryRepo


THERAPIST = "테스트치료사"


@pytest.fixture
def repo():
    r = MemoryRepo()
    # the default test account (H(): therapist u1) is the 담당 치료사 of the test child; therapists only see their own children
    r.create("users", "orgA", {"uid": "u1", "email": "u1@example.com", "name": THERAPIST, "role": "therapist"}, doc_id="u1")
    app.dependency_overrides[get_repo] = lambda: r
    yield r
    app.dependency_overrides.clear()


@pytest.fixture
def client(repo):
    app.middleware_stack = app.build_middleware_stack()
    with TestClient(app) as test_client:
        yield test_client


def H(org="orgA", role="therapist", uid="u1"):
    return {"Authorization": f"Bearer dev:{org}:{role}:{uid}"}


@pytest.fixture
def child(client):
    r = client.post("/children", json={"alias": "A-01", "display_name": "테스트아동", "birth_date": "2022-03-15",
                                       "guardian_contact": "010-0000-0000", "therapist": THERAPIST}, headers=H())
    assert r.status_code == 201
    return r.json()


def grant_license(repo, org, *codes):
    """Record that `org` holds a license for these tests (normally set by a site admin)."""
    try:
        repo.update("organizations", org, org, {"licensed_assessments": list(codes)})
    except Exception:
        repo.create("organizations", org, {"licensed_assessments": list(codes)}, doc_id=org)
