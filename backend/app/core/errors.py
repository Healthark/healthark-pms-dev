"""
errors — Redaction for exception text that gets persisted or returned.

Driver-level exceptions (SQLAlchemy / psycopg2) stringify with the full DB
connection context — host, port, user, sometimes the whole DSN — plus the
failing SQL and its bound parameters. Any of that landing in a persisted
column (e.g. export_audit_log.error_message) or an HTTP response body is a
secret / PII leak at rest.

`safe_error_summary` produces a short, non-sensitive tag suitable for storing
or returning. The FULL detail belongs in the server log (logger.exception),
which is access-controlled and rotated — never in the database.

Allowlist, not blocklist: only exception types we author (HTTPException detail)
keep their message; everything else — including every SQLAlchemy/DBAPI error —
is reduced to its class name.
"""

from __future__ import annotations

import re

from fastapi import HTTPException

_MAX_MESSAGE_LEN = 300

# Belt-and-suspenders redaction for the one path that keeps a message
# (HTTPException detail): strip anything shaped like a DSN or inline credential
# even though those details are app-authored.
_DSN_RE = re.compile(r"\b\w+://\S*@\S*")  # scheme://user:pass@host...
_CRED_RE = re.compile(
    r"(?i)(password|pwd|secret|token|pgpassword)\s*=\s*\S+"
)


def _redact(text: str) -> str:
    text = _DSN_RE.sub("[redacted-url]", text)
    text = _CRED_RE.sub(r"\1=[redacted]", text)
    return text


def safe_error_summary(err: Exception) -> str:
    """A short, non-sensitive description of `err`, safe to persist or return.

    - HTTPException → 'HTTPException: <detail>' (redacted + truncated); the
      detail is text we author (e.g. "Export exceeds 100000 rows").
    - Everything else — SQLAlchemyError/DBAPIError/OperationalError and any
      other exception — → the class name ONLY. Their message is where the DB
      host/port/user, SQL, and parameters live, so it never leaves the process.
    """
    name = type(err).__name__

    if isinstance(err, HTTPException):
        detail = _redact(str(err.detail))[:_MAX_MESSAGE_LEN]
        return f"{name}: {detail}" if detail else name

    return name
