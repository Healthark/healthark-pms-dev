# 05 — Edge Cases & Suspected Validation Gaps

> **Audience:** QA + backend devs.
> **Purpose:** Catalogue the boundary conditions, validation gaps and security checks the seven QA-Test-Cases docs do not cover. Each TC documents a specific input/state and the assertion that should hold.
> **Status of items:** Marked as **suspected gap** until tested against the current build. After the first run, annotate each with `CONFIRMED BUG`, `WORKS AS DESIGNED`, or `OUT OF SCOPE`.

---

## 5.1 Goal weights & validations

### TC-GAP-001 — Goal description length limits

**Priority:** P0 **Type:** API

Send POST `/goals` with `description` of 4999, 5000, 5001, 50000 chars.
**Expected:** Server enforces a documented max; the boundary is exact and consistent with frontend's field maxLength.
**Suspected gap:** No length cap on server-side leads to crashed exports/PDFs.

### TC-GAP-002 — Goal weight sum > 100% across owner's goals

**Priority:** P0 **Type:** API
Staff creates goals A=40, B=40, C=40 (sum 120). Submit all for approval.
**Expected:** Either:
- (a) Server rejects on third submit with `weight_sum_exceeds_100`.
- (b) Mentor approval blocked until sum normalised.
**Suspected gap:** Sum > 100% likely silently accepted; finalises with weighted-score formulas that produce >100 self-ratings.

### TC-GAP-003 — Negative / zero goal weight

**Priority:** P0 **Type:** API
POST goals with `weight = 0`, `weight = -10`, `weight = 0.5`, `weight = 100.1`.
**Expected:** Reject 0, negative, and >100. Allow decimals if business permits; document the precision.

### TC-GAP-004 — Annual review rating outside 1–5 range

**Priority:** P0 **Type:** API
Submit mentor review with `rating = 0`, `6`, `5.5`, `-1`, `null`, `"five"`.
**Expected:** Server rejects each with explicit `rating_out_of_range` or `rating_invalid_type`.
**Suspected gap:** Frontend constrains slider to 1–5 but API may accept arbitrary numerics → bypass via direct POST.

### TC-GAP-005 — Management override of mentor rating by large delta

**Priority:** P1 **Type:** API
Mentor rates 5; management calibrates to 1 (delta=4). Inspect:
- Warning shown in UI?
- Audit log records `before_rating`, `after_rating`, `override_reason`?
- Mentor notified that calibration changed their input?

**Suspected gap:** Silent override without audit trail. This is a process integrity issue, not necessarily a code bug.

### TC-GAP-006 — Rating decimal precision

**Priority:** P1 **Type:** API
Submit rating `3.5`, `3.50`, `3.500`, `3.51`, `3.499999`.
**Expected:** Server stores at agreed precision (likely 2 dp). All variants of `3.5` should be equivalent.
**Defect candidate:** Rounding inconsistency between mentor display (3.5) and management display (3.50) or export (3.500).

---

## 5.2 Input safety (XSS / injection)

### TC-GAP-007 — `<script>` in goal title/description

**Priority:** P0 **Type:** MANUAL
Create a goal with title `<script>alert(1)</script>Test`.
**Expected:** Renders as text `<script>alert(1)</script>Test` everywhere — Team Goals list, Mentor Review pane, exports, notifications.
**Suspected gap:** React JSX auto-escapes, but PDF/Excel export pipelines (using openpyxl/reportlab) may render markup unsafely.

### TC-GAP-008 — HTML entities in project name

**Priority:** P0 **Type:** MANUAL
Project name = `<b>Bold</b> & "Quote"`.
**Expected:** Renders literally in dashboard widgets, sidebar tooltips, exports.

### TC-GAP-009 — Unicode + RTL + CJK

**Priority:** P1 **Type:** MANUAL
Fields with `🎯 موعد نهائي 期末考试`. Verify storage, listing, export.
**Suspected gap:** Excel exports using ascii-only encoding fallback.

