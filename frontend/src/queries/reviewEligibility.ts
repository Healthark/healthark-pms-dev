/**
 * TanStack hooks for the admin Review Eligibility tab (per-project review
 * eligibility). Reads all active projects + their eligibility; the write applies
 * new eligibility and invalidates the ["review-eligibility"] key so the list
 * refetches.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminService,
  type ReviewEligibility,
  type ReviewEligibilityUpdatePayload,
} from "../services/admin.service";

export const reviewEligibilityQueryKey = ["review-eligibility"] as const;

/** Every active project + whether it is eligible for review. */
export function useReviewEligibility() {
  return useQuery<ReviewEligibility>({
    queryKey: reviewEligibilityQueryKey,
    queryFn: () => adminService.getReviewEligibility(),
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
