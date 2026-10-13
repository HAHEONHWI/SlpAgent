from functools import lru_cache
from ..config import get_settings
from .base import Repo


@lru_cache
def get_repo() -> Repo:
    """The repository dependency. Lives here (not in deps) so auth can depend on it without a circular import;
    deps re-exports this same function, so dependency overrides apply everywhere."""
    if get_settings().storage_backend == "memory":
        from .memory import MemoryRepo
        return MemoryRepo()
    from .firestore import FirestoreRepo
    return FirestoreRepo()
