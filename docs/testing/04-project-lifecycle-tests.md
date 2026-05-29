# 04 — Project Lifecycle Tests (Create → Execute → Complete → Archive)

> **Audience:** QA + PM stakeholders.
> **Purpose:** Verify that projects and their reviews behave correctly across the project's full life — including the awkward edges: mid-cycle assignment changes, mid-cycle completion, reactivation, and cross-FY active projects.
> **Companion to:** [03-cycle-simulation-playbook.md](03-cycle-simulation-playbook.md) — most TCs here use `simulated_today` from there.

The seven QA-Test-Cases docs cover Project Reviews per-evaluator-role (PM, Secondary, Staff) but assume the project itself is stable. This file tests **what happens when projects change** during a cycle.

---

## 4.0 Pre-requisites + fixtures

Same staging env as files 02, 03. Add one specific seed:

| Project handle | PM | Secondary | Members | Status |
|----------------|-----|-----------|---------|--------|
| `Project Alpha` | `pm.alpha@test` | `sec.alpha@test` | `mentee.one`, `mentee.two`, `staff.echo` | active |
| `Project Beta`  | `pm.alpha@test` | (none)            | `mentee.one`                              | active |
| `Project Gamma` | `pm.beta@test`  | `sec.alpha@test`  | `mentee.two`, `staff.echo`                | active |

`pm.alpha` is reports_to_id for Alpha and Beta. `pm.beta` is reports_to_id for Gamma.
Active cycle on suite entry: `H1 FY26-27` at `simulated_today=2026-05-15`.

---

## TC-PROJLC-001 — New project creates pending PM reviews for active cycle

**Type:** API **Priority:** P0

**Steps**
1. As `admin.std`, POST `/admin/projects` with name `Project Delta`, `reports_to_id=pm.alpha`, members=`[mentee.one]`.
2. GET `/project_reviews` filtered to PM=`pm.alpha`, cycle=current.

**Expected**
- A `ProjectReview` row exists for (project=Delta, target=mentee.one, evaluator=pm.alpha, cycle_name=current, status=`pending`).
- Created within the same cycle as the project (no retroactive rows for past cycles).

**Open question (flag):** Is creation **synchronous in the same POST** or **async via worker / next cron**? Verify and document.

---

## TC-PROJLC-002 — New project with secondary creates Secondary review row

**Type:** API **Priority:** P0

**Steps**
1. Continue from TC-PROJLC-001.
2. PATCH project Delta `{"secondary_evaluator_id": sec.alpha.id}`.
3. GET `/project_reviews/secondary` filtered to evaluator=`sec.alpha`.

**Expected**
- A secondary review row for (project=Delta, target=mentee.one, evaluator=sec.alpha, status=`draft`).
- The PM review row from TC-PROJLC-001 unaffected.

---

## TC-PROJLC-003 — Mid-cycle project assignment doesn't backfill past cycles

**Type:** API **Priority:** P0

**Steps**
1. `simulated_today=2026-12-01`. Active = `H2 FY26-27` (already past H1).
2. Create `Project Epsilon` mid-H2.
3. Inspect project reviews for Project Epsilon.

**Expected**
- ONLY H2 review rows generated.
- NO H1 retro rows.
- PM doesn't see a "Pending H1 review for Project Epsilon" item.

---

## TC-PROJLC-004 — Add team_member mid-cycle → appears in current Evaluate Team

**Type:** API **Priority:** P0

**Steps**
1. As `admin.std`, add `staff.echo` to Project Beta (currently only `mentee.one`).
2. As `pm.alpha`, Project Reviews → Evaluate Team filtered by Project Beta.

**Expected**
- `staff.echo` row appears with status=`pending` for current cycle.
- `mentee.one` row already there is untouched.
- Old cycles' Beta reviews don't add a `staff.echo` row (no retro).

---

## TC-PROJLC-005 — Remove team_member mid-cycle closes their pending review

**Type:** SIM **Priority:** P0

**Steps**
1. As `pm.alpha`, save Project Alpha Q-review for `mentee.two` as **draft** (not submitted).
2. As `admin.std`, remove `mentee.two` from Project Alpha members.
3. As `pm.alpha`, Evaluate Team for Project Alpha.

**Expected (capture which path the system takes)**
- Option A: Draft auto-archives; row no longer visible in PM's pending list. Status becomes something like `cancelled` or `archived`.
- Option B: Draft remains visible with a "Member removed" badge; PM can submit or discard.

Both are defensible. The **bug** is if the draft silently disappears with no audit trace.

---

## TC-PROJLC-006 — Removed member's historical reviews stay visible

**Type:** API **Priority:** P0

