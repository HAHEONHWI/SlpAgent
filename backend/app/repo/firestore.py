from __future__ import annotations

import copy
import time
import uuid
from typing import Any
from pydantic import JsonValue
from .base import NotFound, now_iso
from .request_cache import clear_request_reads, current_request_reads


class FirestoreRepo:
    def __init__(self):
        import firebase_admin
        from firebase_admin import firestore
        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        self.c = firestore.client()
        self._knowledge_documents_cache = {}

    def _invalidate_knowledge_documents(self, org_id):
        self._knowledge_documents_cache.pop(org_id, None)

    def create(self, col, org_id, data, doc_id=None):
        doc_id = doc_id or uuid.uuid4().hex
        doc = {**data, "id": doc_id, "organization_id": org_id, "created_at": now_iso(), "updated_at": now_iso()}
        clear_request_reads()
        self.c.collection(col).document(doc_id).set(doc)
        if col == "knowledge_documents":
            self._invalidate_knowledge_documents(org_id)
        return doc

    def get(self, col, org_id, doc_id):
        reads = current_request_reads()
        key = (id(self), col, org_id, doc_id)
        snap = reads.documents.get(key) if reads is not None else None
        if snap is None:
            snap = self.c.collection(col).document(doc_id).get()
            if reads is not None:
                reads.documents[key] = snap
        if not snap.exists or snap.to_dict().get("organization_id") != org_id:
            raise NotFound(doc_id)
        return snap.to_dict()

    def list(self, col, org_id, **eq: Any):
        if col == "knowledge_documents" and not eq:
            now = time.monotonic()
            cached = self._knowledge_documents_cache.get(org_id)
            if cached and now - cached[0] < 300:
                return copy.deepcopy(cached[1])
            for key, (loaded_at, _) in list(self._knowledge_documents_cache.items()):
                if now - loaded_at >= 300:
                    self._knowledge_documents_cache.pop(key, None)
            q = self.c.collection(col).where("organization_id", "==", org_id)
            documents = [s.to_dict() for s in q.stream()]
            self._knowledge_documents_cache[org_id] = (now, documents)
            return copy.deepcopy(documents)
        q = self.c.collection(col).where("organization_id", "==", org_id)
        for k, v in eq.items():
            q = q.where(k, "==", v)
        reads = current_request_reads()
        if reads is not None and not eq:
            key = (id(self), col, org_id)
            snapshots = reads.collections.get(key)
            if snapshots is None:
                snapshots = tuple(q.stream())
                reads.collections[key] = snapshots
            return [s.to_dict() for s in snapshots]
        return [s.to_dict() for s in q.stream()]

    def count(self, col: str, org_id: str, **eq: str | bool) -> int:
        """Use Firestore aggregation, which returns a count rather than clinical snapshots."""
        query = self.c.collection(col).where("organization_id", "==", org_id)
        for field, value in eq.items():
            query = query.where(field, "==", value)
        return int(query.count().get()[0][0].value)

    def count_range(self, col: str, org_id: str, field: str, lo: str, hi: str, **eq: str | bool) -> int:
        """Count a bounded range with Firestore's existing composite indexes."""
        query = self.c.collection(col).where("organization_id", "==", org_id)
        for key, value in eq.items():
            query = query.where(key, "==", value)
        return int(query.where(field, ">=", lo).where(field, "<=", hi).count().get()[0][0].value)

    def list_range(self, col, org_id, field, lo, hi, **eq: Any):
        q = self.c.collection(col).where("organization_id", "==", org_id)
        for k, v in eq.items():
            q = q.where(k, "==", v)
        q = q.where(field, ">=", lo).where(field, "<=", hi)  # needs a composite index (organization_id, *eq, field)
        return [s.to_dict() for s in q.stream()]

    def list_latest(self, col, org_id, field, limit, **eq: Any):
        from google.cloud import firestore
        q = self.c.collection(col).where("organization_id", "==", org_id)
        for k, v in eq.items():
            q = q.where(k, "==", v)
        q = q.order_by(field, direction=firestore.Query.DESCENDING).limit(limit)  # composite index (organization_id, *eq, field desc)
        return [s.to_dict() for s in q.stream()]

    def list_earliest(self, col: str, org_id: str, field: str, limit: int, **eq: str) -> list[dict[str, JsonValue]]:
        """Bound oldest-first reads at Firestore rather than loading the full history."""
        q = self.c.collection(col).where("organization_id", "==", org_id)
        for key, value in eq.items():
            q = q.where(key, "==", value)
        return [snapshot.to_dict() for snapshot in q.order_by(field).limit(limit).stream()]

    def update(self, col, org_id, doc_id, patch):
        self.get(col, org_id, doc_id)
        patch = {k: v for k, v in patch.items() if k not in ("id", "organization_id")}
        patch["updated_at"] = now_iso()
        clear_request_reads()
        self.c.collection(col).document(doc_id).update(patch)
        if col == "knowledge_documents":
            self._invalidate_knowledge_documents(org_id)
        return self.get(col, org_id, doc_id)

    def delete(self, col, org_id, doc_id):
        self.get(col, org_id, doc_id)
        clear_request_reads()
        self.c.collection(col).document(doc_id).delete()
        if col == "knowledge_documents":
            self._invalidate_knowledge_documents(org_id)

    def organization_documents(self, org_id):
        return [(col.id, snap.to_dict()) for col in self.c.collections()
                for snap in col.where("organization_id", "==", org_id).stream()]

    def commit_organization_merge(self, source, target, token, writes):
        from google.cloud import firestore
        from ..services.organization_merge import build_merge
        from fastapi import HTTPException

        class TransactionView:
            def get(view, col, org_id, doc_id):
                snap = self.c.collection(col).document(doc_id).get(transaction=view.transaction)
                if not snap.exists or snap.to_dict().get("organization_id") != org_id:
                    raise NotFound(doc_id)
                return snap.to_dict()

            def list(view, col, org_id, **eq):
                query = self.c.collection(col).where("organization_id", "==", org_id)
                for key, value in eq.items():
                    query = query.where(key, "==", value)
                return [snap.to_dict() for snap in query.stream(transaction=view.transaction)]

            def organization_documents(view, org_id):
                return [(col.id, doc) for col in self.c.collections() for doc in view.list(col.id, org_id)]

        @firestore.transactional
        def apply(transaction):
            view = TransactionView()
            view.transaction = transaction
            if build_merge(view, source, target)[0]["preview_token"] != token:
                raise HTTPException(409, "merge preview expired; preview again")
            for col, doc_id, doc in writes:
                transaction.set(self.c.collection(col).document(doc_id), doc)

        clear_request_reads()
        apply(self.c.transaction())
        self._invalidate_knowledge_documents(source)
        self._invalidate_knowledge_documents(target)
