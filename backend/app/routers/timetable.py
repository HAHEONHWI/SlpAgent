"""Weekly timetable (고정 시간표): the recurring grid clinics keep on paper, rows = time slot x teacher,
columns = weekday. Slots follow the rotation session + consultation (e.g. 40 + 10 = 50 minutes). Entries can be
turned into dated schedules for a range of days, which is what attendance is marked against."""
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from ..auth import Principal, current_principal, require_admin, require_write
from ..deps import audit, child_or_404, get_repo
from ..repo.base import NotFound

router = APIRouter(prefix="/timetable", tags=["timetable"])
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class Teacher(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")
    name: str = Field(min_length=1, max_length=20)
    short: str = Field(min_length=1, max_length=4)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class TimetableConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_minutes: int = Field(default=40, ge=10, le=180)
    break_minutes: int = Field(default=10, ge=0, le=60, description="consultation / turnover after each session")
    morning_start: str = Field(default="09:00", pattern=HHMM)
    morning_count: int = Field(default=4, ge=0, le=12)
    afternoon_start: str = Field(default="14:00", pattern=HHMM)
    afternoon_count: int = Field(default=7, ge=0, le=14)
    days: list[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5, 6], max_length=7)
    teachers: list[Teacher] = Field(default_factory=list, max_length=20)
    closed: list[str] = Field(default_factory=list, max_length=3000,
                              description='closed cells: "day|HH:MM|teacher_id", or "day|HH:MM|*" for the whole slot')

    @model_validator(mode="after")
    def _check(self):
        if any(d < 1 or d > 7 for d in self.days):
            raise ValueError("days are ISO weekdays 1 (Mon) to 7 (Sun)")
        if len({t.id for t in self.teachers}) != len(self.teachers):
            raise ValueError("teacher ids must be unique")
        self.days = sorted(set(self.days))
        return self


def _add(hhmm: str, minutes: int) -> str:
    return (datetime.strptime(hhmm, "%H:%M") + timedelta(minutes=minutes)).strftime("%H:%M")


def slots(cfg: TimetableConfig) -> tuple[list[str], list[str]]:
    step = cfg.session_minutes + cfg.break_minutes
    seq = lambda start, n: [_add(start, i * step) for i in range(n)]
    am, pm = seq(cfg.morning_start, cfg.morning_count), seq(cfg.afternoon_start, cfg.afternoon_count)
    if am and pm and _add(am[-1], cfg.session_minutes) > pm[0]:
        raise HTTPException(422, "오전 마지막 수업이 오후 시작 시간과 겹칩니다")
    if any(_add(s, cfg.session_minutes) < s for s in am + pm):
        raise HTTPException(422, "수업이 자정을 넘깁니다")
    return am, pm


def _config(repo, org_id: str) -> TimetableConfig:
    try:
        doc = repo.get("timetable_config", org_id, "default")
    except NotFound:
        return TimetableConfig()
    return TimetableConfig(**{k: v for k, v in doc.items() if k in TimetableConfig.model_fields})


class EntryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day: int = Field(ge=1, le=7)
    slot: str = Field(pattern=HHMM)
    teacher_id: str
    child_id: str | None = None
    label: str | None = Field(default=None, max_length=30, description="name shown when no registered child is linked")
    note: str | None = Field(default=None, max_length=60)
    highlight: bool = False
    valid_from: date | None = None
    valid_to: date | None = None

    @model_validator(mode="after")
    def _check(self):
        if not self.child_id and not (self.label or "").strip():
            raise ValueError("choose a child or enter a name")
        if self.valid_from and self.valid_to and self.valid_from > self.valid_to:
            raise ValueError("valid_from must not be after valid_to")
        return self


def _periods_overlap(a: dict, b: dict) -> bool:
    lo = max(a.get("valid_from") or "0000", b.get("valid_from") or "0000")
    hi = min(a.get("valid_to") or "9999", b.get("valid_to") or "9999")
    return lo <= hi


def _is_closed(cfg: TimetableConfig, day: int, slot: str, teacher_id: str) -> bool:
    return f"{day}|{slot}|*" in cfg.closed or f"{day}|{slot}|{teacher_id}" in cfg.closed


def _validate_entry(repo, p: Principal, body: EntryIn, entry_id: str | None) -> dict:
    cfg = _config(repo, p.org_id)
    am, pm = slots(cfg)
    if body.day not in cfg.days:
        raise HTTPException(422, "운영하지 않는 요일입니다")
    if body.slot not in am + pm:
        raise HTTPException(422, "시간표에 없는 시간입니다")
    if body.teacher_id not in {t.id for t in cfg.teachers}:
        raise HTTPException(422, "등록되지 않은 담당 교사입니다")
    if _is_closed(cfg, body.day, body.slot, body.teacher_id):
        raise HTTPException(409, "닫아 둔 칸입니다")
    if body.child_id:
        child_or_404(repo, p, body.child_id)
    d = body.model_dump(mode="json")
    d["label"] = (d["label"] or "").strip() or None
    for e in repo.list("timetable_entries", p.org_id):
        if e["id"] == entry_id or e["day"] != body.day or e["slot"] != body.slot or not _periods_overlap(e, d):
            continue
        if e["teacher_id"] == body.teacher_id:
            raise HTTPException(409, "이 칸에는 같은 기간에 이미 다른 아동이 있습니다. 기간(시작·종료일)을 나눠 주세요")
        if body.child_id and e.get("child_id") == body.child_id:
            raise HTTPException(409, "같은 아동이 같은 시간에 다른 교사 수업에 이미 있습니다")
    return d


