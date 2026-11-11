import re


EMAIL = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
PHONE = re.compile(r"(?<!\d)(?:\+?82[- .]?)?0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}(?!\d)")


def sanitize_external_text(value: str, sensitive_values: list[str | None] | None = None) -> str:
    for sensitive in sorted({item for item in sensitive_values or [] if item}, key=len, reverse=True):
        value = re.sub(re.escape(sensitive), "[개인정보]", value, flags=re.IGNORECASE)  # "JANE DOE" too
    value = EMAIL.sub("[이메일]", value)
    return PHONE.sub("[전화번호]", value)


def organization_child_sensitive_values(repo, org_id: str) -> list[str]:
    return sorted({value.strip() for child in repo.list("children", org_id)
                   for value in (child.get("display_name"), child.get("guardian_contact"))
                   if isinstance(value, str) and value.strip()}, key=len, reverse=True)


def pseudonymize_child_text(value: str, child: dict, sensitive_values: list[str | None] | None = None) -> str:
    name = child.get("display_name")
    alias = child.get("alias")
    name = name.strip() if isinstance(name, str) else ""
    alias = alias.strip() if isinstance(alias, str) else ""
    replacement = alias if alias and alias.casefold() != name.casefold() else "[개인정보]"
    for sensitive in sorted({item.strip() for item in sensitive_values or []
                             if isinstance(item, str) and item.strip() and item.strip().casefold() != name.casefold()},
                            key=len, reverse=True):
        value = re.sub(re.escape(sensitive), "[개인정보]", value, flags=re.IGNORECASE)
    if name:
        value = re.sub(re.escape(name), lambda _: replacement, value, flags=re.IGNORECASE)
    return sanitize_external_text(value, [child.get("guardian_contact")])


def restore_child_code(value: str, child: dict) -> str:
    name, alias = child.get("display_name"), child.get("alias")
    if name and alias:
        return re.sub(re.escape(alias), lambda _: name, value, flags=re.IGNORECASE)
    return value


def sanitize_external_value(value, sensitive_values: list[str | None] | None = None, child: dict | None = None):
    if isinstance(value, str):
        return pseudonymize_child_text(value, child, sensitive_values) if child else sanitize_external_text(value, sensitive_values)
    if isinstance(value, list):
        return [sanitize_external_value(item, sensitive_values, child) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_external_value(item, sensitive_values, child) for key, item in value.items()}
    return value
