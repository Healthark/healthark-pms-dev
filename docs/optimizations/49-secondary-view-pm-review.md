# 49 — Secondary evaluator sees the PM's review as reference

The Secondary evaluator can now read the Project Manager's finalized review —
the 7 competency comments, the PM's overall review, and the rating — directly
inside the Impact modal, as read-only reference while they write their own
Overall Review.

This completes the progression from
[48](48-secondary-eval-pm-gate-and-submit-confirm.md): now that a Secondary
can only *submit* once the PM has (the PM-first gate), it follows that the PM's
evaluation should be visible to the Secondary at that point — so their overall
review is informed rather than a blind guess.

## The problem

After [48] the Secondary was blocked from submitting until the PM's review was
`REVIEWED`, but the modal still showed them nothing about *what the PM said*.
The queue card exposed only the PM's rating (a single 1–5 badge). The
Secondary had to leave the tab and hunt for the PM's evaluation elsewhere — or,
more likely, write their statement without it.

## No backend change needed

The read path already exists. `GET /project-reviews/{review_id}` (`get_review`)
authorizes the member's Secondary evaluator (`_is_member_secondary`) and returns
the full `ProjectReviewResponse` — the competency comments and the PM's impact
statement included. The Secondary queue card already carries `review_id` and
`pm_submitted`. So this is a **frontend-only** wiring change.

One deliberate split on the **rating**:

- `get_review`'s `performance_group` runs through `_visible_performance_group`,
  the *employee-facing* per-FY visibility gate — so for a Secondary in the
  active FY it's `None` unless the org has toggled `project_ratings_visible` on.
- The Secondary is a **reviewer**, not the rated employee. The secondary-queue
  card therefore exposes the rating ungated the moment the review is `REVIEWED`
  (established in [47]/[48]).

So the modal takes the **comments + overall review** from `get_review` (never
rating-gated) and the **rating** from the queue card. Sourcing the rating from
the card keeps the modal consistent with the Rating column the Secondary
already sees in the same queue.

The PM's in-progress *draft* is never shown: the fetch is gated on
`pm_submitted` (review `REVIEWED`), matching the same signal that already gates
the Secondary's Submit and the card's rating.

## Frontend

- **`ImpactModal`** gains three optional props — `pmReview`
  (`ProjectReviewResponse | null`), `pmReviewLoading`, and `pmRating`. When the
  PM has submitted it renders a read-only **"Project Manager's Review"** section
  above the Secondary's field: the rating badge (from `pmRating`), the PM's
  competency comments (reusing `CompetencyBlock` in `compact` mode, no role
  expectations), and the PM's Overall Review. It shows a loading line while the
  review is fetched, and nothing at all before the PM submits. The modal widens
  to `max-w-2xl` and its body scrolls (`max-h-[90vh]`, flex column) only when the
  reference section is present; the plain write-only case keeps its `max-w-md`.
  The reference also renders in read-only (view) mode.
- **`PMEvaluationTab`** fetches the PM review for the open Secondary row via the
  existing `useProjectReviewDetail(reviewId)` hook, gating the `reviewId` on
  `type === "secondary" && pm_submitted` (so the query is disabled otherwise),
  and threads `pmReview` / `pmReviewLoading` / `pmRating` (the card's
  `performance_group`) into `ImpactModal`. No new query key or service method —
  it reuses the review-detail cache the My Reviews / EvalModal surfaces share.

No changes to `project-review.service.ts` or the query layer.

## Tests

- `ImpactModal.test.tsx`: +4 — the PM review block shows the PM's competency
  comments, overall review, and card-sourced rating once submitted; a loading
  line renders while fetching; the block is absent before the PM submits; and it
  still renders (without the "use as reference" helper) in read-only mode.
- `test_secondary_eval_before_pm.py`: +1 — once the PM submits, the Secondary
  can read the PM's finalized review (all 7 comments + impact + reviewer name)
  via `get_review`; asserts the rating is `None` through that path (gated) while
  the queue card carries it (`pm_submitted`, `performance_group == "4"`) —
  codifying the two-source contract the modal relies on.

## Verification

- Backend: `pytest -q` (green; ruff clean on changed files).
- Frontend: `vitest run` (green); `tsc -b --noEmit` clean; eslint clean on
  changed files.
