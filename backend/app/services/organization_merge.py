import hashlib
import json
from collections import Counter
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from ..repo.base import NotFound, now_iso


class MergeIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    target_org_id: str = Field(min_length=1, max_length=200)
    preview_token: str | None = None
    confirmation: str | None = None


def build_merge(repo, source: str, target: str):
    if source == target or source.startswith("_") or target.startswith("_"):
        raise HTTPException(422, "choose two distinct organizations")
    try:
        source_org = repo.get("organizations", source, source)
        target_org = repo.get("organizations", target, target)
        source_registry = repo.get("organization_registry", "_platform", source)
        target_registry = repo.get("organization_registry", "_platform", target)
    except NotFound:
        raise HTTPException(404, "organization not found")
    if source_org.get("status", "active") != "active" or target_org.get("status", "active") != "active":
        raise HTTPException(409, "organization is not active")
    docs = repo.organization_documents(source)
    members = [doc for col, doc in docs if col == "users"]
    # "org_id" is a document field here, not the repo scope argument, so filter explicitly
    access = [a for a in repo.list("account_access", "_platform") if a.get("org_id") == source]
    member_ids = {doc["uid"] for doc in members}
    if any(doc["id"] not in member_ids for doc in access):
        raise HTTPException(409, "account membership needs reconciliation before merge")
    signups = [r for r in repo.list("signup_requests", "_platform") if r.get("org_id") == source]
    revision = [(col, d["id"], d.get("updated_at")) for col, d in docs]
    revision += [("access", d["id"], d.get("updated_at")) for d in access]
    revision += [("signup", d["id"], d.get("updated_at")) for d in signups]
    revision += [("target", target, target_org.get("updated_at")),
                 ("source_registry", source, source_registry.get("updated_at")),
                 ("target_registry", target, target_registry.get("updated_at"))]
    token = hashlib.sha256(json.dumps(sorted(revision), ensure_ascii=False).encode()).hexdigest()
    count = sum(col != "organizations" for col, _ in docs) + len(members) + len(signups) + 3
    if count > 450:
        raise HTTPException(409, "merge exceeds 450 atomic writes; use a supervised migration")
    public = {"source_org_id": source, "source_name": source_org.get("name", source),
              "target_org_id": target, "target_name": target_org.get("name", target),
              "counts": dict(Counter(col for col, _ in docs if col != "organizations")),
              "preview_token": token, "licenses": target_org.get("licensed_assessments", [])}
    return public, docs, members, signups


def merge_organizations(repo, source: str, body: MergeIn, actor: str):
    preview, docs, members, signups = build_merge(repo, source, body.target_org_id)
    if body.preview_token != preview["preview_token"]:
        raise HTTPException(409, "merge preview expired; preview again")
    if body.confirmation != source:
        raise HTTPException(422, "confirmation must match source organization ID")
    target = body.target_org_id
    timestamp = now_iso()
    writes = [(col, doc["id"], {**doc, "organization_id": target, "updated_at": timestamp})
              for col, doc in docs if col != "organizations"]
    for member in members:
        writes.append(("account_access", member["uid"], {"id": member["uid"], "organization_id": "_platform",
                       "org_id": target, "role": member["role"], "updated_at": timestamp}))
    for signup in signups:
        writes.append(("signup_requests", signup["id"], {**signup, "org_id": target,
                       "org_name": preview["target_name"], "updated_at": timestamp}))
    org = repo.get("organizations", source, source)
    registry = repo.get("organization_registry", "_platform", source)
    writes.extend([
        ("organizations", source, {**org, "status": "merged", "merged_into": target, "updated_at": timestamp}),
        ("organization_registry", source, {**registry, "status": "merged", "merged_into": target, "updated_at": timestamp}),
        ("audit_logs", "merge_" + preview["preview_token"], {"id": "merge_" + preview["preview_token"],
         "organization_id": "_platform", "actor": actor, "role": "site_admin", "action": "merge_organizations",
         "collection": "organizations", "doc_id": source, "target_org_id": target,
         "counts": preview["counts"], "created_at": timestamp, "updated_at": timestamp}),
    ])
    repo.commit_organization_merge(source, target, preview["preview_token"], writes)
    return {**preview, "status": "merged"}
