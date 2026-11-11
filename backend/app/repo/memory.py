from __future__ import annotations

import copy, uuid
from collections import defaultdict
from threading import Lock
from typing import Any
from pydantic import JsonValue
from .base import NotFound, VersionedChange, now_iso, versioned_document


class MemoryRepo:
    def __init__(self):
        self.db: dict[str, dict[str, dict]] = defaultdict(dict)
        self._version_lock = Lock()

    def create(self, col, org_id, data, doc_id=None):
        doc_id = doc_id or uuid.uuid4().hex
        doc = {**copy.deepcopy(data), "id": doc_id, "organization_id": org_id, "created_at": now_iso(), "updated_at": now_iso()}
        with self._version_lock:
            self.db[col][doc_id] = doc
        return copy.deepcopy(doc)

    def get(self, col, org_id, doc_id):
        d = self.db[col].get(doc_id)
        if not d or d["organization_id"] != org_id:
            raise NotFound(doc_id)
        return copy.deepcopy(d)

    def list(self, col, org_id, **eq: Any):
        return [copy.deepcopy(d) for d in self.db[col].values()
                if d["organization_id"] == org_id and all(d.get(k) == v for k, v in eq.items())]

    def count(self, col: str, org_id: str, **eq: str | bool) -> int:
        return len(self.list(col, org_id, **eq))

    def count_range(self, col: str, org_id: str, field: str, lo: str, hi: str, **eq: str | bool) -> int:
        return len(self.list_range(col, org_id, field, lo, hi, **eq))

    def list_range(self, col, org_id, field, lo, hi, **eq: Any):
        return [d for d in self.list(col, org_id, **eq) if d.get(field) is not None and lo <= d[field] <= hi]

    def list_latest(self, col, org_id, field, limit, **eq: Any):
        return sorted(self.list(col, org_id, **eq), key=lambda d: d.get(field) or "", reverse=True)[:limit]

    def list_earliest(self, col: str, org_id: str, field: str, limit: int, **eq: str) -> list[dict[str, JsonValue]]:
        """Mirror Firestore ordering, including its exclusion of missing sort fields."""
        return sorted((row for row in self.list(col, org_id, **eq) if field in row),
                      key=lambda row: row.get(field) or "")[:limit]

    def update(self, col, org_id, doc_id, patch):
        with self._version_lock:
            d = self.db[col].get(doc_id)
            if not d or d["organization_id"] != org_id:
                raise NotFound(doc_id)
            patch = {k: v for k, v in patch.items() if k not in ("id", "organization_id")}
            d.update(copy.deepcopy(patch), updated_at=now_iso())
            return copy.deepcopy(d)

    def delete(self, col, org_id, doc_id):
        with self._version_lock:
            d = self.db[col].get(doc_id)
            if not d or d["organization_id"] != org_id:
                raise NotFound(doc_id)
            del self.db[col][doc_id]

    def save_versioned(self, col, org_id, doc_id, data, expected_revision, *, also=()):
        changes = (VersionedChange(col, doc_id, expected_revision, data), *also)
        with self._version_lock:
            writes = []
            for change in changes:
                saved = versioned_document(self.db[change.collection].get(change.id), org_id, change)
                if saved is not None:
                    writes.append((change, saved))
            updated = self.db.copy()
            for collection in {change.collection for change, _ in writes}:
                updated[collection] = self.db[collection].copy()
            for change, saved in writes:
                updated[change.collection][change.id] = copy.deepcopy(saved)
            self.db = updated
            return copy.deepcopy(writes[0][1])

    def organization_documents(self, org_id):
        return [(col, copy.deepcopy(doc)) for col, rows in self.db.items()
                for doc in rows.values() if doc["organization_id"] == org_id]

    def commit_organization_merge(self, source, target, token, writes):
        from ..services.organization_merge import build_merge
        from fastapi import HTTPException
        with self._version_lock:
            if build_merge(self, source, target)[0]["preview_token"] != token:
                raise HTTPException(409, "merge preview expired; preview again")
            updated = copy.deepcopy(self.db)
            for col, doc_id, doc in writes:
                updated[col][doc_id] = copy.deepcopy(doc)
            self.db = updated
