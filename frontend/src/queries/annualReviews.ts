import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  annualReviewService,
  type AnnualReview,
  type MenteeAnnualReview,
  type CalibrationRow,
  type SelfReviewPayload,
  type SelfReviewDraftPayload,
  type MentorEvalPayload,
  type MentorEvalDraftPayload,
  type ManagementRatingPayload,
} from "../services/annual-review.service";
import { dashboardSummaryQueryKey } from "./dashboard";

/**
 * Strict, shared query keys for the annual-reviews domain.
 *
 * Top-level `annualReviewsQueryKey` is the broadcast — every mutation
 * invalidates it, which catches mine/history, mentees list, calibration
 * grid, and any per-id detail caches. Dashboard is additionally
 * invalidated for status-changing mutations (submit, mentor eval,
 * management rating) that affect its counters.
 */
export const annualReviewsQueryKey = ["annual-reviews"] as const;
export const myAnnualReviewHistoryQueryKey = [
  "annual-reviews",
  "mine",
  "history",
] as const;
export const menteeAnnualReviewsQueryKey = [
  "annual-reviews",
  "mentees",
] as const;
export const calibrationGridQueryKey = [
  "annual-reviews",
  "calibration",
] as const;
export const annualReviewDetailQueryKey = (reviewId: number) =>
  ["annual-reviews", "detail", reviewId] as const;

// ── Reads ─────────────────────────────────────────────────────────────

export function useMyAnnualReviewHistory() {
  return useQuery<AnnualReview[]>({
    queryKey: myAnnualReviewHistoryQueryKey,
    queryFn: () => annualReviewService.getMyReviewHistory(),
  });
}

export function useMenteeAnnualReviews() {
  return useQuery<MenteeAnnualReview[]>({
    queryKey: menteeAnnualReviewsQueryKey,
    queryFn: () => annualReviewService.getMenteeReviews(),
  });
}

export function useCalibrationGrid() {
  return useQuery<CalibrationRow[]>({
    queryKey: calibrationGridQueryKey,
    queryFn: () => annualReviewService.getCalibrationGrid(),
  });
}

export function useAnnualReviewDetail(reviewId: number | null) {
  return useQuery<AnnualReview>({
    queryKey: annualReviewDetailQueryKey(reviewId ?? -1),
    queryFn: () => annualReviewService.getReview(reviewId as number),
    enabled: reviewId !== null,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────

function invalidateAnnualReviewsAndDashboard(
  qc: ReturnType<typeof useQueryClient>,
): void {
  qc.invalidateQueries({ queryKey: annualReviewsQueryKey });
  qc.invalidateQueries({ queryKey: dashboardSummaryQueryKey });
}

export function useSubmitSelfReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SelfReviewPayload) =>
      annualReviewService.submitSelfReview(payload),
    onSuccess: () => invalidateAnnualReviewsAndDashboard(qc),
  });
}

export function useCreateSelfDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SelfReviewDraftPayload) =>
      annualReviewService.createSelfDraft(payload),
    onSuccess: () => {
      // Drafts don't affect dashboard counters; only refresh the
      // annual-reviews caches.
      qc.invalidateQueries({ queryKey: annualReviewsQueryKey });
    },
  });
}

export function useSaveSelfDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reviewId,
      payload,
    }: {
      reviewId: number;
      payload: SelfReviewDraftPayload;
    }) => annualReviewService.saveDraft(reviewId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: annualReviewsQueryKey });
    },
  });
}

export function useSubmitMentorEval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reviewId,
      payload,
    }: {
      reviewId: number;
      payload: MentorEvalPayload;
    }) => annualReviewService.submitMentorEval(reviewId, payload),
    onSuccess: () => invalidateAnnualReviewsAndDashboard(qc),
  });
}

export function useSaveMentorDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reviewId,
      payload,
    }: {
      reviewId: number;
      payload: MentorEvalDraftPayload;
    }) => annualReviewService.saveMentorDraft(reviewId, payload),
    onSuccess: () => {
      // Drafts: refresh annual-reviews caches so the form sees the
      // persisted draft on next mount. Dashboard counters unaffected.
      qc.invalidateQueries({ queryKey: annualReviewsQueryKey });
    },
  });
}

export function useSetManagementRating() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reviewId,
      payload,
    }: {
      reviewId: number;
      payload: ManagementRatingPayload;
    }) => annualReviewService.setManagementRating(reviewId, payload),
    onSuccess: () => invalidateAnnualReviewsAndDashboard(qc),
  });
}
