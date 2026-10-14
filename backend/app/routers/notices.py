"""공지사항: 기관 공지 (written by an organization admin, read by its members) and 사이트 공지 (written by a site admin,
read by everyone). Bodies are plain text; the client shows them as text, never as HTML."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from ..auth import Identity, Principal, current_principal, require_admin, require_site_admin
from ..deps import audit, get_repo
from ..repo.base import NotFound
from ..services.accounts import PLATFORM

router = APIRouter(tags=["notices"])


class NoticeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=100, pattern=r"\S")
    body: str = Field(min_length=1, max_length=5000, pattern=r"\S")
    pinned: bool = False


def _author(repo, org_id: str | None, uid: str) -> str | None:
    if not org_id:
        return None
    try:
        return repo.get("users", org_id, uid).get("name")
    except NotFound:
        return None


def _sorted(rows: list[dict]) -> list[dict]:
    """Pinned first, newest first within each group (two stable sorts)."""
    newest = sorted(rows, key=lambda n: n.get("created_at") or "", reverse=True)
    return sorted(newest, key=lambda n: not n.get("pinned"))


def _out(n: dict, scope: str) -> dict:
    return {k: n.get(k) for k in ("id", "title", "body", "pinned", "created_at", "updated_at", "author_name")} | {"scope": scope}


@router.get("/notices")
def list_notices(p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    """Site notices and this organization's notices, pinned first then newest."""
    site = [_out(n, "site") for n in repo.list("notices", PLATFORM)]
    org = [_out(n, "org") for n in repo.list("notices", p.org_id)]
    return _sorted(site + org)


def _org_notice(repo, org_id: str, nid: str) -> dict:
    try:
        return repo.get("notices", org_id, nid)
    except NotFound:
        raise HTTPException(404, "notice not found")


@router.post("/notices", status_code=201)
def create_notice(body: NoticeIn, p: Principal = Depends(require_admin), repo=Depends(get_repo)):
    doc = repo.create("notices", p.org_id, {**body.model_dump(), "author_uid": p.uid,
                                            "author_name": _author(repo, p.org_id, p.uid)})
    audit(repo, p, "create", "notices", doc["id"])
    return _out(doc, "org")


@router.put("/notices/{nid}")
def update_notice(nid: str, body: NoticeIn, p: Principal = Depends(require_admin), repo=Depends(get_repo)):
    _org_notice(repo, p.org_id, nid)
    audit(repo, p, "update", "notices", nid)
    return _out(repo.update("notices", p.org_id, nid, body.model_dump()), "org")


@router.delete("/notices/{nid}", status_code=204)
def delete_notice(nid: str, p: Principal = Depends(require_admin), repo=Depends(get_repo)):
    _org_notice(repo, p.org_id, nid)
    repo.delete("notices", p.org_id, nid)
    audit(repo, p, "delete", "notices", nid)


# ---- site notices (site admin) ----------------------------------------------------------------------

def _site_audit(repo, admin: Identity, action: str, nid: str):
    repo.create("audit_logs", PLATFORM, {"actor": admin.uid, "role": "site_admin", "action": action,
                                         "collection": "notices", "doc_id": nid})


@router.get("/platform/notices")
def list_site_notices(admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    return _sorted([_out(n, "site") for n in repo.list("notices", PLATFORM)])


@router.post("/platform/notices", status_code=201)
def create_site_notice(body: NoticeIn, admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    doc = repo.create("notices", PLATFORM, {**body.model_dump(), "author_uid": admin.uid, "author_name": "사이트 관리자"})
    _site_audit(repo, admin, "create_notice", doc["id"])
    return _out(doc, "site")


def _site_notice(repo, nid: str) -> dict:
    try:
        return repo.get("notices", PLATFORM, nid)
    except NotFound:
        raise HTTPException(404, "notice not found")


@router.put("/platform/notices/{nid}")
def update_site_notice(nid: str, body: NoticeIn, admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    _site_notice(repo, nid)
    _site_audit(repo, admin, "update_notice", nid)
    return _out(repo.update("notices", PLATFORM, nid, body.model_dump()), "site")


@router.delete("/platform/notices/{nid}", status_code=204)
def delete_site_notice(nid: str, admin: Identity = Depends(require_site_admin), repo=Depends(get_repo)):
    _site_notice(repo, nid)
    repo.delete("notices", PLATFORM, nid)
    _site_audit(repo, admin, "delete_notice", nid)
