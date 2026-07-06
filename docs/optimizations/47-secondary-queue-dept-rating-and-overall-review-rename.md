# 47 — Secondary queue Department + Rating fix, and "Impact Statement" → "Overall Review" rename

Two Project Reviews changes shipped together.

## A. Secondary Evaluator queue: Department + Rating not fetched

Symptom (Project Reviews → evaluation queue, logged in as a Secondary
Evaluator): the **Department** and **Rating** columns always showed "—" on
secondary rows.

### Root causes

- **Department** — never made it to the client. `SecondaryEvalCard` had no
  `department_name` field, the `/secondary-queue` builder never computed it,
  and the frontend hardcoded `department_name: null` on secondary rows
  ([PMEvaluationTab.tsx](../../frontend/src/components/project-reviews/PMEvaluationTab.tsx)).
  The PM / Reports-To queues, by contrast, resolve it from the member's
  assignment.
- **Rating** — the secondary queue ran the PM's rating through
  `_visible_performance_group`, the **employee-facing** per-FY redaction. The
  Secondary isn't the rating's author, so the rating was hidden in the active
  cycle unless an admin turned on the per-half "project ratings visible" toggle.
  The PM and Reports-To reviewer queues instead pass the rating through directly.

### Fix

- `SecondaryEvalCard` gains `department_name: Optional[str]`
  ([project_review_schemas.py](../../backend/app/schemas/project_review_schemas.py)).
- `get_secondary_evaluation_queue` now tracks each pair's `department_id` while
  building `ordered_pairs`, batch-loads `Department`, and fills
  `department_name` on every card.
- Rating rule changed to the **reviewer** convention: the Secondary sees the
  PM's rating once the PM finalises the review (`status == reviewed`); the PM's
  unsubmitted **draft** rating stays hidden. No longer gated by the
  employee-facing per-FY toggle.
- Frontend: `SecondaryEvalCard` type gains `department_name`; the secondary-row
  builder maps `r.department_name` instead of `null`.

Tests: `backend/tests/test_secondary_queue_department_rating.py` — department
reaches the card; rating hidden while the review is pending (even with a draft
rating set), visible once reviewed.

## B. Rename "Impact Statement" → "Overall Review"

Per request, the Project Reviews UI **and** the data-export column headers were
relabeled. Data keys / API fields / component names (`impact_statement`,
`ImpactModal`, `ImpactBlock`, …) are unchanged — this is display text only.

| Surface | Before | After |
|---|---|---|
| Secondary write button ([PMEvaluationTab](../../frontend/src/components/project-reviews/PMEvaluationTab.tsx)) | "Write Impact" | "Write Overall Review" |
| Save toast | "Impact statement saved." | "Overall review saved." |
| PM eval field ([EvalModal](../../frontend/src/components/project-reviews/EvalModal.tsx)) | "Overall Impact Statement" | "Overall Review" |
| Secondary field ([ImpactModal](../../frontend/src/components/project-reviews/ImpactModal.tsx)) | "Impact Statement" | "Overall Review" |
| Display block ([ImpactBlock](../../frontend/src/components/project-reviews/ImpactBlock.tsx)) | "Overall Impact Statement" | "Overall Review" |
| Detail modal ([ProjectReviewDetailModal](../../frontend/src/components/project-reviews/ProjectReviewDetailModal.tsx)) | "Manager's Impact Statement" / "Secondary Impact Statements" | "Manager's Overall Review" / "Secondary Overall Reviews" |
| Excel/CSV export headers ([exporters.py](../../backend/app/services/exporters.py)) | "Impact Statement" / "Secondary Impact Statements" | "Overall Review" / "Secondary Overall Reviews" |

Not changed (out of scope — different page): the Mentees → Annual Summary tab's
"Impact statement" label. The `docs/QA-Test-Cases-*` guides still reference the
old labels and can be refreshed separately.

Tests: `ProjectReviewDetailModal.test.tsx` asserts the renamed PM + secondary
section headers; `ImpactModal.test.tsx` asserts the renamed field label and
intact prefill.
