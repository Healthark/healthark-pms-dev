"""
url_safety — Scheme allowlisting for user-supplied reference links.

The only user-facing URL the app stores is a goal's `attachment_url`: a mentee
pastes an external reference (e.g. a Google Drive folder) for their mentor to
open and review. That value is later rendered into an anchor `href`, so a
`javascript:` / `data:` / `vbscript:` URL would execute in the *reviewer's*
authenticated session (stored XSS). We refuse anything that isn't a plain
`http`/`https` web link at the API boundary.

Kept deliberately narrow: this is an allowlist (http/https only), not a
blocklist, so novel dangerous schemes are rejected by default. The frontend
applies the same rule again at render time as defence-in-depth.
"""

from urllib.parse import urlparse

# Web links only. Everything else — javascript:, data:, vbscript:, file:,
# ftp:, mailto:, protocol-relative (//host), relative paths — is refused.
_ALLOWED_SCHEMES = frozenset({"http", "https"})

# A generous ceiling so a pasted Drive/SharePoint link always fits while an
# abusive multi-kilobyte payload is rejected before it reaches the DB column.
_MAX_URL_LENGTH = 2048


def validate_optional_http_url(value: str | None) -> str | None:
    """Validate an optional external reference link.

    Returns the trimmed URL when it is a well-formed http/https link, or None
    when the input is absent/blank. Raises ValueError otherwise — inside a
    Pydantic validator this surfaces to the client as a 422.

    Control characters are rejected outright rather than stripped: browsers
    silently drop embedded tabs/newlines (so ``java\\tscript:`` becomes
    ``javascript:`` when clicked), and leading whitespace lets ``  javascript:``
    slip past a naive scheme check. We normalise leading/trailing whitespace
    but treat any interior control character as hostile.
    """
    if value is None:
        return None

    trimmed = value.strip()
    if not trimmed:
        return None

    if len(trimmed) > _MAX_URL_LENGTH:
        raise ValueError("Reference link is too long.")

    # Any control character (incl. embedded tab/newline/NUL) is a smuggling
    # attempt — a legitimate web link never contains one.
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in trimmed):
        raise ValueError("Reference link contains invalid characters.")

    parsed = urlparse(trimmed)
    if parsed.scheme.lower() not in _ALLOWED_SCHEMES or not parsed.netloc:
        raise ValueError("Reference link must be a valid http(s) URL.")

    return trimmed
