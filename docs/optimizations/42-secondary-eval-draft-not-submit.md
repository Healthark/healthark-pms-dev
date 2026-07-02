# 42 — Secondary Evaluator "Save Draft" no longer reads as submitted

## Context

On the Project Reviews → **Evaluate** tab, a Secondary Evaluator (Team Eval)
writes an Impact Statement via the `ImpactModal`, which offers **Save Draft**
and **Submit**. Clicking **Save Draft** made the row flip to **Submitted** and
lock read-only — as if it had been submitted. It also read to the user as
"both actions fired" (a *Draft saved* toast, yet the item then showed as
Submitted).

Neither the modal nor the backend was actually wrong:
- `ImpactModal` wires Save Draft → `onSaveDraft` only and Submit → `onSubmit`
  only; both are `type="button"`. No double-fire.
- The backend correctly writes `EvaluatorStatus.DRAFT` on
  `PATCH /project-reviews/{id}/secondary/draft` and `SUBMITTED` on
  `POST /project-reviews/{id}/secondary`, and returns `status` on the response.

## Root cause

`PMEvaluationTab`'s row builder classified a secondary row purely on the
*presence* of the evaluator's `secondary_evaluation`, ignoring its `status`:

```ts
const myEval = r.secondary_evaluations?.find(ev => ev.evaluator_id === currentUserId);
review_status: myEval ? "submitted" : "pending",   // ← BUG
```

Saving a draft creates a `status: "draft"` evaluation row (returned to its
author by `get_review`). On the next refetch `myEval` became truthy, so
`review_status` was set to `"submitted"` → the table showed **Submitted** and
`setViewOnly(review_status === "submitted")` locked the modal. The service type
even documents the intent: `SecondaryEvalResponse.status` — *"The frontend
gates editability on this."* — but this call site didn't.

## Fix (frontend only)

- New `utils/secondaryReviewStatus.ts` → `resolveSecondaryRowStatus(evals, userId)`:
  returns `{ review_status, has_draft_content, existing_impact }`. A draft →
  `review_status: "pending"` + `has_draft_content: true` (same representation as
  the PM draft flow); only `status === "submitted"` → `"submitted"`.
- `PMEvaluationTab` uses the helper to build secondary rows, and `rowHasDraft`
  now applies to any row with `has_draft_content` (PM, reports-to, **and**
  secondary) so a secondary draft shows the **Draft** pill, stays editable, and
  re-opens with the saved text plus Save Draft + Submit still available.

## Tests
- `utils/__tests__/secondaryReviewStatus.test.ts` (6): draft → pending + draft
  flag (the regression); submitted → submitted; no eval → pending; other
  evaluators' rows ignored; null impact text; undefined array.

## Verification
- `vitest run` → **142 passed** (29 files); `tsc -b --noEmit` clean; `eslint`
  clean on changed files.
- Manual: as a Secondary evaluator, Write Impact → **Save Draft** → the row
  shows **Draft** (not Submitted) and stays editable; re-open shows the saved
  text with Save Draft + Submit; **Submit** finalizes to Submitted (locked).

## Note
`SecondaryEvalTab.tsx` carries the same presence-only `getMySubmission` pattern
but is dead code (defined, never rendered — the Evaluate tab delegates to
`PMEvaluationTab`). Left untouched; worth deleting in a cleanup pass.
