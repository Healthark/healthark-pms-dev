# 48 — Secondary submit gated on the PM + a confirm before PM final submission

Two Project-Reviews changes shipped together:

1. **A Secondary evaluator can no longer submit before the PM.** They may still
   *draft* their Impact Statement anytime (before or after the PM), but can only
   *submit* once the member's PM evaluation is in. This is the same rule the
   Annual-Goals mentor review uses ("draft now, submit after the prior review
   lands" — the mentor can't submit until the mentee's self-review is in).
2. **The PM's final submission now asks for confirmation.** Submitting an
   evaluation locks it and makes it shareable with the employee, so the Evaluate
   Team flow pops a confirm dialog before it fires.

This narrows [46](46-secondary-eval-before-pm.md), which had let the Secondary
*submit* before the PM. Drafting-before-the-PM (and the lazy PENDING-review
creation that backs it) is unchanged — only the *submit* is now gated.

## The problem

[46](46-secondary-eval-before-pm.md) freed the Secondary from waiting on the PM
entirely, so a Secondary could finalize an Impact Statement before the PM had
even rated the member. The desired policy is the middle ground: let the
Secondary get a head start (draft) without letting their submitted feedback
pre-empt the PM's evaluation.

## Backend — `project_review_routes.py` / `project_review_schemas.py`

- **`submit_secondary_evaluation`** now looks up the `(project, member, cycle)`
  `ProjectReview` directly and rejects with **400** unless it's `REVIEWED`
  (i.e. the PM — or, for a root PM, the reports-to senior; or the member's
  direct manager in multi-PM — has submitted). No review row, or a
  pending/draft one, means "PM not submitted yet." The rejected path creates
  **nothing** (it no longer calls `_get_or_create_secondary_review`), so a
  blocked submit leaves no placeholder review or evaluator row.
- **`save_secondary_draft`** is untouched — drafting still works before the PM
  and still lazily creates the reviewer-less PENDING parent review. The auth
  guards (`_authorize_secondary_write`) run *ahead* of the new gate, so a
  non-secondary / non-member / ineligible caller still gets 403/404 rather than
  the 400.
- **`SecondaryEvalCard.pm_submitted`** (new `bool`) tells the frontend whether
  the member's PM evaluation is in, so the modal can disable Submit with a
  reason instead of erroring after the fact. It reuses the same
  `status == REVIEWED` signal that already drove the card's rating visibility.

No schema/DB migration — the gate is a status check on existing columns.

## Frontend

- **`ImpactModal`** takes a `pmSubmitted` prop. When the PM hasn't submitted
  (and the row isn't already a submitted one being edited), Submit is disabled
  with a tooltip and an amber note — *"You can save a draft now, but you can
  only submit your review once the Project Manager has submitted their
  evaluation for this team member."* Save Draft stays enabled. Mirrors
  `GoalMentorReviewModal`'s self-review-pending treatment.
- **`PMEvaluationTab`** threads `pm_submitted` from the secondary card onto the
  row and into `ImpactModal`, and wraps the **Primary** and **Reports-To** PM
  submit handlers in a `useConfirm` dialog (*"Submit evaluation? Once submitted,
  {name}'s evaluation is finalized and can be shared with them…"*). Cancel keeps
  the modal open with no error; the confirm reuses the app-wide `ConfirmDialog`
  (z-70, so it layers over the open `EvalModal`). The Secondary submit is not
  confirmed — it's the lighter action and is already governed by the PM gate.
- `project-review.service.ts`: `SecondaryEvalCard` gains `pm_submitted: boolean`.

## Tests

- `backend/tests/test_secondary_eval_before_pm.py` rewritten for the new
  policy: draft-before-PM still creates the PENDING review; **submit-before-PM
  → 400 and persists nothing**; submit unlocks once the PM is `REVIEWED`; the
  early *draft* stays hidden from PM/mentee (visible to its author); the PM
  promote preserves the draft; the completed-project 409 now guards the *draft*
  path; multi-PM per-member draft→(PM)→submit. Plus `pm_submitted` assertions
  on the queue cards.
- `test_secondary_queue_department_rating.py`: the "rating hidden while pending"
  case now seeds via `save_secondary_draft` (submit is gated) and asserts
  `pm_submitted` on both the hidden and visible cases.
- `test_project_multi_pm_routing.py`: unchanged — its secondary cases already
  PM-evaluate first, so they pass the new gate as-is.
- `ImpactModal.test.tsx`: +3 — Submit blocked + note shown when
  `pmSubmitted=false` (Save Draft still enabled), Submit enabled when true, and
  an already-submitted row stays editable regardless of the flag.

## Verification

- Backend: **391 passed** (`pytest -q`); ruff clean on changed files.
- Frontend: **189 passed** (`vitest run`); `tsc -b --noEmit` clean; eslint clean
  on changed files.
