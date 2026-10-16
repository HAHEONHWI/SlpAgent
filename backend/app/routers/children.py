from typing import Literal
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from ..auth import Principal, current_principal, require_admin, require_write
from ..config import get_settings
from ..deps import audit, child_or_404, child_scope, get_repo
from ..services.child_purge import purge_child
from .org import ensure_in_roster
from .timetable import touch_timetable

router = APIRouter(prefix="/children", tags=["children"])


class ChildIn(BaseModel):
    alias: str = Field(min_length=1, max_length=40, description="가명/내부 코드. AI에는 이것만 전달")
    display_name: str = Field(min_length=1, max_length=40)
    birth_date: date
    sex: str | None = None
    guardian_contact: str | None = None
    notes: str | None = None
    therapist: str | None = Field(default=None, max_length=20, description="담당(지정제공인력)")
    voucher_grade: Literal["가", "나", "다", "라", "마"] | None = Field(default=None, description="발달재활 바우처 등급. None = 바우처 없음(유료)")
    disability_registered: bool | None = Field(default=None, description="장애등록 여부 (Y/N). None = 미입력")


def age_months(birth: str, on: date | None = None) -> int:
    b, d = date.fromisoformat(birth), on or date.today()
    return (d.year - b.year) * 12 + d.month - b.month - (1 if d.day < b.day else 0)


