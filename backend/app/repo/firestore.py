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

    def update(self, col, org_id, doc_id, patch):
        self.get(col, org_id, doc_id)
        patch = {k: v for k, v in patch.items() if k not in ("id", "organization_id")}
        patch["updated_at"] = now_iso()
        self.c.collection(col).document(doc_id).update(patch)
        return self.get(col, org_id, doc_id)

    def delete(self, col, org_id, doc_id):
        self.get(col, org_id, doc_id)
        self.c.collection(col).document(doc_id).delete()
