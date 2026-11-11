from hashlib import sha256


def counter_id(org_id: str, prefix: str) -> str:
    return sha256(f"{org_id}\0{prefix}".encode()).hexdigest()
