import { Clock, Loader2 } from "lucide-react";
import type {
  MyProjectCard,
  RoleExpectation,
} from "../../services/project-review.service";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { useProjectReviewDetail } from "../../queries/projectReviews";
import { getErrorMessage } from "../../utils/errors";
import { CompetencyBlock } from "./CompetencyBlock";
import { ImpactBlock } from "./ImpactBlock";

const TABLE_COLSPAN = 9;  // #, Project, Code, Dept, PM, Secondary Evaluator, Cycle, Status, Rating

/**
 * Inline expansion shown beneath a clicked My Reviews table row.
 * Uses the shared `useReviewDetails` hook so cascading-render
 * setStates inside `useEffect` are avoided.
 */
export function TableExpandedRow({
  card,
  expectations,
}: {
  readonly card: MyProjectCard;
  readonly expectations: RoleExpectation[];
}) {
  const { settings } = useSystemSettings();
  const projectRatingsVisible = settings?.project_ratings_visible ?? false;

  const isPending = card.review_status !== "reviewed";
  // ['project-reviews', 'detail', reviewId] — shared TanStack cache.
  // Replaces the prior useReviewDetails reducer hook.
  const {
    data: details = null,
    isPending: isFetching,
    error: queryError,
  } = useProjectReviewDetail(isPending ? null : card.review_id);
  const error = queryError ? getErrorMessage(queryError) : "";

  const roleExp = expectations.find(
    (e) =>
      e.department_name === card.department_name &&
      e.designation_name === card.designation_name,
  );

  if (isPending) {
    return (
      <tr>
        <td
          colSpan={TABLE_COLSPAN}
          className="px-5 py-6 text-center text-sm text-text-muted bg-surface-muted/50"
        >
          <Clock className="h-5 w-5 text-amber-500 dark:text-amber-400 mx-auto mb-2" />
          Evaluation pending — awaiting PM review.
        </td>
      </tr>
    );
  }

  if (isFetching) {
    return (
      <tr>
        <td colSpan={TABLE_COLSPAN} className="px-5 py-6 text-center bg-surface-muted/50">
          <Loader2 className="h-5 w-5 animate-spin text-brand mx-auto" />
        </td>
      </tr>
    );
  }

  if (error || !details) {
    return (
      <tr>
        <td
          colSpan={TABLE_COLSPAN}
          className="px-5 py-4 text-center text-sm text-red-600 dark:text-red-300 bg-red-50/30 dark:bg-red-950/30"
        >
          {error || "No data available"}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={TABLE_COLSPAN} className="p-0">
        <div className="border-t border-brand/10 bg-surface-muted/40 px-5 py-5 animate-in slide-in-from-top-1 fade-in duration-200">
          <div className="flex flex-col gap-4">
            {projectRatingsVisible && (
              <div className="flex items-center gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50/50 dark:bg-emerald-950/50 px-3 py-2">
                <span className="text-[13px] text-text-main">
                  Rating:{" "}
                  <span className="font-bold text-emerald-700 dark:text-emerald-300">
                    {details.performance_group ?? "—"}
                  </span>
                </span>
                {details.reviewer_name && (
                  <span className="ml-auto text-[11px] text-emerald-700 dark:text-emerald-300">
                    by {details.reviewer_name}
                  </span>
                )}
              </div>
            )}

            <CompetencyBlock review={details} roleExp={roleExp} compact />
            <ImpactBlock review={details} compact />
          </div>
        </div>
      </td>
    </tr>
  );
}
