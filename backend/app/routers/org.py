from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from ..auth import Principal, current_principal
from ..deps import audit, get_repo
from ..repo.base import NotFound

router = APIRouter(prefix="/org", tags=["organization"])


class Scale(BaseModel):
    min: int
    max: int
    labels: dict[int, str] = {}  # 기관이 정의한 강도 기준 설명

    @model_validator(mode="after")
    def _ok(self):
        if self.min >= self.max:
            raise ValueError("min must be less than max")
        return self


class OrgSettings(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    behavior_scale: Scale | None = None
    unit_price: int | None = Field(default=None, ge=0, description="회기당 금액(원). 미설정 시 금액 계산 안 함")
    voucher_minutes: int | None = Field(default=None, ge=0)


@router.get("")
def get_org(p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    try:
        return repo.get("organizations", p.org_id, p.org_id)
    except NotFound:
        return {"id": p.org_id, "name": "", "behavior_scale": None, "unit_price": None, "voucher_minutes": None}


@router.put("")
def put_org(body: OrgSettings, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    if p.role != "admin":
        raise HTTPException(403, "admin only")
    data = body.model_dump(mode="json")
    try:
        repo.get("organizations", p.org_id, p.org_id)
        doc = repo.update("organizations", p.org_id, p.org_id, data)
    except NotFound:
        doc = repo.create("organizations", p.org_id, data, doc_id=p.org_id)
    audit(repo, p, "update", "organizations", p.org_id)
    return doc


class RosterEntry(BaseModel):
    id: str | None = Field(default=None, max_length=40)
    name: str = Field(min_length=1, max_length=20)
    uid: str | None = Field(default=None, max_length=128, description="the member account this therapist signs in with")


class RosterIn(BaseModel):
    therapists: list[RosterEntry] = Field(default_factory=list, max_length=50)


def _org_doc(repo, org_id: str) -> dict:
    try:
        return repo.get("organizations", org_id, org_id)
    except NotFound:
        return {}


def roster(repo, org_id: str) -> list[dict]:
    return _org_doc(repo, org_id).get("therapists") or []


def _name_suggestions(repo, org_id: str) -> list[str]:
    """Names already in use before a roster exists: accounts, timetable teachers and children's 담당."""
    names = {u.get("name", "").strip() for u in repo.list("users", org_id) if u.get("role") in ("admin", "therapist")}
    try:
        names |= {t["name"].strip() for t in repo.get("timetable_config", org_id, "default").get("teachers", [])}
    except NotFound:
        pass
    names |= {(c.get("therapist") or "").strip() for c in repo.list("children", org_id)}
    return sorted(n for n in names if n)


@router.get("/roster")
def get_roster(p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    """치료사 목록 with the linked account. Members (to link) are listed for admins only."""
    members = repo.list("users", p.org_id)
    emails = {u["uid"]: u.get("email") for u in members}
    rows = [{**t, "email": emails.get(t.get("uid"))} for t in roster(repo, p.org_id)]
    out = {"therapists": rows, "suggestions": _name_suggestions(repo, p.org_id) if not rows else []}
    if p.role == "admin":
        out["members"] = sorted(({"uid": u["uid"], "email": u.get("email"), "name": u.get("name"), "role": u.get("role")}
                                 for u in members), key=lambda u: (u["name"] or "", u["email"] or ""))
    return out


@router.put("/roster")
def put_roster(body: RosterIn, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    if p.role != "admin":
        raise HTTPException(403, "admin only")
    names = [t.name.strip() for t in body.therapists]
    if len(set(names)) != len(names):
        raise HTTPException(422, "같은 이름의 치료사가 두 번 있습니다")
    member_uids = {u["uid"] for u in repo.list("users", p.org_id)}
    uids = [t.uid for t in body.therapists if t.uid]
    if len(set(uids)) != len(uids):
        raise HTTPException(422, "한 계정을 두 치료사에 연결할 수 없습니다")
    if any(u not in member_uids for u in uids):
        raise HTTPException(422, "이 기관의 계정이 아닙니다")
    old = {t["id"]: t["name"] for t in roster(repo, p.org_id) if t.get("id")}
    import uuid
    new = [{"id": t.id if t.id in old else uuid.uuid4().hex[:12], "name": t.name.strip(), "uid": t.uid} for t in body.therapists]
    # renamed therapists: children's 담당 and the timetable's teacher names follow the new name
    renames = {old[t["id"]]: t["name"] for t in new if t["id"] in old and old[t["id"]] != t["name"]}
    if renames:
        for c in repo.list("children", p.org_id):
            if c.get("therapist") in renames:
                repo.update("children", p.org_id, c["id"], {"therapist": renames[c["therapist"]]})
        try:
            cfg = repo.get("timetable_config", p.org_id, "default")
            teachers = [{**t, "name": renames.get(t["name"], t["name"])} for t in cfg.get("teachers", [])]
            repo.update("timetable_config", p.org_id, "default", {"teachers": teachers})
        except NotFound:
            pass
    if _org_doc(repo, p.org_id):
        repo.update("organizations", p.org_id, p.org_id, {"therapists": new})
    else:
        repo.create("organizations", p.org_id, {"name": "", "therapists": new}, doc_id=p.org_id)
    audit(repo, p, "update", "organizations", p.org_id)
    return get_roster(p, repo)


@router.get("/therapists")
def therapists(p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    """Names a child's 담당 치료사 can be chosen from: the 치료사 목록 once it is set, before that the names in use."""
    names = [t["name"] for t in roster(repo, p.org_id)]
    return names or _name_suggestions(repo, p.org_id)
