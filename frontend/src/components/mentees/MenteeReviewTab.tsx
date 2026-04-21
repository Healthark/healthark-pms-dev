import { FileText } from "lucide-react";
import type { AnnualReview } from "../../services/annual-review.service";

interface MenteeReviewTabProps {
  // Accepted for API compatibility with the detail page; intentionally
  // unused until the full review view is designed. Backend still sends the
  // data — we're just not rendering it yet.
  readonly reviews: AnnualReview[];
  readonly menteeName: string;
}

export function MenteeReviewTab(_: MenteeReviewTabProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-surface px-6 py-10 text-center">
      <FileText className="h-6 w-6 text-text-muted" aria-hidden="true" />
      <p className="text-sm font-medium text-text-main">
        No annual reviews available
      </p>
      <p className="text-xs text-text-muted">
        This view will be built out in a later iteration.
      </p>
    </div>
  );
}
