import { Lock } from "lucide-react";

/**
 * Explicit "withheld by an admin visibility toggle" state for a rating cell.
 *
 * A rating that is null *because a visibility toggle is off* must read as
 * "Hidden", NOT as "Not rated yet" / "—" — otherwise a deliberately withheld
 * rating looks like the reviewer simply hasn't rated yet. Shared by the
 * employee self-view (SelfReviewTab) and the mentor Team Review tab so both
 * surfaces render the withheld state identically.
 */
export function RatingHiddenBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-muted/60">
      <Lock className="h-3 w-3" aria-hidden="true" /> Hidden
    </span>
  );
}
