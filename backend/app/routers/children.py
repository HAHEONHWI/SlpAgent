import re
import uuid
from typing import Literal
from datetime import date, datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from ..auth import Principal, current_principal, require_admin, require_write
from ..config import get_settings
from ..deps import audit, audit_change, child_or_404, child_scope, get_repo
from ..repo.base import NotFound, RevisionConflict, VersionedChange
from ..services.child_codes import counter_id
from ..services.child_purge import purge_child
from .org import ensure_in_roster
from .timetable import touch_timetable

router = APIRouter(prefix="/children", tags=["children"])


class ChildIn(BaseModel):
    alias: str | None = Field(default=None, min_length=1, max_length=40, description="가명/내부 코드. AI에는 이것만 전달")
    display_name: str = Field(min_length=1, max_length=40)
    birth_date: date
    sex: str | None = None
    guardian_contact: str | None = None
    notes: str | None = None
    therapist: str | None = Field(default=None, max_length=20, description="담당(지정제공인력)")
    voucher_grade: Literal["가", "나", "다", "라", "마"] | None = Field(default=None, description="발달재활 바우처 등급. None = 지원금·본인부담금 계산 보류; 수업 구분은 일정에서 지정")
    disability_registered: bool | None = Field(default=None, description="장애등록 여부 (Y/N). None = 미입력")

    def record(self):
        data = self.model_dump(mode="json")
        if self.voucher_grade:
            data["disability_registered"] = True
        return data


def age_months(birth: str, on: date | None = None) -> int:
    b, d = date.fromisoformat(birth), on or date.today()
    return (d.year - b.year) * 12 + d.month - b.month - (1 if d.day < b.day else 0)


def _therapist_code_prefix(repo, org_id: str, therapist: str) -> str | None:
    try:
        org = repo.get("organizations", org_id, org_id)
    except NotFound:
        return None
    return next((t.get("code_prefix") for t in (org.get("therapists") or [])
                 if (t.get("name") or "").strip() == therapist), None)


def _existing_code_numbers(repo, org_id: str, prefix: str) -> set[int]:
    # shortcut: scan aliases only when counter has no history; use indexed prefix lookup if organization size makes this expensive.
    pattern = re.compile(rf"{re.escape(prefix)}-(\d{{2}})$", re.IGNORECASE)
    return {int(match.group(1)) for child in repo.list("children", org_id)
            if (match := pattern.fullmatch(str(child.get("alias") or "")))}


def _next_child_code(repo, org_id: str, prefix: str) -> tuple[str | None, dict | None, int, set[int]]:
    try:
        counter = repo.get("child_code_counters", org_id, counter_id(org_id, prefix))
    except NotFound:
        counter = None
    used = ({n for n in (counter or {}).get("used_numbers", []) if isinstance(n, int)}
            if counter and "used_numbers" in counter else _existing_code_numbers(repo, org_id, prefix))
    number = max((counter or {}).get("next_number", 1), max(used, default=0) + 1, 1)
    while number <= 99 and number in used:
        number += 1
    return (f"{prefix}-{number:02d}" if number <= 99 else None, counter, number, used)


def _create_coded_child(repo, p: Principal, data: dict, prefix: str) -> dict:
    child_id = uuid.uuid4().hex
    for _ in range(5):
        alias, counter, number, used = _next_child_code(repo, p.org_id, prefix)
        if alias is None:
            raise HTTPException(409, f"{prefix}-01~{prefix}-99 아이 코드를 모두 사용했습니다")
        try:
            return repo.save_versioned("children", p.org_id, child_id,
                                       {**data, "alias": alias, "archived": False}, None,
                                       also=(VersionedChange("child_code_counters", counter_id(p.org_id, prefix),
                                                             counter["updated_at"] if counter else None,
                                                             {"prefix": prefix, "next_number": number + 1,
                                                              "used_numbers": sorted(used | {number})}),
                                             audit_change(p, "create", "children", child_id, child_id)))
        except RevisionConflict:
            continue
    raise HTTPException(409, "아이 코드가 동시에 배정되었습니다. 다시 등록해 주세요")


