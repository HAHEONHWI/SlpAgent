from typing import Literal
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
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


# HTTPBearer (instead of a raw header) lets Swagger UI show an "Authorize" button.
bearer = HTTPBearer(auto_error=False, description="Firebase ID token. Dev mode: dev:<org>:<role>:<uid>")


def current_principal(cred: HTTPAuthorizationCredentials | None = Depends(bearer)) -> Principal:
    if not cred or cred.scheme.lower() != "bearer" or not cred.credentials:
        raise HTTPException(401, "missing bearer token")
    token = cred.credentials
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
