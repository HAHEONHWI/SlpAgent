# Postponed evaluation: the Protocol defines a method named `list`, which would otherwise shadow the builtin
# in later annotations and crash at import on Python 3.12 (production).
from __future__ import annotations
from typing import Any, Protocol


class NotFound(Exception):
    pass


class Repo(Protocol):
    """Every operation is scoped by org_id; a doc from another org is indistinguishable from a missing one."""

    def create(self, col: str, org_id: str, data: dict[str, Any], doc_id: str | None = None) -> dict: ...
    def get(self, col: str, org_id: str, doc_id: str) -> dict: ...
    def list(self, col: str, org_id: str, **eq: Any) -> list[dict]: ...
    def list_range(self, col: str, org_id: str, field: str, lo: str, hi: str, **eq: Any) -> list[dict]:
        """Docs with lo <= field <= hi (inclusive, string order) and the equality filters. Each matching doc is a
        billed read in Firestore, so prefer this over list() + filtering for dated collections."""
        ...
    def list_latest(self, col: str, org_id: str, field: str, limit: int, **eq: Any) -> list[dict]:
        """The `limit` docs with the largest `field`, newest first: reads only those docs."""
        ...
    def update(self, col: str, org_id: str, doc_id: str, patch: dict[str, Any]) -> dict: ...
    def delete(self, col: str, org_id: str, doc_id: str) -> None: ...
    def organization_documents(self, org_id: str) -> list[tuple[str, dict[str, Any]]]: ...
    def commit_organization_merge(self, source: str, target: str, token: str,
                                  writes: list[tuple[str, str, dict[str, Any]]]) -> None: ...


def now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
