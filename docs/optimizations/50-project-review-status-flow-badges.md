# 50 — Project Review status badges as an explicit flow

The Status column on the Project Reviews **My Reviews** and **Evaluate Team**
tabs now reads as a single lifecycle:

> **Pending → Draft → PM Reviewed → Completed**

with a role-aware terminal and a secondary-only intermediate. This replaces the
older raw labels ("Reviewed" / "Submitted") that mirrored the DB status verbatim
and didn't line up between the two tabs.

## The labels

| Underlying state | Badge | Tone |
| --- | --- | --- |
| PM / reports-to review not started | **Pending** | amber |
| Any evaluator saved a draft | **Draft** | brand |
| PM / reports-to (primary) evaluation finalized | **PM Reviewed** | green |
| Secondary: PM's eval in, secondary not submitted yet | **PM Reviewed** | blue |
| Secondary impact statement submitted | **Completed** | green |

The terminal differs by role: a **PM / reports-to** evaluation ends **PM
Reviewed**; a **Secondary** impact statement ends **Completed**. The secondary
row also surfaces an intermediate **PM Reviewed** (blue — "your turn") once the
member's PM evaluation has landed (`pm_submitted`) but the secondary hasn't
drafted or submitted — so a secondary row reads
`Pending → (Draft | PM Reviewed) → (Draft | Completed)`. A saved draft always
wins over the PM-reviewed intermediate (it's the more specific signal of the
secondary's own progress).

Same label, two tones on purpose: **PM Reviewed** always means "the PM has
reviewed this member." It's green when that *is* the row's completion (a PM
row), blue when it's an intermediate the secondary still has to act on.

## Frontend

- **`evalStatusBadge.ts`** (new) — a pure `getEvalStatusBadge(row)` returning
  `{ label, tone, key }`. All the flow logic lives here so it can be unit-tested
  without rendering the (heavy) queue. `tone ∈ done | awaiting | draft |
  pending` drives colour/icon; `key ∈ pending | draft | pm_reviewed | completed`
  is the **filter bucket** (both PM-Reviewed variants share `pm_reviewed`).
- **`PMEvaluationTab`** (Evaluate Team) — the inline `isDone / rowHasDraft`
  ternary is replaced by `getEvalStatusBadge(r)`; a module-level
  `EVAL_STATUS_STYLES` maps `tone` → colour classes + icon. `isDone` is retained
  only for the View/Evaluate action button (unchanged). Net: "Submitted" →
  **Completed**, "Reviewed" → **PM Reviewed**, plus the blue **PM Reviewed**
  intermediate for secondary rows — which never falls back to **Pending** once
  the PM's evaluation is in, only advancing to **Completed** when the secondary
  submits.
  - The Status **filter** now buckets by `getEvalStatusBadge(r).key` — one
    line — so it can never drift from the rendered badge. Options went
    All / Pending / Draft / ~~Completed~~ → **All / Pending / Draft / PM
    Reviewed / Completed**. Previously a secondary "PM Reviewed" row filtered
    under "Pending" (its raw `review_status`); now it correctly filters under
    "PM Reviewed".
- **`ProjectReviews` (My Reviews)** — the reviewee's terminal badge "Reviewed" →
  **PM Reviewed** (the employee sees only Pending / PM Reviewed — they don't
  draft, and their card carries no secondary-submission signal, so there's no
  Draft/Completed state to show).
- **`MyReviewsToolbar`** — the Status filter option label "Reviewed" → **PM
  Reviewed**, reordered to flow order (Pending → PM Reviewed). The `reviewed`
  value is unchanged, so filtering is unaffected.

No backend, schema, or API change — labels are derived entirely from data the
queues already return (`review_status`, `has_draft_content`, `pm_submitted`).

## Tests

- `evalStatusBadge.test.ts` (new) — every branch of the flow: primary/reports-to
  `reviewed` → PM Reviewed (done); secondary `submitted` → Completed; draft wins
  for any role; secondary `pm_submitted` (no draft) → PM Reviewed (awaiting,
  never Pending); plain Pending; that `pm_submitted` elevates only secondary
  rows; and that both PM-Reviewed variants share the `pm_reviewed` filter key
  (badge ↔ filter alignment).

## Verification

- Frontend: `vitest run` green; `tsc -b --noEmit` clean; eslint clean on changed
  files.
