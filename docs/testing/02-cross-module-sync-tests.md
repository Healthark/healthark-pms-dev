# 02 — Cross-Module Sync Test Suite

> **Audience:** QA executing on staging.
> **Purpose:** Catch the bugs that hide in the *seams* between Mentor, Mentee, Annual Goals, Annual Reviews, Management Review, Project Reviews, 360 Feedback, and System Settings.
> **Prerequisite:** Run on a staging env with `ALLOW_DATE_SIMULATION=true`. See [00-framework-overview.md](00-framework-overview.md) for stack and [06-execution-runbook.md](06-execution-runbook.md) for setup.
> **Sequel to:** Once each module's own QA-Test-Cases doc passes in isolation, run this suite.

The seven QA docs ([QA-01..QA-07](../)) verify modules independently. This file proves they stay **synchronized** when changes ripple across them. Every TC here touches **≥ 2 modules**.

---

## 2.0 Roles + seed data the suite assumes

For most TCs you need these accounts pre-seeded (extend [`seed-test.py`](../../backend/seed-test.py) as needed):

| Handle | Role | is_management | Notes |
|--------|------|---------------|-------|
| `admin.mgmt@test` | Admin | true | Sets simulated_today, sees Mgmt Review |
| `admin.std@test` | Admin | false | Sees Admin Panel but not Mgmt Review |
| `mentor.alpha@test` | Staff | false | Mentor to mentee.one, mentee.two |
| `mentor.beta@test` | Staff | false | Empty mentee list at start |
| `mentee.one@test` | Staff | false | mentor_id = mentor.alpha |
| `mentee.two@test` | Staff | false | mentor_id = mentor.alpha |
| `pm.alpha@test` | Staff | false | reports_to_id on `Project Alpha` |
| `sec.alpha@test` | Staff | false | secondary_evaluator_id on `Project Alpha` |

Active cycle at suite start: **H1 FY26-27** (i.e. `simulated_today = 2026-04-15`, `cycle_type = half_yearly`).

---

## TC-SYNC-001 — Mentor reassign mid-cycle propagates everywhere

**Modules:** Mentoring · Goals · Annual Reviews · Dashboard · 360 Feedback · Sidebar
**Type:** SIM **Priority:** P0

**Pre-conditions**
- `mentor.alpha` is mentor of `mentee.one`.
- `mentee.one` has **two approved goals** for H1 FY26-27.
- `mentee.one` has saved a **draft H1 self-review** on Goal A.

**Steps**
1. Login `admin.std`. Admin Panel → Users → edit `mentee.one`. Change `mentor_id` from `mentor.alpha` → `mentor.beta`. Save.
2. Logout. Login `mentor.alpha`. Open **My Mentees**.
3. Logout. Login `mentor.beta`. Open **My Mentees**.
4. Open Annual Goals → Team Goals filter by mentee.
5. Open **360 Feedback** as `mentor.beta`.
6. Open Dashboard widget "Pending mentor reviews" for both mentors.

**Expected — every assertion must pass**
| Surface | mentor.alpha (old) | mentor.beta (new) |
|---------|--------------------|--------------------|
| Sidebar `My Mentees` item | hidden (if mentee.one was only mentee) OR badge -1 | shown; badge +1 |
| `/mentees` list | `mentee.one` absent | `mentee.one` present |
| `/goals/team` filter list | `mentee.one`'s 2 goals absent | `mentee.one`'s 2 goals present |
| Draft self-review on Goal A | not visible (no edit) | visible (read-only until self-review submitted) |
| 360 Feedback → Mentee Feedback tab | mentee.one absent | mentee.one present |
| Dashboard "Pending mentor reviews" count | -2 (the 2 H1 reviews removed) | +2 |

**Negative assertion**
- `mentee.one`'s **historical** records (H1 FY25 if any) stay attached by the value of `mentor_id_at_time_of_review` field if it exists; otherwise the design must declare whether historical attribution is "current mentor" or "mentor at submission time" — flag if ambiguous.

**Cleanup**
- Revert mentor reassignment so subsequent TCs find expected fixtures.

---

## TC-SYNC-002 — Old mentor loses ALL handles to reassigned mentee

**Modules:** Mentoring · Goals · 360 Feedback
**Type:** SIM **Priority:** P0

