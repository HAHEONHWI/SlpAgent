import io
import re
import zipfile
from xml.sax.saxutils import escape


class UnusableTemplate(ValueError):
    pass


def render(template_path: str, values: dict[str, str], required_tokens: set[str] | None = None) -> bytes:
    if not template_path:
        raise UnusableTemplate("HWPX_TEMPLATE_PATH is not configured")
    replaced = 0
    replaced_tokens = set()
    output = io.BytesIO()
    try:
        with zipfile.ZipFile(template_path) as source, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
            for entry in source.infolist():
                content = source.read(entry.filename)
                if entry.filename.endswith(".xml"):
                    text = content.decode("utf-8")
                    def substitute(match):
                        nonlocal replaced
                        key = match.group(1)
                        if key not in values:
                            raise UnusableTemplate(f"template token has no value: {key}")
                        replaced += 1
                        replaced_tokens.add(key)
                        return escape(str(values[key]))
                    content = re.sub(r"\{\{([a-zA-Z0-9_]+)\}\}", substitute, text).encode("utf-8")
                target.writestr(entry, content)
    except (OSError, zipfile.BadZipFile, UnicodeDecodeError) as error:
        raise UnusableTemplate(f"invalid HWPX template: {error}") from error
    if replaced == 0:
        raise UnusableTemplate("template has no supported text placeholders")
    missing = (required_tokens or set()) - replaced_tokens
    if missing:
        raise UnusableTemplate(f"template is missing required tokens: {', '.join(sorted(missing))}")
    return output.getvalue()