def _create_manual_child(repo, p: Principal, data: dict, alias: str) -> dict:
    match = re.fullmatch(r"([A-Z])-(\d{2})", alias, re.IGNORECASE)
    if not match:
        doc = repo.create("children", p.org_id, {**data, "alias": alias, "archived": False})
        audit(repo, p, "create", "children", doc["id"], doc["id"])
        return doc
    prefix, number = match.group(1).upper(), int(match.group(2))
    if number == 0:
        raise HTTPException(422, "아이 코드 번호는 01~99 사이여야 합니다")
    child_id = uuid.uuid4().hex
    counter_doc_id = counter_id(p.org_id, prefix)
    for _ in range(5):
        try:
            counter = repo.get("child_code_counters", p.org_id, counter_doc_id)
        except NotFound:
            counter = None
        used = ({n for n in (counter or {}).get("used_numbers", []) if isinstance(n, int)}
                if counter and "used_numbers" in counter else _existing_code_numbers(repo, p.org_id, prefix))
        if number in used:
            raise HTTPException(409, "아이 코드가 이미 사용됐습니다")
        next_number = max((counter or {}).get("next_number", 1), max(used | {number}) + 1)
        try:
            return repo.save_versioned("children", p.org_id, child_id,
                                       {**data, "alias": alias, "archived": False}, None,
                                       also=(VersionedChange("child_code_counters", counter_doc_id,
                                                             counter["updated_at"] if counter else None,
                                                             {"prefix": prefix, "next_number": next_number,
                                                              "used_numbers": sorted(used | {number})}),
                                             audit_change(p, "create", "children", child_id, child_id)))
        except RevisionConflict:
            continue
    raise HTTPException(409, "아이 코드가 동시에 사용됐습니다. 다시 등록해 주세요")