**Steps (continuing from TC-SYNC-001 setup, then reassign once more)**
1. Reassign `mentee.one` from `mentor.alpha` → `mentor.beta`.
2. As `mentor.alpha`, try the following **direct URLs**:
   - `/mentees/<mentee.one.id>` (Mentee Detail)
   - `/goals/team?mentee_id=<mentee.one.id>`
   - `/feedback/mentees/<mentee.one.id>`

**Expected**
- Each URL returns **403 Forbidden** (or redirect to /dashboard with a toast "You do not have access").
- API endpoints called by these pages return 403 — verify in browser DevTools → Network tab.

**Why this matters:** A stale link in `mentor.alpha`'s bookmarks must not leak data after reassignment. The router protecting the page is necessary but NOT sufficient — the API must enforce too.

---

## TC-SYNC-003 — New mentor inherits in-flight review states

**Modules:** Mentoring · Goals · Annual Reviews
**Type:** SIM **Priority:** P0

**Pre-conditions**
- `mentee.one` has Goal A with `approval_status = H1_SELF_REVIEWED` (mentor review pending).
- `mentee.one` has an Annual Review in `pending_mentor` status.
- Reassignment `mentor.alpha` → `mentor.beta` performed.

**Steps**
1. Login `mentor.beta`. Annual Goals → Team Goals → Goal A → Mentor Review pane.
2. Annual Reviews → Team Review tab.

**Expected**
- Goal A is visible to `mentor.beta` with H1 self-review content preserved and a "Submit Mentor Review" form available.
- The Annual Review for `mentee.one` is listed under `mentor.beta`'s pending queue with mentee's draft content intact.
- `mentor.alpha` no longer sees either record.
- After `mentor.beta` submits the mentor review, `mentor_id` of the saved review record reflects `mentor.beta`'s id (verify via API).

**Negative**
- The system MUST NOT silently re-route an in-flight `pending_management` review back to `pending_mentor` just because the mentor changed — that would erase the previous mentor's work. If the design instead routes to new mentor, capture this as a defect candidate.

---

## TC-SYNC-004 — Approved goals appear in Annual Review goal-list automatically

**Modules:** Goals · Annual Reviews
**Type:** API **Priority:** P0

**Steps (API-driven; use curl or Postman)**
1. As `mentee.one`, create 3 goals, submit them, mentor approves all 3 → status `approved`.
2. As `mentee.one`, GET `/annual_reviews/me?fy=2026`.

**Expected**
- Response has a `goals` array of length 3.
- Each goal's `cycle_name` matches the FY label (e.g. `H1 2026` or `2026` for annual orgs).
- `goal_self_assessment_text` field is empty/null (only set once self-review submitted).

**Negative**
- If staff has a goal in `draft` or `pending_approval`, it MUST NOT appear in the annual review goal list (only `approved` and later states).

---

## TC-SYNC-005 — Goal cycle_name vs Annual Review cycle_name consistency

**Modules:** Goals · Annual Reviews · Settings
**Type:** API **Priority:** P0

**Steps**
1. As `admin.mgmt`, set simulated_today = `2026-04-15` and `cycle_type=half_yearly`. Active cycle = `H1 FY26-27`.
2. As `mentee.one`, create + approve a goal. Goal's `cycle_name` should be `H1 2026`.
3. As `mentee.one`, save an annual review draft for FY26-27. Annual Review's `cycle_name` should be `FY26` (bare FY, per [cycle_utils.py:172-189](../../backend/app/core/cycle_utils.py#L172-L189)).

**Expected**
- Annual Review's `cycle_name` is the bare FY label (`FY26-27` or equivalent), NOT including the H1/H2 prefix.
- Goal's `cycle_name` includes the half/quarter prefix.
- A query joining the two MUST match using `extract_fy_label(goal.cycle_name) == review.cycle_name`.

**Why it matters:** Mismatches here cause Annual Review pages to display "no goals found" when the join logic is wrong.

---

## TC-SYNC-006 — cycle_type swap propagates to topbar + goal creation

**Modules:** Settings · Goals · Annual Reviews · Project Reviews · Chrome
**Type:** SIM **Priority:** P0

