import argparse
from datetime import datetime, timedelta, timezone
from app.config import get_settings
from app.deps import get_repo
from app.services.child_purge import CHILD_COLLECTIONS, purge_child  # noqa: F401 (re-exported)


def purge(repo, org_id: str, retention_days: int, apply: bool = False, settings=None) -> list[str]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    candidates = []
    for child in repo.list("children", org_id, archived=True):
        try:
            archived_at = datetime.fromisoformat(child["archived_at"].replace("Z", "+00:00"))
        except (KeyError, TypeError, ValueError):
            continue
        if archived_at.tzinfo is None:
            archived_at = archived_at.replace(tzinfo=timezone.utc)
        if archived_at > cutoff:
            continue
        candidates.append(child["id"])
        if apply:
            purge_child(repo, org_id, child["id"], "retention-job", "system", settings, retention_days=retention_days)
    return candidates


def main() -> None:
    parser = argparse.ArgumentParser(description="Permanently delete archived child records after an approved retention period.")
    parser.add_argument("--org-id", required=True)
    parser.add_argument("--retention-days", required=True, type=int)
    parser.add_argument("--apply", action="store_true", help="permanently delete eligible records")
    args = parser.parse_args()
    if args.retention_days < 1:
        parser.error("--retention-days must be at least 1")
    settings = get_settings()
    repo = get_repo()
    candidates = purge(repo, args.org_id, args.retention_days, args.apply, settings)
    print(f"eligible archived children: {len(candidates)}")
    if args.apply:
        print(f"permanently deleted: {len(candidates)}")
    else:
        print("dry run; pass --apply to permanently delete records")


if __name__ == "__main__":
    main()