---

## 5.3 Concurrency & idempotency

### TC-GAP-010 — Two mentor approvals racing on same goal

**Priority:** P0 **Type:** API
Two browser sessions of the same mentor both click Approve at nearly the same instant.
**Expected:** First wins; second gets 409 `goal_already_approved`.
**Suspected gap:** DB-level optimistic lock not present → both approvals create duplicate audit entries.

### TC-GAP-011 — Admin edits user while user edits own profile

**Priority:** P1 **Type:** API
Admin sets `phone='+91-A'`; user simultaneously sets `phone='+91-B'`.
**Expected:** Last write wins OR `If-Match` ETag rejection. Document the chosen policy.

### TC-GAP-012 — POST /goals submit twice (network retry)

**Priority:** P0 **Type:** API
Client sends two identical submits ~50 ms apart (e.g. user double-tap on flaky network).
**Expected:** Only one goal created. Idempotency key OR DB unique constraint on `(owner_id, title, cycle_name)`.
**Suspected gap:** Duplicate rows created silently.

### TC-GAP-013 — Annual review submit double-fire

**Priority:** P0 **Type:** API
Same as -012 for `/annual_reviews/submit`.
**Expected:** Single transition `draft → pending_mentor`. Second call returns 409 `already_submitted`.

---

## 5.4 Authentication & authorisation

### TC-GAP-014 — JWT revocation on logout

**Priority:** P0 **Type:** API
1. Login → capture JWT.
2. Logout via UI.
3. Use captured JWT in `Authorization: Bearer <token>` for any GET.
**Expected:** 401 token revoked.
**Suspected gap:** Stateless JWT means token remains valid until expiry. Document policy: is there a token blocklist or shortest-acceptable expiry?

### TC-GAP-015 — Reset email for non-existent address

**Priority:** P0 **Type:** API
POST `/auth/request_reset` with `email="nobody@nowhere"`.
**Expected:** 200 with same generic body as a valid email. **Timing identical** (≤ 200ms variance) to prevent timing-attack enumeration.
**Suspected gap:** Existing email triggers email-send (slow); non-existent returns instantly. Side-channel leak.

### TC-GAP-016 — Staff calls admin endpoint

**Priority:** P0 **Type:** API
With staff JWT, POST `/admin/settings`.
**Expected:** 403. Try every admin route.

### TC-GAP-017 — Mentor reads another mentor's mentees

**Priority:** P0 **Type:** API
As `mentor.alpha`, GET `/mentees/<id_belonging_to_mentor.beta>`.
**Expected:** 403 (or 404 to avoid leaking existence).

### TC-GAP-018 — Staff reads `/admin/users/<id>`

**Priority:** P0 **Type:** API
**Expected:** 403.

---

## 5.5 360 Feedback security & anonymity

### TC-GAP-019 — Reviewer hash secret strength

**Priority:** P0 **Type:** API
Inspect `FEEDBACK_HASH_SECRET` env var requirements.
**Expected:** Documented minimum length (≥ 32 random bytes). Server start aborts if it's the default placeholder.
**Suspected gap:** Default/weak secret in dev allows hash inversion → de-anonymisation.

### TC-GAP-020 — Mentor cannot see reviewer identities

