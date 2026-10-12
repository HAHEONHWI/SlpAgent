import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Set Firebase organization and role claims for one user.")
    parser.add_argument("--uid", required=True)
    parser.add_argument("--org-id", required=True)
    parser.add_argument("--role", required=True, choices=("admin", "therapist", "assistant"))
    parser.add_argument("--apply", action="store_true", help="write claims and revoke refresh tokens")
    args = parser.parse_args()
    print(f"uid={args.uid} org_id={args.org_id} role={args.role}")
    if not args.apply:
        print("dry run; pass --apply to update claims and revoke refresh tokens")
        return
    import firebase_admin
    from firebase_admin import auth
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    user = auth.get_user(args.uid)
    claims = dict(user.custom_claims or {})
    claims.update({"org_id": args.org_id, "role": args.role})
    auth.set_custom_user_claims(args.uid, claims)
    auth.revoke_refresh_tokens(args.uid)
    print("claims updated; refresh tokens revoked; user must sign in again")


if __name__ == "__main__":
    main()
