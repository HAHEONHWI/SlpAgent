"""Applying organization claims to a Firebase account. Kept behind a dependency so tests and dev mode
never call Firebase."""
from ..config import get_settings
from pydantic import BaseModel, ConfigDict
from fastapi import Depends
from ..repo.provider import get_repo


class Account(BaseModel):
    model_config = ConfigDict(frozen=True)
    uid: str
    email: str | None = None
    name: str | None = None
    org_id: str | None = None
    role: str | None = None
    site_admin: bool = False
    disabled: bool = False


class AccountDirectory:
    def list(self) -> list[Account]:
        """Return account metadata only, never password hashes or provider credentials."""
        import firebase_admin
        from firebase_admin import auth
        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        return [Account(uid=u.uid, email=u.email, name=u.display_name, disabled=u.disabled,
                        org_id=(u.custom_claims or {}).get("org_id"), role=(u.custom_claims or {}).get("role"),
                        site_admin=(u.custom_claims or {}).get("site_admin") is True)
                for u in auth.list_users().iterate_all()]

    def set_disabled(self, uid: str, disabled: bool) -> None:
        import firebase_admin
        from firebase_admin import auth
        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        auth.update_user(uid, disabled=disabled)
        if disabled:
            auth.revoke_refresh_tokens(uid)

    def delete(self, uid: str) -> None:
        import firebase_admin
        from firebase_admin import auth
        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        try:
            auth.delete_user(uid)
        except auth.UserNotFoundError:
            pass


class DevAccountDirectory:
    def __init__(self, repo):
        self.repo = repo

    def list(self) -> list[Account]:
        """Use local account metadata without contacting Firebase in development."""
        repo = self.repo
        rows = {r["uid"]: Account(uid=r["uid"], email=r.get("email"), name=r.get("therapist_name"))
                for r in repo.list("signup_requests", PLATFORM)}
        for org in repo.list("organization_registry", PLATFORM):
            for u in repo.list("users", org["org_id"]):
                rows[u["uid"]] = Account(uid=u["uid"], email=u.get("email"), name=u.get("name"),
                                         org_id=org["org_id"], role=u.get("role"))
        return list(rows.values())

    def set_disabled(self, uid: str, disabled: bool) -> None:
        """Dev accounts have no Firebase record; suspension is enforced by the access record alone."""

    def delete(self, uid: str) -> None:
        """Dev accounts have no Firebase record; the access tombstone blocks the token."""


def get_account_directory(repo=Depends(get_repo)):
    return DevAccountDirectory(repo) if get_settings().auth_mode == "dev" else AccountDirectory()

PLATFORM = "_platform"  # namespace for platform-level docs (signup requests, org registry); never an org id


class ClaimsSetter:
    def __call__(self, uid: str, claims: dict) -> None:
        import firebase_admin
        from firebase_admin import auth
        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        current = dict(auth.get_user(uid).custom_claims or {})
        current.update(claims)
        auth.set_custom_user_claims(uid, current)
        auth.revoke_refresh_tokens(uid)


class DevClaimsSetter:
    """Dev tokens carry their claims in the token itself, so approval only records what would be set."""
    def __init__(self):
        self.applied: list[tuple[str, dict]] = []

    def __call__(self, uid: str, claims: dict) -> None:
        self.applied.append((uid, claims))


_dev = DevClaimsSetter()


def get_claims_setter():
    return _dev if get_settings().auth_mode == "dev" else ClaimsSetter()
