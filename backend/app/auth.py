from typing import Literal
from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel
from .config import get_settings

Role = Literal["admin", "therapist", "assistant"]


class Principal(BaseModel):
    uid: str
    org_id: str
    role: Role

    @property
    def can_write(self) -> bool:
        return self.role in ("admin", "therapist")

    @property
    def can_approve(self) -> bool:
        return self.role in ("admin", "therapist")


def _verify_firebase(token: str) -> Principal:
    import firebase_admin
    from firebase_admin import auth

    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    try:
        claims = auth.verify_id_token(token, check_revoked=True)
    except Exception:
        raise HTTPException(401, "invalid token")
    org, role = claims.get("org_id"), claims.get("role")
    if not org or role not in ("admin", "therapist", "assistant"):
        raise HTTPException(403, "account has no organization role")
    return Principal(uid=claims["uid"], org_id=org, role=role)


def current_principal(authorization: str | None = Header(default=None)) -> Principal:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token")
    token = authorization[7:]
    s = get_settings()
    if s.auth_mode == "dev":
        # "dev:<org>:<role>:<uid>" -- only reachable outside production (see Settings validator)
        try:
            _, org, role, uid = token.split(":")
            return Principal(uid=uid, org_id=org, role=role)
        except ValueError:
            raise HTTPException(401, "invalid dev token")
    return _verify_firebase(token)


def require_write(p: Principal = Depends(current_principal)) -> Principal:
    if not p.can_write:
        raise HTTPException(403, "read-only role")
    return p


def require_admin(p: Principal = Depends(current_principal)) -> Principal:
    if p.role != "admin":
        raise HTTPException(403, "admin only")
    return p