**Steps**
1. As `admin.mgmt`, GET `/admin/settings` and confirm `cycle_type=half_yearly`, `active_cycle_name="H1 FY26-27"`.
2. PATCH `/admin/settings` `{ "cycle_type": "quarterly" }`.
3. GET `/admin/settings` again.
4. Refresh the browser as `mentee.one`. Note the Topbar's active-cycle label.
5. Create a new goal (if `annual_goals_edit_enabled=true`). Capture its `cycle_name`.

**Expected**
- After step 3, `active_cycle_name` recomputes to `Q1 FY26-27` (or whatever quarter `simulated_today` falls in — verify with [`get_current_cycle_info`](../../backend/app/core/cycle_utils.py#L192-L214)).
- After step 4, Topbar shows the new cycle label without a hard refresh past the active-cycle widget's stale TTL.
- New goal's `cycle_name` reflects Q-style (e.g. `Q1 2026`).
- Existing H1-stamped goals retain their old `cycle_name` — no retroactive update.

**Negative**
- Topbar showing `H1 FY26-27` while goals are being stamped `Q1 2026` is a **stale cache bug** — log as defect.

---

## TC-SYNC-007 — annual_reviews_enabled=false locks UI + API

**Modules:** Settings · Annual Reviews · Sidebar · RBAC
**Type:** API + MANUAL **Priority:** P0

**Steps**
1. As `admin.mgmt`, PATCH `/admin/settings` `{"annual_reviews_enabled": false}`.
2. As `mentee.one` (re-login), open the app.
3. Sidebar check.
4. Direct URL: `/annual-reviews`.
5. Direct API call: POST `/annual_reviews/me/draft` with valid payload.
6. As `mentor.alpha`, attempt mentor review of any pending annual review.

**Expected**
- Sidebar `Annual Reviews` item hidden.
- Direct UI route redirects to `/dashboard`.
- POST returns **403** (or **409** with explicit "annual reviews disabled" reason) — capture the exact response code; this distinction matters for client error display.
- Existing data is preserved; toggling back ON restores access without data loss.

---

## TC-SYNC-008 — goals_submission_open=false: draft works, submit blocked

**Modules:** Settings · Goals
**Type:** API **Priority:** P0

**Steps**
1. As `admin.mgmt`, PATCH `/admin/settings` `{"goals_submission_open": false}`.
2. As `mentee.one`, save a goal in `draft`.
3. Attempt to submit (`/goals/<id>/submit`).

**Expected**
- Step 2 succeeds (draft save is local).
- Step 3 returns 403/409 with explicit message `goals submission is closed`.
- Resetting flag to `true` allows submission immediately, no re-login needed.

---

## TC-SYNC-009 — reviews_submission_open=false blocks Annual Review only

**Modules:** Settings · Annual Reviews · Project Reviews
**Type:** API **Priority:** P0

**Steps**
1. As `admin.mgmt`, PATCH `/admin/settings` `{"reviews_submission_open": false}`.
2. As `mentee.one`, save Annual Review draft. Attempt submit.
3. As `pm.alpha`, attempt submit of a Project Review.
4. As `mentor.alpha`, attempt mentor review on a goal's H1 self-review.

**Expected**
- Annual Review submit → blocked.
- Project Review submit → **NOT blocked** (separate gate). Verify per [project_review_routes.py](../../backend/app/api/routes/project_review_routes.py) that no shared flag interferes.
- Goal mentor self-review submit → **NOT blocked** by `reviews_submission_open` (governed by `is_review_window_open()` only).

**Why it matters:** Confirms the flag scopes to **Annual Review** only and doesn't accidentally lock other modules.

---

## TC-SYNC-010 — Granting reports_to_id triggers PM responsibility next cycle

**Modules:** Admin · Projects · Project Reviews
**Type:** SIM **Priority:** P0

**Steps**
1. As `admin.std`, set `mentor.beta.reports_to_id` = some project's id (i.e. make `mentor.beta` a PM).
2. As `admin.mgmt`, advance simulated_today to next H1 boundary (e.g. `2026-10-01`).
3. As `admin.std`, trigger / confirm Project Review row generation for the new cycle.
4. As `mentor.beta`, open Project Reviews → **Evaluate Team** tab.

**Expected**
- `mentor.beta` now sees the project's team members in their evaluate-team list.
- Newly created `ProjectReview` rows attribute to `mentor.beta` as primary.
- Old PM (if any) no longer receives new rows but historical rows stay on their dashboard for read-only.

**Open question (flag if found):** Is review generation **automatic** on cycle advance or **manual** via admin action? Capture the actual trigger mechanism.

---

## TC-SYNC-011 — Removing reports_to_id closes pending PM reviews

**Modules:** Admin · Projects · Project Reviews
**Type:** SIM **Priority:** P0

**Steps**
1. `pm.alpha` has 3 pending Project Reviews (status `pending` or `draft`).
2. As `admin.std`, clear `pm.alpha.reports_to_id`.
3. As `pm.alpha`, open Project Reviews → Evaluate Team.

**Expected**
- Pending reviews are no longer visible to `pm.alpha`.
- They either: (a) auto-archive with a "PM removed" state, (b) reassign to next PM in chain, or (c) remain orphaned for admin attention.
- Verify which path the system takes — all three are defensible; the bug is silent data loss.

---

## TC-SYNC-012 — Adding secondary_evaluator_id creates Secondary review row

**Modules:** Admin · Projects · Project Reviews
**Type:** API **Priority:** P0

**Steps**
1. Project Alpha currently has `secondary_evaluator_id = null`.
2. As `admin.std`, set `secondary_evaluator_id = sec.alpha.id`.
3. As `sec.alpha`, open Project Reviews → Secondary Eval tab.

**Expected**
- `sec.alpha` sees Project Alpha team members listed for evaluation.
- A `ProjectReviewSecondary` row (or equivalent) exists per team member for the current cycle.
- `EvaluatorStatus = DRAFT` on each.

---

## TC-SYNC-013 — Mentor sees mentee's 360 aggregate after ≥3 reviewers

**Modules:** Mentoring · 360 Feedback
**Type:** API + MANUAL **Priority:** P0

**Steps**
1. As 3 different staff (not `mentor.alpha`, not `mentee.one`), submit 360 feedback for `mentee.one`.
2. As `mentor.alpha`, open Mentee Detail → 360 Feedback tab.

**Expected**
- Aggregate scores visible.
- Individual reviewer names NOT visible (anonymity invariant).
- Below 3 reviewers, tab shows "Awaiting more reviewers (X of 3)" placeholder.

**Cross-reference:** [TC-GAP-021](05-edge-cases-and-validation-gaps.md#tc-gap-021).

---

## TC-SYNC-014 — Reviewer hash uniqueness blocks duplicate FY submission

**Modules:** 360 Feedback
**Type:** API **Priority:** P0

**Steps**
1. As `mentor.alpha`, POST `/feedback_360/submit` for target `mentee.one`, FY 2026.
2. Repeat the same call.

**Expected**
- First call → 201 Created.
- Second call → 409 Conflict with `error_code = duplicate_feedback_for_fy`.
- DB shows exactly ONE row with `reviewer_hash = HMAC(reviewer_id|target_id|fy_year)`.

**Negative**
- The error MUST NOT echo back the existing review's text — that would leak data through the error path.

---

## TC-SYNC-015 — Dashboard widgets reflect cross-module changes

**Modules:** Dashboard · Goals · Annual Reviews · Project Reviews
**Type:** API + MANUAL **Priority:** P1

**Steps**
1. Login any user. Note Dashboard widget counts: `goals_pending`, `annual_reviews_pending`, `project_reviews_pending`.
2. In another tab/session, complete actions that should change each count (e.g. submit a goal, mentor-approve, finalize an annual review).
3. Refresh Dashboard.

**Expected**
- Counts update on refresh.
- Document the **freshness window** (does the dashboard cache for N seconds? Is there a server-side cache invalidation hook?).
- If a dashboard widget is server-rendered with caching, set the cache TTL expectation in this TC.

---

## TC-SYNC-016 — Goal submit → mentor notification → deep-link

**Modules:** Goals · Notifications · Mentoring
**Type:** API + MANUAL **Priority:** P0

**Steps**
1. As `mentee.one`, submit a goal for approval.
2. As `mentor.alpha`, refresh and open the notification bell.
3. Click the new notification.

**Expected**
- Notification appears within ≤ 5s (define the SLA in TC).
- Click navigates to Annual Goals → Team Goals filtered to the **specific** goal (URL contains `?goal_id=…`).
- After click, notification's `read=true`; badge count decrements.

**Negative**
- Multiple identical notifications for the same submit event = **defect** (see TC-GAP-025).

---

## TC-SYNC-017 — Annual Review pending_management notifies all mgmt admins

**Modules:** Annual Reviews · Notifications · RBAC
**Type:** API **Priority:** P0

**Steps**
1. As `mentor.alpha`, submit Annual Review for `mentee.one` → status `pending_management`.
2. Inspect `/notifications` for every user with `is_management=true`.
3. Inspect for `admin.std` (is_management=false).

**Expected**
- All `is_management=true` users have ONE notification each.
- `admin.std` has NONE (not a management admin).
- `mentor.alpha` has NONE (they submitted).
- `mentee.one` has NONE (target — they'll see the final once completed).

---

## TC-SYNC-018 — 360 submission does NOT notify the target (anonymity)

**Modules:** 360 Feedback · Notifications
**Type:** API **Priority:** P0

**Steps**
1. As `mentor.beta`, submit 360 for `mentee.one`.
2. As `mentee.one`, GET `/notifications`.

**Expected**
- `mentee.one`'s notifications do NOT contain any reference to a new 360.
- Subtle: even an "X people have reviewed you so far" counter that updates in real time would leak reviewer cadence — verify that's debounced or batched at FY end.

---

## TC-SYNC-019 — Soft-delete user cascades to all module surfaces

**Modules:** Admin · Goals · Annual Reviews · Project Reviews · 360 Feedback · Mentoring
**Type:** API **Priority:** P0

**Steps**
1. As `admin.std`, soft-delete `mentee.two` (is_deleted=true).
2. As `mentor.alpha`, refresh: My Mentees, Team Goals, Team Annual Reviews, Mentee Feedback tabs.
3. As any user, search 360 → Give Feedback's target dropdown.
4. As `pm.alpha`, Evaluate Team list.

**Expected — mentee.two MUST disappear from every active list:**
- My Mentees count -1
- Team Goals filter no longer includes `mentee.two`
- Team Annual Reviews list excludes
- Mentee Feedback tab excludes
- Give Feedback target dropdown excludes
- PM evaluate team list excludes

**See also TC-SYNC-020 for historical preservation.**

---

## TC-SYNC-020 — Soft-delete preserves historical records for mentor/admin

**Modules:** Goals · Annual Reviews · Project Reviews
**Type:** API **Priority:** P0

**Steps**
1. `mentee.two` (now soft-deleted) had: 2 approved goals, 1 completed annual review, 3 submitted project reviews.
2. As `mentor.alpha`, open historical view filtered to past mentees (if UI supports) OR query API: `/goals?owner_id=<mentee.two.id>&include_deleted=true`.
3. As `admin.std`, Admin Panel → Reviews → filter by deleted users.

**Expected**
- Historical records remain queryable.
- They render with an "[Deleted user]" badge or muted style on the user's name.
- Exports include them when the "include deleted" filter is on.

---

## 2.99 Cross-suite negative checks (run after entire suite)

After completing TC-SYNC-001..020, verify:

1. **No orphan notifications.** Each notification's referenced entity (goal, review) still exists or is properly marked.
2. **No mismatched cycle stamps.** A spot-check 5 random users' goals + annual review for FY26 should share matching `cycle_name` FY components.
3. **No unintentional state regressions.** A previously `approved` goal should never appear as `draft` again unless explicitly mentor-rejected via the `changes_requested` path.
4. **Audit trail intact.** Every mentor reassignment should be in the audit log with `before_mentor_id`, `after_mentor_id`, `changed_by`, `changed_at`.

---

## What's tracked but NOT covered here

| Theme | Where to look |
|-------|---------------|
| Pure FY rollover / cycle-type swap mechanics | [03-cycle-simulation-playbook.md](03-cycle-simulation-playbook.md) |
| Project create → execute → complete lifecycle | [04-project-lifecycle-tests.md](04-project-lifecycle-tests.md) |
| Validation edge cases (XSS, concurrency, weights) | [05-edge-cases-and-validation-gaps.md](05-edge-cases-and-validation-gaps.md) |
| Test execution mechanics | [06-execution-runbook.md](06-execution-runbook.md) |