@router.get("/next-code")
def next_child_code(therapist: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    name = therapist.strip()
    if not name:
        raise HTTPException(422, "담당 치료사를 선택하세요")
    prefix = _therapist_code_prefix(repo, p.org_id, name)
    if not prefix:
        return {"code_prefix": None, "alias": None}
    alias, _, _, _ = _next_child_code(repo, p.org_id, prefix)
    if alias is None:
        raise HTTPException(409, f"{prefix}-01~{prefix}-99 아이 코드를 모두 사용했습니다")
    return {"code_prefix": prefix, "alias": alias}


@router.post("", status_code=201)
def create_child(body: ChildIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    data = body.record()
    therapist = (body.therapist or "").strip()
    prefix = _therapist_code_prefix(repo, p.org_id, therapist) if therapist else None
    if prefix:
        doc = _create_coded_child(repo, p, data, prefix)
    else:
        alias = (body.alias or "").strip()
        if not alias:
            raise HTTPException(422, "아이 코드를 입력하거나 담당 치료사의 코드 알파벳을 지정해 주세요")
        doc = _create_manual_child(repo, p, data, alias)
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
    if any(not row.alias or not row.alias.strip() for row in body.rows):
        raise HTTPException(422, "엑셀 등록에는 아이 코드를 입력하세요")
    existing = repo.list("children", p.org_id)
    code_of = {c["alias"].strip().lower(): c["id"] for c in existing}
    person = {(c["display_name"].strip(), c["birth_date"]): c for c in existing}
    scope = child_scope(repo, p)  # a therapist overwrites only their own children
    created, updated, skipped = [], [], []
    for i, row in enumerate(body.rows):
        d = {**row.record(), "archived": False}
        d["alias"], d["display_name"] = d["alias"].strip(), d["display_name"].strip()
        who = (d["display_name"], d["birth_date"])
        same = person.get(who)
        owner = code_of.get(d["alias"].lower())
        if same and body.overwrite and not same.get("archived") and not same.get("terminated_on") and (scope is None or same["id"] in scope):
            if owner and owner != same["id"]:
                skipped.append({"row": i, "alias": d["alias"], "display_name": d["display_name"], "reason": "아이코드 중복"})
                continue
            change = {k: d[k] for k in IMPORT_FIELDS if d.get(k) not in (None, "") and d[k] != same.get(k)}
            if (d.get("voucher_grade") or same.get("voucher_grade")) and change.get("disability_registered", same.get("disability_registered")) is not True:
                change["disability_registered"] = True
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
        if re.fullmatch(r"[A-Z]-\d{2}", d["alias"], re.IGNORECASE):
            try:
                doc = _create_manual_child(repo, p, d, d["alias"])
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise
                skipped.append({"row": i, "alias": d["alias"], "display_name": d["display_name"], "reason": "아이코드 중복"})
                continue
        else:
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
            if not c.get("archived") and not c.get("terminated_on") and (scope is None or c["id"] in scope)]


@router.get("/terminated")
def list_terminated(p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    scope = child_scope(repo, p)
    return sorted(({k: c[k] for k in ("id", "alias", "display_name", "terminated_on")}
                   for c in repo.list("children", p.org_id) if c.get("terminated_on")
                   and not c.get("archived") and (scope is None or c["id"] in scope)),
                  key=lambda c: (c["terminated_on"], c["display_name"]), reverse=True)


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
    voucher_grade: Literal["가", "나", "다", "라", "마"] | None = Field(default=None, description="발달재활 바우처 유형. None = 지원금·본인부담금 계산 보류; 수업 구분은 일정에서 지정")


@router.put("/{child_id}/voucher")
def set_voucher_grade(child_id: str, body: VoucherGradeIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child_or_404(repo, p, child_id)
    audit(repo, p, "update", "children", child_id, child_id)
    return repo.update("children", p.org_id, child_id, {"voucher_grade": body.voucher_grade,
                       **({"disability_registered": True} if body.voucher_grade else {})})


class DisabilityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    disability_registered: bool | None = None


@router.put("/{child_id}/disability")
def set_disability(child_id: str, body: DisabilityIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child = child_or_404(repo, p, child_id)
    if child.get("voucher_grade") and body.disability_registered is not True:
        raise HTTPException(409, "바우처 등급을 해제한 뒤 장애등록 여부를 변경하세요")
    try:
        return repo.save_versioned("children", p.org_id, child_id, {"disability_registered": body.disability_registered},
                                   child["updated_at"], also=(audit_change(p, "update", "children", child_id, child_id),))
    except RevisionConflict:
        raise HTTPException(409, "아동 정보가 변경되었습니다. 다시 확인하세요")


class TerminationIn(BaseModel):
    terminated_on: date = Field(gt=date.min)


@router.post("/{child_id}/terminate")
def terminate(child_id: str, body: TerminationIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    child = child_or_404(repo, p, child_id)
    day = body.terminated_on.isoformat()
    if child.get("archived") or child.get("terminated_on") not in (None, day):
        raise HTTPException(409, "아동 상태 또는 종결일이 변경되었습니다")
    if not child.get("terminated_on"):
        try:
            child = repo.save_versioned("children", p.org_id, child_id, {"terminated_on": day}, child["updated_at"],
                                        also=(audit_change(p, "terminate", "children", child_id, child_id),))
        except RevisionConflict:
            raise HTTPException(409, "아동 정보가 변경되었습니다. 다시 확인하세요")
    # Repeating the same date finishes any cleanup interrupted after the child was saved.
    last = (body.terminated_on - timedelta(days=1)).isoformat()
    for entry in repo.list("timetable_entries", p.org_id, child_id=child_id):
        if not entry.get("valid_to") or entry["valid_to"] >= day:
            patch = {"disabled": True} if (entry.get("valid_from") or "") >= day else {"valid_to": last}
            repo.update("timetable_entries", p.org_id, entry["id"], patch)
    for schedule in repo.list("schedules", p.org_id, child_id=child_id):
        if schedule["date"] >= day and schedule.get("cancel_reason") != "아동 종결":
            repo.update("schedules", p.org_id, schedule["id"],
                        {"status": "cancelled", "cancel_reason": "아동 종결", "closure": None})
    for plan in repo.list("pay_plans", p.org_id, child_id=child_id):
        slots = [slot for slot in plan.get("slots", []) if slot["date"] < day]
        if slots != plan.get("slots", []):
            repo.update("pay_plans", p.org_id, plan["id"], {"slots": slots})
    touch_timetable(repo, p.org_id)
    return child


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
