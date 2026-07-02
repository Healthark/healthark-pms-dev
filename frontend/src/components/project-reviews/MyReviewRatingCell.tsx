import { Lock } from "lucide-react";
import type { MyProjectCard } from "../../services/project-review.service";
import { PerformanceRatingBadge } from "../reviews/PerformanceRatingBadge";

/**
 * Rating cell for the employee's own "My Reviews" table.
 *
 * A project rating is shown to the reviewed employee only when BOTH hold:
 *   1. the PM has completed the evaluation (review_status === "reviewed"), and
 *   2. the admin has published ratings for the cycle (projectRatingsVisible).
 *
 * A saved-but-unsubmitted PM draft must never surface here (the reported leak):
 * until the review is `reviewed` we render an em dash regardless of the
 * visibility toggle, so a draft rating can't slip through when an admin has
 * "View ratings" enabled. Once reviewed, the toggle decides badge vs. "Hidden".
 */
export function MyReviewRatingCell({
  card,
  projectRatingsVisible,
}: {
  readonly card: MyProjectCard;
  readonly projectRatingsVisible: boolean;
}) {
  const isReviewed = card.review_status === "reviewed";

  // No rating exists until the PM submits — never leak a draft, toggle or not.
  if (!isReviewed) {
    return <span className="text-[12px] text-text-muted">—</span>;
  }
  // The rating exists, but the admin hasn't published it to team members yet.
  if (!projectRatingsVisible) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-text-muted/60">
        <Lock className="h-3 w-3" /> Hidden
      </span>
    );
  }
  return <PerformanceRatingBadge value={card.performance_group} />;
}
