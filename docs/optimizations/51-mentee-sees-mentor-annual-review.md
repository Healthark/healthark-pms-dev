# 51 — Mentee sees the mentor's annual review on submit + dynamic-size text boxes

On **Annual Reviews → My Review**, the mentee can now read the mentor's written
review as soon as the mentor submits their evaluation — presented in the same
read-only detail layout the mentor's own evaluation form uses. Long reviews no
longer overflow their containers: the editable review boxes grow to fit their
content and cap with an inner scrollbar, and read-only bodies wrap on long
tokens.

## What the mentee sees now

The backend already sends the mentor's **written** review
(`mentor_overall_review`) to the mentee from the `pending_management` stage
onward — `_strip_private_ratings` never stripped the text; it only gates the
numeric mentor **rating** behind the per-FY `annual_review_mentor_rating_visible`
toggle. But `AnnualReviewDetailModal` keyed the whole mentor section on the
rating (`showMentor = mentor_performance_rating != null`), so with the rating
gate closed the mentee never saw the written review either — it stayed hidden
until an admin flipped the toggle.

The two are now **decoupled**:

| Mentor state (mentee's view) | Mentor Review text | Mentor Rating slot |
| --- | --- | --- |
| Not submitted (`pending_mentor`) | hidden | hidden |
| Submitted, rating gated off | **shown** | **"Hidden"** (withheld badge) |
| Submitted, rating gate open / past FY | **shown** | rating badge |

So the mentor's qualitative feedback surfaces immediately on submit; the numeric
rating keeps its existing, intentional admin control (surfaced as the explicit
`RatingHiddenBadge` "Hidden" state, consistent with the My Review table columns)
rather than silently hiding the whole review.

## Frontend

- **`AutoGrowTextarea`** (new, `components/common/`) — a drop-in controlled
  `<textarea>` that resizes to its content between `minRows` and `maxRows`, then
  scrolls internally past the ceiling so a pathologically long entry can't blow
  the surrounding modal apart. Robust against jsdom/`"normal"` computed styles
  (non-finite parses coerce to 0).
- **`AnnualReviewDetailModal`** — mentor **Review** section now renders whenever
  `mentor_overall_review` is present (not gated on the rating). The summary's
  **Mentor Rating** slot shows the badge when the rating is present, else the
  `RatingHiddenBadge` "Hidden" state. Self- and mentor-review bodies gained
  `break-words` so long unbroken strings wrap instead of overflowing.
- **`SelfReviewFormModal`** (mentee self-review) and **`EvalForm`** (mentor
  evaluation) — the fixed `rows={10}` `resize-none` textareas are now
  `AutoGrowTextarea` (`minRows={10}`). `EvalForm`'s read-only self-review body
  also gained `break-words`.

The My Review row action stays the plain **View** button (a "Mentor review" cue
next to it was tried and dropped) — opening the detail modal is where the mentor
review now surfaces.

## Backend

No behavioural change — the mentee already received `mentor_overall_review` on
submit. Only the stale comment on the mentor-eval notification ("the mentee must
NOT see the rating/text yet") was corrected to describe the real contract: the
written review is visible on submit; only the rating stays gated.

## Tests

- `AnnualReviewDetailModal.test.tsx` (new) — written review shows with the rating
  gated off (rating slot reads "Hidden"); rating badge replaces "Hidden" once
  unblocked; the whole mentor section stays hidden before submit.
- `AutoGrowTextarea.test.tsx` (new) — forwards native props and starts at
  `minRows` with no inner scrollbar; caps at `maxRows` + `overflow-y: auto` past
  the ceiling; fires `onChange`; re-measures when the value grows.
- `test_annual_review_mentee_rating_visibility.py` — added
  `test_written_mentor_review_survives_while_rating_gated`: `_strip_private_ratings`
  keeps `mentor_overall_review` while nulling the rating and wiping the draft.

## Follow-up (not done here)

Making the numeric **mentor rating** visible on submit too would mean retiring or
bypassing the `annual_review_mentor_rating_visible` admin gate — a policy change
touching admin routes/schemas/UI, a migration, and the visibility tests. Left as
a deliberate, separate decision; today the rating keeps its admin control.

## Verification

- Frontend: `vitest run` on the affected suites green (21 tests); `tsc -b
  --noEmit` clean.
- Backend: `pytest -k annual_review` green (28 tests).
