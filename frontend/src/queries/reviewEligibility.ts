/**
 * TanStack hooks for the admin Review Eligibility tab (per-project review
 * eligibility). The list is server-paginated + searchable (param-keyed +
 * keepPreviousData so paging/search doesn't blank the table); the write applies
 * new eligibility and invalidates the ["admin", "review-eligibility"] prefix so
 * the visible page refetches.
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  adminService,
  type ReviewEligibilityProject,
  type ReviewEligibilityQuery,
  type ReviewEligibilityUpdatePayload,
} from "../services/admin.service";
import type { Page } from "../services/pagination";

/** Static prefix — the mutation invalidates this, prefix-matching every page. */
export const reviewEligibilityQueryKey = ["admin", "review-eligibility"] as const;
export const reviewEligibilityPageQueryKey = (params: ReviewEligibilityQuery) =>
  ["admin", "review-eligibility", "page", params] as const;

/** One page of active projects + eligibility. */
export function useReviewEligibility(params: ReviewEligibilityQuery) {
  return useQuery<Page<ReviewEligibilityProject>>({
    queryKey: reviewEligibilityPageQueryKey(params),
    queryFn: () => adminService.getReviewEligibility(params),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateReviewEligibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ReviewEligibilityUpdatePayload) =>
      adminService.updateReviewEligibility(payload),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: reviewEligibilityQueryKey }),
  });
}
