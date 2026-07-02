# 41 — Mentor Team Review shows "Hidden" (not "Not rated yet") for withheld ratings

## Context

When an Admin turns the per-FY **final/management rating visibility** toggle
OFF (`annual_review_final_rating_visible`), the backend `get_mentee_reviews`
endpoint nulls `management_performance_rating` / `final_performance_rating` in
the payload — deliberately, so the value is withheld from the mentor until
management publishes it. Its docstring says the nulling exists "so the Mentee
Review tab can conditionally hide the Ratings column."

But the consuming component — the mentor's **Team Review** tab
(`TeamReviewTab.tsx`) — never read that toggle. It only checked
`management_performance_rating != null`, so a *withheld* rating (null-by-toggle)
fell through to the generic **"Not rated yet"** placeholder. To a mentor that
reads as "management hasn't rated this yet", when the truth is "the rating
exists but is currently hidden." The employee's own view (`SelfReviewTab`)
already handled this correctly with a "Hidden" badge; the mentor view did not.

## Root cause
Null-value ambiguity: a rating is null both when it is *genuinely unrated* and
when it is *withheld by a visibility toggle*. `TeamReviewTab` collapsed both to
"Not rated yet" because it didn't consult the toggle. `SelfReviewTab` avoided
this by reading `annual_review_final_rating_visible`.

## Fix (frontend only — backend already withholds correctly)
- New `components/reviews/RatingHiddenBadge.tsx` — the shared "Hidden" (Lock)
  badge, extracted from `SelfReviewTab`'s private `FinalRatingHiddenBadge` so
  both surfaces render the withheld state identically.
- New `components/reviews/RatingCell.tsx` — one cell, three mutually-exclusive
  states: value present → badge; null + `hiddenWhenEmpty` → **Hidden**; null +
  not hidden → **Not rated yet**. Value-present always wins, so a still-visible
  past-FY rating renders even if the current toggle is off.
- `TeamReviewTab.tsx` — reads `annual_review_final_rating_visible` via
  `useSystemSettings()` and renders all three rating columns through
  `RatingCell`. Only the **Management Rating** column passes
  `hiddenWhenEmpty={!finalRatingVisible}`; Self and the mentor's own rating are
  never withheld by this endpoint, so they keep the plain value-or-"Not rated
  yet" behavior.
- `SelfReviewTab.tsx` — now imports the shared `RatingHiddenBadge` (dropped its
  local copy); behavior unchanged.

## Tests
- `components/reviews/__tests__/RatingCell.test.tsx` (4): value present →
  badge even when `hiddenWhenEmpty`; null + hidden → "Hidden"; null + not
  hidden → "Not rated yet"; default (no `hiddenWhenEmpty`) → "Not rated yet".
- Existing `SelfReviewTab.test.tsx` (6) still green — the badge refactor is
  render-identical.

## Verification
- `vitest run` → **140 passed** (29 files); `tsc -b --noEmit` clean; `eslint`
  clean on changed files.
- Manual: with the final-rating toggle OFF, the mentor's Team Review tab shows
  a "Hidden" badge in the Management Rating column instead of "Not rated yet";
  turning it ON reveals the value; a genuinely unrated review still shows "Not
  rated yet".

## Related (not fixed here)
`MenteeReviewTab` (Mentee Detail → Reviews) reads `/mentees/{id}/reviews`, which
does **not** null the management rating, so a mentor sees the real value there
even when the toggle is off — an inconsistency (mild over-exposure) worth a
follow-up so the two mentor surfaces agree.