@router.get("")
def get_timetable(p: Principal = Depends(current_principal), repo=Depends(get_repo)):
    cfg = _config(repo, p.org_id)
    am, pm = slots(cfg)
    gone = {c["id"] for c in repo.list("children", p.org_id) if c.get("archived")}
    entries = sorted([e for e in repo.list("timetable_entries", p.org_id) if e.get("child_id") not in gone], key=lambda e: (e["slot"], e["day"], e.get("valid_from") or ""))
    return {"config": cfg.model_dump(), "morning": am, "afternoon": pm, "entries": entries}


@router.put("/config")
def put_config(body: TimetableConfig, p: Principal = Depends(require_admin), repo=Depends(get_repo)):
    slots(body)  # reject impossible layouts before saving
    data = body.model_dump()
    try:
        repo.update("timetable_config", p.org_id, "default", data)
    except NotFound:
        repo.create("timetable_config", p.org_id, data, doc_id="default")
    audit(repo, p, "update", "timetable_config", "default")
    return get_timetable(p, repo)


@router.post("/entries", status_code=201)
def create_entry(body: EntryIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    doc = repo.create("timetable_entries", p.org_id, _validate_entry(repo, p, body, None))
    audit(repo, p, "create", "timetable_entries", doc["id"], body.child_id)
    return doc


def _entry(repo, p: Principal, eid: str) -> dict:
    try:
        return repo.get("timetable_entries", p.org_id, eid)
    except NotFound:
        raise HTTPException(404, "entry not found")


@router.put("/entries/{eid}")
def update_entry(eid: str, body: EntryIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    _entry(repo, p, eid)
    doc = repo.update("timetable_entries", p.org_id, eid, _validate_entry(repo, p, body, eid))
    audit(repo, p, "update", "timetable_entries", eid, body.child_id)
    return doc


@router.delete("/entries/{eid}", status_code=204)
def delete_entry(eid: str, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    e = _entry(repo, p, eid)
    repo.delete("timetable_entries", p.org_id, eid)
    audit(repo, p, "delete", "timetable_entries", eid, e.get("child_id"))


class GenerateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: date
    end: date

    @model_validator(mode="after")
    def _check(self):
        if self.end < self.start or (self.end - self.start).days > 62:
            raise ValueError("choose a range of at most 63 days")
        return self


@router.post("/generate")
def generate(body: GenerateIn, p: Principal = Depends(require_write), repo=Depends(get_repo)):
    """Create dated schedules from the timetable. Idempotent: an entry never makes two schedules for one day,
    and a schedule someone cancelled is not recreated. Conflicts with existing schedules are skipped and reported."""
    cfg = _config(repo, p.org_id)
    am, pm = slots(cfg)
    names = {t.id: t.name for t in cfg.teachers}
    gone = {c["id"] for c in repo.list("children", p.org_id) if c.get("archived")}
    entries = [e for e in repo.list("timetable_entries", p.org_id) if e.get("child_id") not in gone]
    existing = [s for s in repo.list("schedules", p.org_id) if body.start.isoformat() <= s["date"] <= body.end.isoformat()]
    made = {(s.get("timetable_entry_id"), s["date"]) for s in existing if s.get("timetable_entry_id")}
    created, skipped, unlinked = 0, [], 0
    day = body.start
    while day <= body.end:
        iso = day.isoformat()
        for e in entries:
            if e["day"] != day.isoweekday() or not (e.get("valid_from") or "0000") <= iso <= (e.get("valid_to") or "9999"):
                continue
            if e["slot"] not in am + pm or e["teacher_id"] not in names or _is_closed(cfg, e["day"], e["slot"], e["teacher_id"]):
                continue
            if not e.get("child_id"):
                unlinked += 1
                continue
            if (e["id"], iso) in made:
                continue
            new = {"child_id": e["child_id"], "date": iso, "start": e["slot"], "end": _add(e["slot"], cfg.session_minutes),
                   "therapist": names[e["teacher_id"]], "note": e.get("note"), "timetable_entry_id": e["id"]}
            clash = next((s for s in existing if s["date"] == iso and s.get("status") == "scheduled"
                          and s["start"] < new["end"] and new["start"] < s["end"]
                          and (s["therapist"] == new["therapist"] or s["child_id"] == new["child_id"])), None)
            if clash:
                skipped.append({"date": iso, "slot": e["slot"], "child_id": e["child_id"],
                                "reason": f"기존 일정과 겹침 ({clash['start']}–{clash['end']} {clash['therapist']})"})
                continue
            doc = repo.create("schedules", p.org_id, {**new, "status": "scheduled"})
            existing.append(doc)
            made.add((e["id"], iso))
            created += 1
        day += timedelta(days=1)
    audit(repo, p, "generate", "schedules", f"{body.start}..{body.end}")
    return {"created": created, "skipped": skipped, "unlinked": unlinked}
