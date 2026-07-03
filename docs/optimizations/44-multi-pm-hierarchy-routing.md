# 44 — Multi-PM hierarchy: capture + hierarchy-aware review routing

Branch `feat/multi-pm-hierarchy-model`. This PR merges both phases of the
multi-PM work: PR1 (capture the hierarchy) and PR2 (route evaluations through
it). Before this, a project had exactly one Project Manager who evaluated every
member; a project can now split its team into a PM chain of arbitrary depth.

## The model (from PR1)

`Project.multi_pm_enabled` toggles the mode. Per member, on `ProjectAssignment`:

- `manager_id` — the PM who evaluates **this** member (any org user). `NULL`
  marks a "root" — a top-level member with no PM of their own.
- `secondary_evaluator_id` — the member's own Secondary evaluator (any org user).

The top PM(s) stay flagged `evaluator_type = "Primary"` so existing "the
project's PM" displays (lists, exports, dashboards, mentee view) keep working;
sub-PMs are ordinary members pointed at via `manager_id`.

## Routing (PR2) — what changed

Evaluation routing is now **mode-aware**. Single-PM projects keep the exact
prior behaviour (routing keyed on `evaluator_type == "Primary"` + the
project-level secondary); multi-PM projects route on the per-member links:

| Surface | Single-PM (unchanged) | Multi-PM (new) |
| --- | --- | --- |
| PM queue / evaluate | the one Primary reviews everyone | a PM reviews only their **direct** reports (`manager_id == me`) |
| Reports-to queue / evaluate | reviews the one Primary | reviews **every root** (`manager_id IS NULL`) |
| Secondary queue / submit | project-level `secondary_evaluator_id` | per-member `ProjectAssignment.secondary_evaluator_id` |
| View / edit auth | current Primary | the member's direct manager |
| `/mine` PM name | the Primary | the member's manager (or reports-to for a root) |

The key rule: **direct managers only**. In a chain `A → B → C`, A reviews B and
B reviews C — A never reviews C. This is enforced in the PM queue (`manager_id`
match), the submit/draft auth gate (`_authorize_member_evaluation`), and the
view/edit checks (`_is_member_pm`).

### Design decisions (relaxed from PR1's validators)

- **A member's PM may be any org user**, not just a project member. A non-member
  PM has no review of their own on the project but still sees the member in
  their PM queue. (The "PM must be a member" rule was dropped; org membership is
  still validated at the route layer.)
- **Multiple roots are allowed** (including a flat team with no central PM).
  "PM Reports To" reviews every root. Where a single "project PM" must be shown,
  the first root is used.
- **"PM Reports To" may also be one of the project's PMs.** No one ever reviews
  themselves — the routing layer skips any self-pair.

Cycle detection (member → member edges) and the "can't manage / be secondary to
yourself" rules are kept.

## API change

The reports-to write endpoints now target a specific reviewee:

- `POST /project-reviews/reports-to/{project_id}/evaluate/{user_id}`
- `PATCH /project-reviews/reports-to/{project_id}/evaluate/{user_id}/draft`

(previously no `{user_id}` — the single Primary was resolved server-side). The
frontend service / query hooks / `PMEvaluationTab` pass `card.user_id`.

## Migration

None new. PR1's migration `a3f5c8e21b90` already added the columns and
backfilled `manager_id = the current Primary` for existing single-PM members;
that data is now consumed by the routing above.

## Tests

- `backend/tests/test_project_multi_pm_routing.py` (new, 11 cases): direct-report
  scoping, non-member PM, multiple roots, reports-to self-skip, per-member
  secondary.
- `backend/tests/test_project_multi_pm.py`: validator tests flipped to the
  relaxed rules (non-member PM, multiple roots, reports-to overlap now allowed).
- `backend/tests/test_project_review_reports_to.py`: single-PM flow updated for
  the new `{user_id}` signature (behaviour unchanged).
- `frontend/.../project-review.service.test.ts` (new): reports-to URL shape.
- Full suites green: 344 backend, 157 frontend.
