import { PerformanceRatingBadge } from "./PerformanceRatingBadge";
import { RatingHiddenBadge } from "./RatingHiddenBadge";

/**
 * One rating cell in a reviews table, with three mutually-exclusive states:
 *
 *   1. value present            → the rating badge
 *   2. value null + hidden      → "Hidden"        (withheld by a visibility toggle)
 *   3. value null + not hidden  → "Not rated yet" (genuinely not evaluated)
 *
 * `hiddenWhenEmpty` lets the caller distinguish (2) from (3): pass the negation
 * of the relevant visibility toggle (e.g. `!annual_review_final_rating_visible`)
 * for a toggle-gated column, or `false` for a column the backend never withholds
 * (self / the mentor's own rating). This is why a value that IS present always
 * wins — a still-visible past-FY rating renders even if the current toggle is
 * off.
 */
export function RatingCell({
  value,
  hiddenWhenEmpty = false,
}: {
  readonly value: number | null | undefined;
  readonly hiddenWhenEmpty?: boolean;
}) {
  if (value != null) {
    return <PerformanceRatingBadge value={value} />;
  }
  if (hiddenWhenEmpty) {
    return <RatingHiddenBadge />;
  }
  return (
    <span className="text-[11px] italic text-text-muted">Not rated yet</span>
  );
}
