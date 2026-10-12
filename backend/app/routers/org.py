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