@router.post("", status_code=201)
def create_child(body: ChildIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    doc = repo.create("children", p.org_id, {**body.model_dump(mode="json"), "archived": False})
    audit(repo, p, "create", "children", doc["id"], doc["id"])
    ensure_in_roster(repo, p.org_id, [body.therapist])
    return doc


class ImportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[ChildIn] = Field(min_length=1, max_length=500)
    overwrite: bool = Field(default=False, description="update children already registered (same name and birth date) from the file")


IMPORT_FIELDS = ("alias", "therapist", "voucher_grade", "sex", "disability_registered")  # a blank cell keeps what is there


@router.post("/import")
def import_children(body: ImportIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    """Bulk registration from a spreadsheet. Rows that match an existing child (same code, or same name and
    birth date) are skipped, so re-uploading the same file is harmless. Only birth date and sex arrive here:
    the client derives them from 주민번호 앞자리와 성별 자리 and never sends the number itself."""
    existing = repo.list("children", p.org_id)
    code_of = {c["alias"].strip().lower(): c["id"] for c in existing}
    person = {(c["display_name"].strip(), c["birth_date"]): c for c in existing}
    scope = child_scope(repo, p)  # a therapist overwrites only their own children
    created, updated, skipped = [], [], []
    for i, row in enumerate(body.rows):
        d = {**row.model_dump(mode="json"), "archived": False}
        d["alias"], d["display_name"] = d["alias"].strip(), d["display_name"].strip()
        who = (d["display_name"], d["birth_date"])
        same = person.get(who)
        owner = code_of.get(d["alias"].lower())
        if same and body.overwrite and not same.get("archived") and (scope is None or same["id"] in scope):
            if owner and owner != same["id"]:
                skipped.append({"row": i, "alias": d["alias"], "display_name": d["display_name"], "reason": "아이코드 중복"})
                continue
            change = {k: d[k] for k in IMPORT_FIELDS if d.get(k) not in (None, "") and d[k] != same.get(k)}
            if change:
                code_of.pop(same["alias"].strip().lower(), None)
                same.update(repo.update("children", p.org_id, same["id"], change))
                code_of[same["alias"].strip().lower()] = same["id"]
                audit(repo, p, "update", "children", same["id"], same["id"])
                updated.append(same["id"])
            continue
        if owner or same:
            gone = (same or {}).get("archived") or any(c.get("archived") and c["id"] == owner for c in existing)
            skipped.append({"row": i, "alias": d["alias"], "display_name": d["display_name"],
                            "reason": "삭제된 아동에 있음" if gone else "이미 등록됨" if same else "아이코드 중복"})
            continue
        doc = repo.create("children", p.org_id, d)
        code_of[d["alias"].lower()] = doc["id"]
        person[who] = doc
        created.append(doc["id"])
    audit(repo, p, "import", "children", f"{len(created)} rows")
    ensure_in_roster(repo, p.org_id, [r.therapist for r in body.rows])
    return {"created": len(created), "updated": len(updated), "skipped": skipped}


@router.get("")
def list_children(p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    # age_months is derived on read (never stored) so it is always current
    scope = child_scope(repo, p)
    return [{**c, "age_months": age_months(c["birth_date"])} for c in repo.list("children", p.org_id)
            if not c.get("archived") and (scope is None or c["id"] in scope)]


@router.get("/archived")
def list_archived(p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    """삭제된 아동 (trash): restorable until an admin deletes them permanently."""
    scope = child_scope(repo, p)
    rows = [c for c in repo.list("children", p.org_id) if c.get("archived") and (scope is None or c["id"] in scope)]
    return sorted(rows, key=lambda c: c.get("archived_at") or "", reverse=True)


@router.get("/{child_id}")
def get_child(child_id: str, p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    c = child_or_404(repo, p, child_id)
    audit(repo, p, "read", "children", child_id, child_id)
    return {**c, "age_months": age_months(c["birth_date"])}


class TherapistIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    therapist: str | None = Field(default=None, max_length=20)


@router.put("/{child_id}/therapist")
def set_therapist(child_id: str, body: TherapistIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child_or_404(repo, p, child_id)
    audit(repo, p, "update", "children", child_id, child_id)
    ensure_in_roster(repo, p.org_id, [body.therapist])
    return repo.update("children", p.org_id, child_id, {"therapist": (body.therapist or "").strip() or None})


class VoucherGradeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    voucher_grade: Literal["가", "나", "다", "라", "마"] | None = Field(default=None, description="발달재활 바우처 유형. None = 바우처 없음(유료)")


@router.put("/{child_id}/voucher")
def set_voucher_grade(child_id: str, body: VoucherGradeIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child_or_404(repo, p, child_id)
    audit(repo, p, "update", "children", child_id, child_id)
    return repo.update("children", p.org_id, child_id, {"voucher_grade": body.voucher_grade})


class DisabilityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    disability_registered: bool | None = None


@router.put("/{child_id}/disability")
def set_disability(child_id: str, body: DisabilityIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child_or_404(repo, p, child_id)
    audit(repo, p, "update", "children", child_id, child_id)
    return repo.update("children", p.org_id, child_id, {"disability_registered": body.disability_registered})


@router.post("/{child_id}/archive")
def archive(child_id: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child = child_or_404(repo, p, child_id)
    if child.get("archived"):
        return child
    audit(repo, p, "archive", "children", child_id, child_id)
    today = date.today().isoformat()
    for s in repo.list("schedules", p.org_id, child_id=child_id):  # upcoming sessions no longer happen
        if s.get("status") == "scheduled" and s["date"] >= today:
            repo.update("schedules", p.org_id, s["id"], {"status": "cancelled", "cancel_reason": "child archived"})
    doc = repo.update("children", p.org_id, child_id,
                      {"archived": True, "archived_at": datetime.now(timezone.utc).isoformat()})
    touch_timetable(repo, p.org_id)
    return doc


@router.post("/{child_id}/restore")
def restore(child_id: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child = child_or_404(repo, p, child_id)
    if not child.get("archived"):
        return child
    audit(repo, p, "restore", "children", child_id, child_id)
    doc = repo.update("children", p.org_id, child_id, {"archived": False, "archived_at": None})
    touch_timetable(repo, p.org_id)  # the child's timetable classes come back
    return doc


class PurgeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm_name: str = Field(description="the child's display name, typed by the admin")


@router.post("/{child_id}/purge")
def purge(child_id: str, body: PurgeIn, p: Principal = Depends(require_admin), repo=Depends(get_repo)):
    """영구 삭제: only for a child already in the trash, and only by an organization admin."""
    child = child_or_404(repo, p, child_id)
    if not child.get("archived"):
        raise HTTPException(409, "삭제(보관)한 아동만 영구 삭제할 수 있습니다")
    if body.confirm_name.strip() != child.get("display_name", "").strip():
        raise HTTPException(422, "아동 이름이 일치하지 않습니다")
    purge_child(repo, p.org_id, child_id, p.uid, p.role, get_settings())
    return {"id": child_id, "purged": True}
