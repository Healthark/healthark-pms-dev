import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  annualReviewService,
  type AnnualReview,
  type AnnualReviewFunnel,
  type MenteeAnnualReview,
  type CalibrationRow,
  type CalibrationQuery,
  type CalibrationFilterOptions,
  type SelfReviewPayload,
  type SelfReviewDraftPayload,
  type MentorEvalPayload,
  type MentorEvalDraftPayload,
  type ManagementRatingPayload,
} from "../services/annual-review.service";
import type { Page } from "../services/pagination";
import { dashboardSummaryQueryKey } from "./dashboard";
import { invalidateMentees } from "./mentees";

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
// Paginated calibration grid — the key includes the full query (page +
// filters + sort) so each distinct view is its own cache entry. The
// top-level ['annual-reviews'] mutation broadcast still prefix-matches
// every variant, so setting a management rating refetches the visible
// page automatically.
export const calibrationGridQueryKey = (params: CalibrationQuery) =>
  ["annual-reviews", "calibration", params] as const;
export const calibrationFilterOptionsQueryKey = [
  "annual-reviews",
  "calibration",
  "filter-options",
] as const;
export const annualReviewDetailQueryKey = (reviewId: number) =>
  ["annual-reviews", "detail", reviewId] as const;
export const allReviewsQueryKey = ["annual-reviews", "all"] as const;
export const annualReviewFunnelQueryKey = ["annual-reviews", "funnel"] as const;

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

export function useCalibrationGrid(params: CalibrationQuery) {
  return useQuery<Page<CalibrationRow>>({
    queryKey: calibrationGridQueryKey(params),
    queryFn: () => annualReviewService.getCalibrationGrid(params),
    // Keep the previous page's rows on screen while the next page loads,
    // so paging / filtering doesn't blank the table.
    placeholderData: keepPreviousData,
  });
}

// Filter-dropdown options change rarely (only as reviews enter/leave the
// calibration stage), so cache them for 5 min — separate from the page
// data which refetches on every page/filter/sort change.
const FILTER_OPTIONS_STALE_TIME = 5 * 60_000;

export function useCalibrationFilterOptions() {
  return useQuery<CalibrationFilterOptions>({
    queryKey: calibrationFilterOptionsQueryKey,
    queryFn: () => annualReviewService.getCalibrationFilterOptions(),
    staleTime: FILTER_OPTIONS_STALE_TIME,
  });
}

/** Admin-only: org-wide annual reviews for the All Reviews tab (all years).
 *  keepPreviousData avoids a flash while the (rare) refetch runs. */
export function useAllReviews() {
  return useQuery<CalibrationRow[]>({
    queryKey: allReviewsQueryKey,
    queryFn: () => annualReviewService.getAllReviews(),
    placeholderData: keepPreviousData,
  });
}

/** Admin-only: active-cycle progress for the dashboard funnel card.
 *  `enabled` lets the dashboard fetch it only for admins. */
export function useAnnualReviewFunnel(enabled = true) {
  return useQuery<AnnualReviewFunnel>({
    queryKey: annualReviewFunnelQueryKey,
    queryFn: () => annualReviewService.getFunnel(),
    enabled,
    staleTime: 60_000,
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
  // Mentor-side MenteeDetail.reviews_list + MenteeAnnualSummaryTab's
  // status pill are driven by the same review rows.
  invalidateMentees(qc);
}

/** Drafts don't bump dashboard counters but still surface on
 *  MenteeAnnualSummaryTab (mentor's draft rating/text + the "Draft
 *  saved" pill ride on the review row inside MenteeDetail.reviews_list). */
function invalidateAnnualReviewDrafts(
  qc: ReturnType<typeof useQueryClient>,
): void {
  qc.invalidateQueries({ queryKey: annualReviewsQueryKey });
  invalidateMentees(qc);
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
    onSuccess: () => invalidateAnnualReviewDrafts(qc),
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
    onSuccess: () => invalidateAnnualReviewDrafts(qc),
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
