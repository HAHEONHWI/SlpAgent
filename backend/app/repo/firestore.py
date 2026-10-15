import uuid
from typing import Any
from .base import NotFound, now_iso


class FirestoreRepo:
    def __init__(self):
        import firebase_admin
        from firebase_admin import firestore
        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        self.c = firestore.client()

    def create(self, col, org_id, data, doc_id=None):
        doc_id = doc_id or uuid.uuid4().hex
        doc = {**data, "id": doc_id, "organization_id": org_id, "created_at": now_iso(), "updated_at": now_iso()}
        self.c.collection(col).document(doc_id).set(doc)
        return doc

    def get(self, col, org_id, doc_id):
        snap = self.c.collection(col).document(doc_id).get()
        if not snap.exists or snap.to_dict().get("organization_id") != org_id:
            raise NotFound(doc_id)
        return snap.to_dict()

    def list(self, col, org_id, **eq: Any):
        q = self.c.collection(col).where("organization_id", "==", org_id)
        for k, v in eq.items():
            q = q.where(k, "==", v)
        return [s.to_dict() for s in q.stream()]

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

    def update(self, col, org_id, doc_id, patch):
        self.get(col, org_id, doc_id)
        patch = {k: v for k, v in patch.items() if k not in ("id", "organization_id")}
        patch["updated_at"] = now_iso()
        self.c.collection(col).document(doc_id).update(patch)
        return self.get(col, org_id, doc_id)

    def delete(self, col, org_id, doc_id):
        self.get(col, org_id, doc_id)
        self.c.collection(col).document(doc_id).delete()

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

        apply(self.c.transaction())
