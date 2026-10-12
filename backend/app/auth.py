from typing import Literal
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from .config import get_settings

Role = Literal["admin", "therapist", "assistant"]
ROLES = ("admin", "therapist", "assistant")


class Identity(BaseModel):
    """A verified signed-in account. It may not belong to an organization yet (signup pending approval)."""
    uid: str
    email: str | None = None
    org_id: str | None = None
    role: str | None = None
    site_admin: bool = False


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


def _verify_firebase(token: str) -> Identity:
    import firebase_admin
    from firebase_admin import auth

    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    try:
        claims = auth.verify_id_token(token, check_revoked=True)
    except Exception:
        raise HTTPException(401, "invalid token")
    return Identity(uid=claims["uid"], email=claims.get("email"), org_id=claims.get("org_id"),
                    role=claims.get("role"), site_admin=claims.get("site_admin") is True)


def _dev_identity(token: str) -> Identity:
    # "dev:<org>:<role>:<uid>" -- only reachable outside production (see Settings validator).
    # org "-" = no organization (signup pending); role "site_admin" = platform administrator.
    try:
        _, org, role, uid = token.split(":")
    except ValueError:
        raise HTTPException(401, "invalid dev token")
    if role == "site_admin":
        return Identity(uid=uid, email=f"{uid}@dev.local", site_admin=True)
    return Identity(uid=uid, email=f"{uid}@dev.local", org_id=None if org == "-" else org,
                    role=role if role in ROLES else None)


# HTTPBearer (instead of a raw header) lets Swagger UI show an "Authorize" button.
bearer = HTTPBearer(auto_error=False, description="Firebase ID token. Dev mode: dev:<org>:<role>:<uid>")


def current_identity(cred: HTTPAuthorizationCredentials | None = Depends(bearer)) -> Identity:
    if not cred or cred.scheme.lower() != "bearer" or not cred.credentials:
        raise HTTPException(401, "missing bearer token")
    if get_settings().auth_mode == "dev":
        return _dev_identity(cred.credentials)
    return _verify_firebase(cred.credentials)


def current_principal(identity: Identity = Depends(current_identity)) -> Principal:
    if not identity.org_id or identity.role not in ROLES:
        raise HTTPException(403, "account has no organization role (signup pending approval)")
    if identity.org_id.startswith("_"):  # reserved namespaces such as "_platform" are never organizations
        raise HTTPException(403, "invalid organization")
    return Principal(uid=identity.uid, org_id=identity.org_id, role=identity.role)


def require_write(p: Principal = Depends(current_principal)) -> Principal:
    if not p.can_write:
        raise HTTPException(403, "read-only role")
    return p


def require_admin(p: Principal = Depends(current_principal)) -> Principal:
    if p.role != "admin":
        raise HTTPException(403, "admin only")
    return p


def require_site_admin(identity: Identity = Depends(current_identity)) -> Identity:
    if not identity.site_admin:
        raise HTTPException(403, "site admin only")
    return identity
