# 40 — Sanitize export errors + global 500 handler (stop DB-connection leak)

## Context

Every `/api/v1/exports/*` endpoint wraps the workbook build in
`try/except Exception`, and on failure `_finish_audit_failure` persisted
`str(err)[:500]` into `export_audit_log.error_message`. When the failure came
from the DB layer, `str(err)` embeds the **connection string** — host, internal
IP, port, DB user — plus the failing SQL and its bound parameters (which can
carry employee PII). Example on an auth failure:

```
(psycopg2.OperationalError) connection to server at "prod-db.internal" (10.2.3.4),
port 5432 failed: FATAL: password authentication failed for user "pms_app"
[SQL: SELECT users.email ... WHERE org_id = %(org_id)s] [parameters: {'org_id': 7}]
```

So DB infra secrets/topology were being written **at rest** into an application
table — readable by any audit-table reader, every backup/replica, and any
future "Export Audit" screen. This was the only `str(err)` sink in the backend.
It also compounded with the lack of a global exception handler: because the
endpoints re-raise, a misconfigured deploy could surface the same raw text to
the client. Both are closed here (findings #1, #2, #4 of the security review).

## Backend
- New `app/core/errors.py` → `safe_error_summary(err)`: **allowlist**. Only
  `HTTPException` keeps its (app-authored, redacted, ≤300-char) detail;
  everything else — SQLAlchemyError/DBAPIError/OperationalError and any other
  exception — is reduced to its **class name**. A `_redact()` pass strips
  DSN-shaped substrings and `password=/token=`-style credentials as
  belt-and-suspenders on the one path that keeps a message.
- `export_routes.py` `_finish_audit_failure`: stores `safe_error_summary(err)`
  instead of `str(err)[:500]`, and emits the full detail (with traceback) via
  `logger.exception(... audit id ...)` to the access-controlled **server log**,
  correlated by audit id — debuggability is preserved off-DB.
- `main.py`: explicit `FastAPI(debug=False)` + a global
  `@app.exception_handler(Exception)` that logs the detail server-side and
  returns a generic `500 {"detail": "Internal server error"}`. FastAPI still
  handles `HTTPException`/validation errors with their own responses; this only
  covers otherwise-uncaught 500s, so a raw DB error can never reach the client.

## Tests
- `backend/tests/test_export_error_sanitization.py`:
  - `safe_error_summary` on a `sqlalchemy.exc.OperationalError` whose text
    contains host/IP/port/user/`password` → returns `"OperationalError"` and
    none of those fragments; arbitrary exceptions → class name only.
  - `HTTPException` detail retained (413 row-cap message) and redacted when it
    contains a DSN/credential; message truncated.
  - End-to-end (in-memory SQLite): `_finish_audit_failure` persists
    `error_message == "OperationalError"`, status `failed`, no secret fragments.

## Verification
- Backend `pytest -q` → **315 passed**; `ruff check` clean on changed files.
- `grep -rn 'error_message = str('` over `app/` → no sinks remain.
- `python -c "import main"` → app imports, `app.debug is False`, catch-all
  handler registered.
- Manual: force a DB error during an export → audit row stores
  `"OperationalError"`, full detail appears only in the server log, client gets
  a generic 500.

## Note (env-secrets pivot)
This removes one place raw DB connection info escaped the process into the DB.
With secrets managed via env, the remaining raw-`DATABASE_URL` touchpoints are
`init_local_db.py` (prints the URL on the non-SQLite guard) and `alembic/env.py`
(sets `sqlalchemy.url`) — candidates for a follow-up pass.
