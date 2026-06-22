/**
 * ReviewDetailLoader — fetches a single annual review by id and renders it in
 * the read-only AnnualReviewDetailModal.
 *
 * The list surfaces (calibration grid, All Reviews tab) carry only the slim
 * CalibrationRow — names, ratings, status — not the narrative text. This
 * wrapper fetches the full review via GET /annual-reviews/{id} on open and
 * hands it to the modal. Shared by ManagementReviewTab and AllReviewsTab so
 * the "View" affordance behaves identically on both.
 */

import { useAnnualReviewDetail } from "../../queries/annualReviews";
import { getErrorMessage } from "../../utils/errors";
import { formatFyLabel } from "../../utils/fy";
import { AnnualReviewDetailModal } from "./AnnualReviewDetailModal";

interface ReviewDetailLoaderProps {
  readonly reviewId: number;
  readonly onClose: () => void;
}

export function ReviewDetailLoader({ reviewId, onClose }: ReviewDetailLoaderProps) {
  // ['annual-reviews', 'detail', reviewId] — shared TanStack cache
  const { data: review, error: queryError } = useAnnualReviewDetail(reviewId);
  const error = queryError ? getErrorMessage(queryError) : "";

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
        <div className="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl">
          <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p>
          <div className="mt-3 text-right">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-surface-muted"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!review) return null;

  return (
    <AnnualReviewDetailModal
      review={review}
      title="Annual Review"
      subtitle={`Year: ${formatFyLabel(review.cycle_name)}`}
      onClose={onClose}
    />
  );
}
