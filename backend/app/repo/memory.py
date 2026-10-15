import copy, uuid
from collections import defaultdict
from typing import Any
from .base import NotFound, now_iso


class MemoryRepo:
    def __init__(self):
        self.db: dict[str, dict[str, dict]] = defaultdict(dict)

    def create(self, col, org_id, data, doc_id=None):
        doc_id = doc_id or uuid.uuid4().hex
        doc = {**copy.deepcopy(data), "id": doc_id, "organization_id": org_id, "created_at": now_iso(), "updated_at": now_iso()}
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

    def list_range(self, col, org_id, field, lo, hi, **eq: Any):
        return [d for d in self.list(col, org_id, **eq) if d.get(field) is not None and lo <= d[field] <= hi]

    def list_latest(self, col, org_id, field, limit, **eq: Any):
        return sorted(self.list(col, org_id, **eq), key=lambda d: d.get(field) or "", reverse=True)[:limit]

    def update(self, col, org_id, doc_id, patch):
        d = self.db[col].get(doc_id)
        if not d or d["organization_id"] != org_id:
            raise NotFound(doc_id)
        patch = {k: v for k, v in patch.items() if k not in ("id", "organization_id")}
        d.update(copy.deepcopy(patch), updated_at=now_iso())
        return copy.deepcopy(d)

    def delete(self, col, org_id, doc_id):
        d = self.db[col].get(doc_id)
        if not d or d["organization_id"] != org_id:
            raise NotFound(doc_id)
        del self.db[col][doc_id]

    def organization_documents(self, org_id):
        return [(col, copy.deepcopy(doc)) for col, rows in self.db.items()
                for doc in rows.values() if doc["organization_id"] == org_id]

    def commit_organization_merge(self, source, target, token, writes):
        from ..services.organization_merge import build_merge
        from fastapi import HTTPException
        if build_merge(self, source, target)[0]["preview_token"] != token:
            raise HTTPException(409, "merge preview expired; preview again")
        updated = copy.deepcopy(self.db)
        for col, doc_id, doc in writes:
            updated[col][doc_id] = copy.deepcopy(doc)
        self.db = updated
