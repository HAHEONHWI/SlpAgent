"""Applying organization claims to a Firebase account. Kept behind a dependency so tests and dev mode
never call Firebase."""
from ..config import get_settings

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


class DevClaimsSetter:
    """Dev tokens carry their claims in the token itself, so approval only records what would be set."""
    def __init__(self):
        self.applied: list[tuple[str, dict]] = []

    def __call__(self, uid: str, claims: dict) -> None:
        self.applied.append((uid, claims))


_dev = DevClaimsSetter()


def get_claims_setter():
    return _dev if get_settings().auth_mode == "dev" else ClaimsSetter()