**Steps**
1. `mentee.two` had 2 **submitted** Project Reviews on Project Alpha (one PM, one Secondary).
2. Remove `mentee.two` from members.
3. As `pm.alpha`, Project Reviews → "All Time" or historical filter.
4. As `mentee.two`, My Reviews tab.
5. As `admin.std`, Admin → Reviews.

**Expected**
- Reviews remain queryable and visible for all three roles.
- `mentee.two`'s My Reviews shows the historical submission.
- Membership change does not delete historical artefacts.

---

## TC-PROJLC-007 — Change PM mid-cycle: old PM loses access to new drafts

**Type:** SIM **Priority:** P0

**Steps**
1. As `pm.alpha`, save Project Alpha review for `staff.echo` as draft.
2. As `admin.std`, change Project Alpha's `reports_to_id` from `pm.alpha` → `pm.beta`.
3. As `pm.alpha`, refresh Evaluate Team.

**Expected**
- The draft for `staff.echo` is no longer accessible to `pm.alpha` for **editing**.
- `pm.alpha` may still see it read-only if "previously authored" view exists; otherwise it's gone.
- Reassignment is auditable: `audit_log` should record the project PM change.

---

## TC-PROJLC-008 — New PM inherits the in-flight draft (or starts fresh)

**Type:** SIM **Priority:** P0

**Steps**
1. After TC-PROJLC-007.
2. As `pm.beta`, Project Reviews → Evaluate Team filtered to Project Alpha.

