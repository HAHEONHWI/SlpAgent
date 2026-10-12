import os
os.environ.update(ENV="test", AUTH_MODE="dev", STORAGE_BACKEND="memory", OPENAI_API_KEY="x", OPENAI_MODEL="test-model")
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.deps import get_repo
from app.repo.memory import MemoryRepo


@pytest.fixture
def repo():
    r = MemoryRepo()
    app.dependency_overrides[get_repo] = lambda: r
    yield r
    app.dependency_overrides.clear()


@pytest.fixture
def client(repo):
    return TestClient(app)


def H(org="orgA", role="therapist", uid="u1"):
    return {"Authorization": f"Bearer dev:{org}:{role}:{uid}"}


@pytest.fixture
def child(client):
    r = client.post("/children", json={"alias": "A-01", "display_name": "테스트아동", "birth_date": "2022-03-15",
                                       "guardian_contact": "010-0000-0000"}, headers=H())
    assert r.status_code == 201
    return r.json()
