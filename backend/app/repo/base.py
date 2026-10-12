from typing import Any, Protocol


class NotFound(Exception):
    pass


class Repo(Protocol):
    """Every operation is scoped by org_id; a doc from another org is indistinguishable from a missing one."""

    def create(self, col: str, org_id: str, data: dict[str, Any], doc_id: str | None = None) -> dict: ...
    def get(self, col: str, org_id: str, doc_id: str) -> dict: ...
    def list(self, col: str, org_id: str, **eq: Any) -> list[dict]: ...
    def update(self, col: str, org_id: str, doc_id: str, patch: dict[str, Any]) -> dict: ...
    def delete(self, col: str, org_id: str, doc_id: str) -> None: ...


def now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