**Expected (capture system's choice)**
- Option A: `pm.beta` sees `pm.alpha`'s draft as their own (authorship transfers).
- Option B: `pm.beta` starts a fresh draft; the old PM's draft is archived.

Either is defensible. The bug is if `pm.beta` cannot find a row to review for `staff.echo` at all.

---

## TC-PROJLC-009 — Submitted reviews stay attached to original PM

**Type:** API **Priority:** P0

**Steps**
1. `pm.alpha` SUBMITTED a review for `mentee.one` on Project Beta.
2. Change Project Beta's `reports_to_id` to `pm.beta`.
3. GET that specific ProjectReview row.

**Expected**
- `evaluator_id` on the submitted row is still `pm.alpha.id` (audit integrity).
- `pm.beta` does not appear as author of a review they didn't write.
- Admin export still shows `pm.alpha` as evaluator name.

---

## TC-PROJLC-010 — Secondary swap mid-cycle (draft vs submitted parity)

**Type:** SIM **Priority:** P0

**Steps**
- Repeat TC-PROJLC-007 through -009 substituting `secondary_evaluator_id` for `reports_to_id`.

**Expected**
- Behaviour mirrors PM change exactly. Both evaluator types should follow the same draft-transfer / submitted-immutable rules.

---

## TC-PROJLC-011 — Complete project mid-cycle: stop next-cycle generation

**Type:** SIM **Priority:** P0

**Steps**
1. `simulated_today=2026-12-15`. Active=`H2 FY26-27`.
2. As `admin.std`, mark Project Beta `status=completed`, `completion_date=2026-12-15`.
3. Advance `simulated_today=2027-04-01`. Active=`H1 FY27-28`.
4. Inspect new-cycle review generation.

**Expected**
- No new H1 FY27-28 review rows for Project Beta.
- PM `pm.alpha` does not see Project Beta in their next-cycle Evaluate Team.

---

## TC-PROJLC-012 — Completed project: historical reviews still visible

**Type:** API **Priority:** P0

**Steps**
1. Project Beta completed per TC-PROJLC-011.
2. As `mentee.one` (member of Beta), My Reviews tab.
3. As `pm.alpha`, "Past Projects" filter or All Time.

**Expected**
- Beta reviews from H1 + H2 FY26-27 remain visible to both roles.
- "Project complete" badge or visual cue on the project name where shown.

---

## TC-PROJLC-013 — Completed project: PM finishes pending current-cycle reviews

**Type:** SIM **Priority:** P0

**Steps**
1. `simulated_today=2026-11-01`. Project Beta active. `pm.alpha` has a `pending` H2 review for `mentee.one`.
2. Admin marks Project Beta `completed` on `2026-11-15`.
3. `simulated_today=2026-12-01`. Still H2. As `pm.alpha`, attempt to submit the pending H2 review.

**Expected**
- Submit succeeds — current-cycle reviews must always be completable even if the project is marked complete, as long as the cycle window is open.
- After cycle closes (e.g. `simulated_today=2027-04-01`), submission rejected per `is_review_window_open()`.

---

## TC-PROJLC-014 — Reactivate completed project resumes generation

**Type:** SIM **Priority:** P1

**Steps**
1. Project Beta `status=completed` since `2026-12-15`.
2. Admin sets `status=active`, `completion_date=null` on `2027-05-01`.
3. `simulated_today=2027-05-15`. Active=`H1 FY27-28`.
4. Inspect review generation.

**Expected**
- New H1 FY27-28 PM review rows are generated for current members.
- Gap cycles (i.e. H1 wasn't generated retroactively for the dormant period) — no retro generation.

---

## TC-PROJLC-015 — Hard archive preserves history

**Type:** API **Priority:** P1

**Steps**
1. If the system supports hard-archival (separate from `completed`), trigger it on Project Gamma.
2. Inspect Gamma's historical reviews via Admin → Reviews.
3. Inspect via /project_reviews export.

**Expected**
- Archived project name shown with badge.
- Reviews preserved and exportable.
- If "hard archive" doesn't exist, document that and skip this TC (it's a system-design verification, not a defect).

---

## TC-PROJLC-016 — Staff on 3 concurrent projects

**Type:** API **Priority:** P0

**Steps**
1. `mentee.one` is on Projects Alpha, Beta (member only).
2. Add `mentee.one` to Gamma as member.
3. As `mentee.one`, GET `/project_reviews/me` for current cycle.

**Expected**
- 3 PM-review rows (one per project where `mentee.one` is a member): Alpha (pm.alpha), Beta (pm.alpha), Gamma (pm.beta).
- If `mentee.one` is also a Secondary Evaluator anywhere, additional rows would appear in `/project_reviews/secondary_for_me`.

---

## TC-PROJLC-017 — Multi-project + multi-cycle filtering

**Type:** API **Priority:** P1

**Steps**
1. With multi-cycle data (Alpha across H1+H2 FY26, Beta only H2 FY26).
2. GET `/project_reviews/me?cycle_name=H1+FY26-27` → expect Alpha-H1 only.
3. GET `?cycle_name=H2+FY26-27` → expect Alpha-H2 + Beta-H2.
4. GET `?project_id=Alpha` → expect both Alpha cycles.
5. GET `?project_id=Alpha&cycle_name=H1+FY26-27` → expect Alpha-H1 only.

**Expected**
- All four queries return the precise subset.
- Pagination metadata correct.
- No leakage of other staff's reviews.

---

## TC-PROJLC-018 — Project active across FY: prev FY reviews lock; new FY starts fresh

**Type:** SIM **Priority:** P0

**Steps**
1. Project Alpha active in FY26 and FY27.
2. After rollover (continuing the cycle playbook TC-CYCLE-009 setup), inspect.

**Expected**
- All FY26 ProjectReviews → status frozen (cannot be edited).
- New `H1 FY27-28` PM + Secondary rows generated for active members.
- `cycle_name` columns match active cycle at generation time.

---

## TC-PROJLC-019 — Feature flag `project_reviews`=false hides UI, preserves data

**Type:** API + MANUAL **Priority:** P0

**Steps**
1. As `admin.mgmt`, remove `project_reviews` from `enabled_features`.
2. As any user, refresh.

**Expected**
- Sidebar `Project Reviews` item gone.
- Direct URL `/project-reviews` redirects.
- API endpoints under `/project_reviews/*` return 403 (or 404 if the route is hidden entirely behind feature gate).
- DB unchanged; re-enabling feature restores everything.

---

## TC-PROJLC-020 — PM submit triggers notification to staff

**Type:** API + MANUAL **Priority:** P1

**Steps**
1. As `pm.alpha`, submit a review for `mentee.one` on Project Alpha.
2. As `mentee.one`, refresh bell.

**Expected**
- One notification: "pm.alpha submitted a project review for you on Project Alpha".
- Click → opens My Reviews tab filtered to that project + cycle.
- Mentor of `mentee.one` (i.e. `mentor.alpha`) does NOT get this notification (PM reviews are PM↔staff, not routed via mentor).

---

## 4.99 Suite-level sanity

After the full project-lifecycle suite:

1. No `ProjectReview` rows with `target_id == evaluator_id` (self-review on project is forbidden).
2. No `ProjectReview` for a `(target, project)` pair if the target wasn't a member during that cycle.
3. No duplicate `(project_id, target_id, evaluator_id, cycle_name)` rows.
4. Every `evaluator_id` references a user who was the project's PM **or** Secondary at the time of the review's `created_at`.

---

## Companion docs

- [02-cross-module-sync-tests.md](02-cross-module-sync-tests.md) — broader inter-module sync.
- [03-cycle-simulation-playbook.md](03-cycle-simulation-playbook.md) — date-travel mechanics.
- [05-edge-cases-and-validation-gaps.md](05-edge-cases-and-validation-gaps.md) — adjacent validation gaps.
