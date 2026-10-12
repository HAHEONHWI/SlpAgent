import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Set Firebase claims for one user: an organization role, or site admin.")
    parser.add_argument("--uid", help="Firebase uid (or use --email)")
    parser.add_argument("--email", help="look up the uid by email")
    parser.add_argument("--org-id")
    parser.add_argument("--role", choices=("admin", "therapist", "assistant"))
    parser.add_argument("--site-admin", action="store_true", help="grant platform (site) administrator; bootstraps the first approver")
    parser.add_argument("--apply", action="store_true", help="write claims and revoke refresh tokens")
    args = parser.parse_args()
    if not (args.uid or args.email):
        parser.error("--uid or --email is required")
    if args.site_admin == bool(args.org_id or args.role):
        parser.error("use either --site-admin, or --org-id with --role")
    if not args.site_admin and not (args.org_id and args.role):
        parser.error("--org-id and --role go together")
    claims = {"site_admin": True} if args.site_admin else {"org_id": args.org_id, "role": args.role}
    print(f"target={args.uid or args.email} claims={claims}")
    if not args.apply:
        print("dry run; pass --apply to update claims and revoke refresh tokens")
        return
    import firebase_admin
    from firebase_admin import auth
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    user = auth.get_user(args.uid) if args.uid else auth.get_user_by_email(args.email)
    current = dict(user.custom_claims or {})
    current.update(claims)
    auth.set_custom_user_claims(user.uid, current)
    auth.revoke_refresh_tokens(user.uid)
    print(f"claims updated for {user.uid}; refresh tokens revoked; user must sign in again")


if __name__ == "__main__":
    main()
