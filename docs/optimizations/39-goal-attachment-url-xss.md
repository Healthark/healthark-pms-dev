# 39 — Harden goal attachment URLs against stored XSS

## Context

A goal's `attachment_url` lets a mentee attach an external reference link (e.g. a
Google Drive folder) for their mentor to open and review. The value was stored
as an unvalidated string and rendered straight into an anchor `href` in three
goal views — including the mentor/manager-facing Team Goals and Mentee Goals
tabs. A subordinate could set `attachment_url` to `javascript:…`; when their
reviewer clicked "Attachment", the script executed in the **reviewer's**
authenticated session (it could read the JS-readable CSRF token + cached user
info and issue CSRF-valid requests as them). This is a stored, cross-user XSS.

Fix: allowlist `http`/`https` only, enforced at the API boundary (primary) and
again at render time (defence-in-depth, which also neutralizes any value already
in the DB). Legitimate web links keep working; script-bearing schemes are
refused. No DB migration — the column stays `String`.

## Backend
- New `backend/app/core/url_safety.py` → `validate_optional_http_url(value)`:
  returns the trimmed URL for a well-formed http/https link, `None` for
  blank/absent, else raises `ValueError`. Rejects control-character smuggling
  (` javascript:`, `java\tscript:`), protocol-relative/relative inputs, non-web
  schemes (`data:`, `vbscript:`, `file:`, `ftp:`, `mailto:`), and >2048 chars.
- `goal_schemas.py`: a `@field_validator("attachment_url")` on both `GoalCreate`
  and `GoalUpdate` delegates to the helper, so bad values are rejected with a 422
  on create and update.

## Frontend
- New `frontend/src/utils/url.ts` → `isSafeHttpUrl(url)`: `new URL()` parse +
  `http:`/`https:` protocol check (the render-time mirror of the backend rule).
- New `frontend/src/components/goals/AttachmentLink.tsx`: the single render-time
  guard. Emits the `<a target="_blank" rel="noopener noreferrer">` **only** when
  `isSafeHttpUrl` passes; an unsafe/legacy value renders as inert, non-clickable
  text ("Attachment (link hidden — invalid URL)") so no dangerous scheme ever
  reaches an `href`.
- The three inline `href={goal.attachment_url}` blocks now use `<AttachmentLink>`
  — `pages/AnnualGoals.tsx`, `components/goals/TeamGoalsTab.tsx`,
  `components/mentees/MenteeGoalsTab.tsx` (unused `Link`/`LinkIcon` imports
  dropped).
- `GoalFormModal.tsx`: inline validation — a non-empty, non-http(s) value shows
  "Enter a valid link starting with http:// or https://", sets `aria-invalid`,
  and disables Save, so users get feedback instead of a raw 422.

## Tests
- `backend/tests/test_goal_attachment_url_validation.py` (pure-schema): rejects
  `javascript:`/`data:`/`vbscript:`/`file:`/`ftp:`/`mailto:`/protocol-relative/
  whitespace- and tab-smuggled/over-long payloads on both GoalCreate and
  GoalUpdate; accepts Drive/SharePoint/http links; blank → None.
- `frontend/src/utils/__tests__/url.test.ts`: `isSafeHttpUrl` allow/deny matrix.
- `frontend/src/components/goals/__tests__/AttachmentLink.test.tsx`: safe URL →
  anchor with correct href/rel/target; `javascript:`/`data:` → no anchor emitted;
  empty → renders nothing.

## Verification
- Backend `pytest -q` → 303 passed.
- Frontend `tsc -b --noEmit` clean; `eslint .` 0 errors; `vitest run` → 132
  passed (incl. 8 new).
- Manual: saving a goal with `javascript:alert(1)` is rejected with a clear
  message; a Drive `https://…` link saves and renders clickable in Team/Mentee
  Goals; a legacy `javascript:` row renders as inert text.