**Priority:** P0 **Type:** API
As mentor, GET `/feedback_360/aggregate/<mentee_id>?fy=2026`.
**Expected:** Response contains aggregated scores + counts. No `reviewer_id`, `reviewer_name`, no `reviewer_hash` (the hash itself is a fingerprint; if exposed, joining with mentor's own feedback could de-anonymise).

### TC-GAP-021 — Minimum reviewer threshold for aggregate

**Priority:** P0 **Type:** API + MANUAL
With 1, 2, 3, 4 reviewers, fetch aggregate.
**Expected:** Below threshold (typically 3), aggregate is hidden ("Awaiting more reviewers"). At or above, scores shown.
**Suspected gap:** Threshold not enforced server-side; UI hides it but raw API leaks.

---

## 5.6 Exports

### TC-GAP-022 — Large export streams without OOM

**Priority:** P1 **Type:** API
Generate 10,000 reviews and export.
**Expected:** Server streams the file; client receives within 30 s; memory bounded.
**Suspected gap:** Excel exports built in-memory via openpyxl → OOM for >5k rows.

### TC-GAP-023 — Export honours cycle + FY + status combinations

**Priority:** P0 **Type:** API
Apply multi-filter export and check row counts match equivalent GET list calls.

### TC-GAP-024 — Export filename contains no PII

**Priority:** P1 **Type:** MANUAL
Inspect filenames for "John_Doe" or any user identifier. Filename should contain only `<entity>_<fy>_<cycle>_<timestamp>.xlsx`.

---

## 5.7 Notifications

### TC-GAP-025 — Notification deduplication

**Priority:** P1 **Type:** API
Trigger a goal approval twice (idempotent retry).
**Expected:** ONE notification.
**Suspected gap:** Each API call enqueues a notification → duplicate noise.

### TC-GAP-026 — Notification retention

**Priority:** P2 **Type:** API
Create a notification, set its `created_at` to 100 days ago. GET list.
**Expected:** Document retention policy (e.g. read notifications older than 90 days auto-purge).

---

## 5.8 Sessions

### TC-GAP-027 — Idle session timeout warning

**Priority:** P1 **Type:** MANUAL
Log in, idle 25 / 30 / 60 min.
**Expected:** Either:
- Long-lived session (≥ 8 h) — no warning needed.
- Short session — visible "Session expires in 1 min" warning before logout.

### TC-GAP-028 — Multi-tab logout sync

**Priority:** P1 **Type:** MANUAL
Two tabs of the same user. Logout in Tab A. In Tab B, click any nav.
**Expected:** Tab B detects 401, redirects to /login.

---

## 5.9 DB integrity & orphans

### TC-GAP-029 — Orphan goal (deleted owner)

**Priority:** P0 **Type:** API
Force `goal.owner_id` to reference a hard-deleted user (DB direct).
**Expected:** GET `/goals/<id>` returns 404, NOT 500. List endpoints filter it out.
Note: Soft-delete should be the normal path; hard delete in production is a defect on its own.

### TC-GAP-030 — Soft-deleted user's annual review handling

**Priority:** P1 **Type:** API
- List `/annual_reviews?include_deleted=false` excludes them.
- GET `/annual_reviews/<id>` for a soft-deleted user's review returns 404 to non-admins, 200 to admins.

---

## 5.10 Date display & timezones

### TC-GAP-031 — UTC server, IST browser

**Priority:** P1 **Type:** MANUAL
Server in UTC; browser locale `Asia/Kolkata`.
**Expected:** Cycle window labels show IST. A goal "approved at" timestamp 2026-04-15T18:30:00Z shows as 2026-04-16 00:00:00 IST. Audit timestamps display consistently across all pages.

### TC-GAP-032 — Date picker rejects out-of-cycle dates

**Priority:** P1 **Type:** MANUAL
Cycle `start=2026-04-01`, `end=2026-09-30`. Try to pick `2027-01-01` in a goal date field.
**Expected:** Picker greys out out-of-range dates or validates on save.

---

## 5.11 Pagination & search

### TC-GAP-033 — Filter + sort persistence across pages

**Priority:** P1 **Type:** MANUAL
Apply filter "Status=Approved" + sort "Title asc" on `/goals/team`. Click page 2.
**Expected:** Filter + sort preserved. URL contains query state so refresh works.

### TC-GAP-034 — Server-side pagination metadata

**Priority:** P0 **Type:** API
GET `/goals/team?page=2&page_size=20`. Inspect response:
- `total` (int)
- `page` (int)
- `page_size` (int)
- `has_more` (bool)

Boundary cases: `page=999` (beyond) → empty `items[]`, correct `total`, `has_more=false`.

### TC-GAP-035 — Search ranking

**Priority:** P2 **Type:** MANUAL
Search `john`: results ordered as exact full-name match → partial name → employee_code → email.

---

## 5.12 File upload (if supported)

### TC-GAP-036 — Avatar size + mime enforcement

**Priority:** P1 **Type:** API + MANUAL
Try: 10 MB png, 100 KB pdf, 5 KB svg with embedded JS.
**Expected:** Size limit ≤ 2 MB; only image/png + image/jpeg accepted; svg rejected (can carry JS).

### TC-GAP-037 — Filename sanitisation

**Priority:** P0 **Type:** API
Upload with filename `../../etc/passwd` or `..\..\system32\evil.exe`.
**Expected:** Server stores under a sanitised UUID-based name; path traversal impossible.

---

## 5.13 Frontend UX edge cases

### TC-GAP-038 — Browser back preserves scroll + filters

**Priority:** P2 **Type:** MANUAL
On `/goals/team` filtered to "Approved" page 3, click into a goal, then browser back.
**Expected:** Same page, scroll position roughly preserved, filters still applied.

### TC-GAP-039 — Autosave on refresh

**Priority:** P1 **Type:** MANUAL
Open annual review draft, type 200 chars in self-assessment, refresh.
**Expected:** Either (a) draft was autosaved → content present, or (b) browser dialog "Leave site?" warned.

### TC-GAP-040 — Form a11y: aria-invalid + disabled submit

**Priority:** P1 **Type:** MANUAL
Inspect any form with required fields.
**Expected:** Submit disabled while invalid; required fields with no value have `aria-invalid="true"` and visible red border; screen reader announces error.

---

## 5.14 Things the system likely doesn't validate (capture as design gaps if true)

These are NOT TCs; they're flags for design review. Each is a **suspected** gap until the run confirms it:

| # | Suspected gap | Why it matters |
|---|---------------|----------------|
| D-1 | No DB constraint that `goal.owner_id != goal.mentor_id` (mentor of self) | Self-approval loophole |
| D-2 | No constraint that mentor.id ≠ user.id (user is own mentor) | Same |
| D-3 | No constraint that `secondary_evaluator_id ≠ reports_to_id` on a project | Single person both PM + secondary = duplicate review on one staff |
| D-4 | `cycle_start_date` / `cycle_end_date` nullable + never checked | Admin can set illogical bounds with no effect |
| D-5 | No DB-level check that `Annual Review.final_rating` falls in valid enum | Frontend dropdown is the only gate |
| D-6 | No max-org-size check on `enabled_features` writes | Toggling a feature on for 10k staff invalidates their sessions silently |
| D-7 | No retention policy on `must_change_password` tokens | Stale tokens accumulate |
| D-8 | No audit table linking settings changes to admin user | Cycle-type swap leaves no who/when trail |
| D-9 | No CSRF protection on PATCH/POST (if cookie auth used) | Mentor approves goal because of forged form |
| D-10 | No rate-limit on `/auth/login` | Brute-force window unbounded |

Each of D-1..D-10 should become its own confirmed TC once the suspected gap is verified.

---

## How to use this file

1. Run each TC in order on staging.
2. Annotate with one of:
   - ✅ `WORKS AS DESIGNED` — close the TC; no defect.
   - 🐞 `CONFIRMED BUG` — open a Jira/Linear with the TC ID.
   - 🚫 `OUT OF SCOPE` — feature doesn't exist yet; ticket the feature, close TC.
3. For each `CONFIRMED BUG`, capture exact request/response in the TC notes.

---

## Companion docs

- [02-cross-module-sync-tests.md](02-cross-module-sync-tests.md), [03-cycle-simulation-playbook.md](03-cycle-simulation-playbook.md), [04-project-lifecycle-tests.md](04-project-lifecycle-tests.md) for adjacent suites.
- [06-execution-runbook.md](06-execution-runbook.md) for evidence capture conventions.
