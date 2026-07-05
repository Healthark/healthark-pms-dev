# 46 — Secondary evaluator can write an Impact Statement before the PM

Two changes shipped together:

1. **Secondary evaluation no longer waits for the PM.** A Secondary evaluator
   can now add (draft or submit) their Impact Statement for a team member
   *before* the PM has completed that member's review.
2. **"Evaluate Team" table header** renamed **Employee → Member**
   ([PMEvaluationTab.tsx](../../frontend/src/components/project-reviews/PMEvaluationTab.tsx)).

## The problem (secondary eval)

The Secondary flow was gated on the PM finishing first: the queue only listed
`status == reviewed` reviews, and the write routes were keyed on a `review_id`
that didn't exist until the PM created the row. A Secondary who wasn't on the
team therefore saw an empty tab and had no way to write until the PM acted.

## Backend

`backend/app/api/routes/project_review_routes.py`

- **Queue** (`GET /project-reviews/secondary-queue`) now returns a new
  `SecondaryEvalCard[]` (was `ProjectReviewResponse[]`): one card per member the
  caller is Secondary for, across all cycles, plus an **active-cycle placeholder**
  (`review_id: null`) when no review row exists yet. Each card carries the
  SECONDARY's own progress (`review_status` pending/submitted, `has_draft_content`,
  `existing_impact`) — the backend classifies it, so the frontend no longer
  derives draft-vs-submitted itself.
- **Write routes re-keyed on `(project_id, user_id)`** (mirrors the reports-to
  redesign in [44](44-multi-pm-hierarchy-routing.md)):
  - `POST   /project-reviews/{project_id}/secondary/{user_id}`
  - `PATCH  /project-reviews/{project_id}/secondary/{user_id}/draft`
  - `PUT    /project-reviews/{project_id}/secondary/{user_id}`

  A write **lazily creates a reviewer-less PENDING** `ProjectReview` when none
  exists, so the impact has a row to hang off. The PM's later evaluate finds the
  same `(user, project, cycle)` row and promotes it to REVIEWED — impact preserved
  (that promotion path already existed in `submit_pm_evaluation`).
- **No early leak.** `_build_review_response` now hides a SUBMITTED secondary
  impact from everyone except its author until the review is REVIEWED. In the
  classic flow (secondary writes after the PM) the review is already REVIEWED, so
  this is a no-op there.
- Shared guards `_authorize_secondary_write` + `_get_or_create_secondary_review`
  centralise the project/eligibility/secondary/self/member checks and the lazy
  PENDING-row creation (409 on a completed project).

No schema/DB migration — `ProjectReview.reviewer_id` and all PM comment columns
were already nullable, and the `(org, user, project, cycle)` unique index makes
the get-or-create safe.

## Frontend

- `project-review.service.ts`: new `SecondaryEvalCard` type; the three secondary
  calls now take `(projectId, userId, payload)` and hit the new URLs.
- `queries/projectReviews.ts`: the secondary mutations take
  `{ projectId, userId, payload }`; `useSecondaryQueue` returns `SecondaryEvalCard[]`.
- `PMEvaluationTab.tsx` (the live "Evaluate Team" tab): builds secondary rows
  straight from the card fields; the write handlers pass `(projectId, userId)`.
- `ImpactModal.tsx`: `ImpactModalRow` carries `project_id` / `user_id` instead of
  a `secondaryReview` object; the buttons POST/PATCH by `(project, user)`.
- **Removed dead code**: `SecondaryEvalTab.tsx` (never imported — the live UI is
  `PMEvaluationTab`) and the now-superseded `utils/secondaryReviewStatus.ts`
  (+ its test); status classification moved server-side.

## Notes / limitations

- Secondary **writes target the active cycle**. Historical (past-cycle) submitted
  impact still renders in the queue as view-only, consistent with the PM flow.
- The dashboard `project_reviews_pending_secondary` badge still counts the
  caller's own DRAFT rows (unchanged) — it reflects drafts-in-progress, not
  not-yet-started members.

## Tests

- `backend/tests/test_secondary_eval_before_pm.py` (12 cases): queue placeholders
  before the PM, submit/draft lazily create a PENDING review, no early leak, PM
  promote-and-preserve, and the auth guards (non-secondary, self, non-member,
  ineligible project, completed project, multi-PM per-member). Adapted from the
  deferred spec to master's project-level `review_eligible` (the old per-member
  `review_included` column is gone).
- `backend/tests/test_project_multi_pm_routing.py`: secondary cases updated to the
  `(project, user)` signature.
- `frontend/.../project-review.service.test.ts`: +3 cases asserting the new
  secondary URL shapes.
- Full suites green: **382 backend**, **178 frontend**.
