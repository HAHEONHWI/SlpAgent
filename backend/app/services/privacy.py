import re


EMAIL = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
PHONE = re.compile(r"(?<!\d)(?:\+?82[- .]?)?0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}(?!\d)")


def sanitize_external_text(value: str, sensitive_values: list[str | None] | None = None) -> str:
    for sensitive in sorted({item for item in sensitive_values or [] if item}, key=len, reverse=True):
        value = value.replace(sensitive, "[개인정보]")
    value = EMAIL.sub("[이메일]", value)
    return PHONE.sub("[전화번호]", value)


def sanitize_external_value(value, sensitive_values: list[str | None] | None = None):
    if isinstance(value, str):
        return sanitize_external_text(value, sensitive_values)
    if isinstance(value, list):
        return [sanitize_external_value(item, sensitive_values) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_external_value(item, sensitive_values) for key, item in value.items()}
    return value
