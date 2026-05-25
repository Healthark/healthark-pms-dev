import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  feedback360Service,
  type FeedbackAggregate,
  type FeedbackMyReview,
  type FeedbackPeer,
  type FeedbackQuestion,
  type FeedbackSubmitPayload,
} from "../services/feedback360.service";

/**
 * Strict, shared query keys for the feedback-360 domain.
 *
 * Top-level `feedback360QueryKey` is the broadcast — `useSubmitFeedback`
 * invalidates it after a successful POST, which catches peers (the
 * `has_submitted` flag flips on the row the user just reviewed) AND
 * every per-target aggregate the cache holds (their counts +
 * worked/not-worked cohort whiskers shift). The questions registry is
 * a sibling but staleTime keeps it out of the refetch path.
 *
 * Dashboard is **not** invalidated — feedback-360 isn't surfaced on
 * `/dashboard/summary` (verified). If a future PR adds a counter to
 * the summary, add `dashboardSummaryQueryKey` to the broadcast here.
 */
export const feedback360QueryKey = ["feedback-360"] as const;
export const feedbackQuestionsQueryKey = [
  "feedback-360",
  "questions",
] as const;
export const feedbackPeersQueryKey = ["feedback-360", "peers"] as const;
export const myFeedbackReviewQueryKey = (targetUserId: number) =>
  ["feedback-360", "my-review", targetUserId] as const;
export const feedbackAggregateQueryKey = (targetUserId: number) =>
  ["feedback-360", "aggregate", targetUserId] as const;

// Questions are an effectively-static registry — they change only when
// HR edits the 360 form, which is rare. Long staleTime keeps the cache
// warm across the whole session.
const QUESTIONS_STALE_TIME = 15 * 60_000;

// ── Reads ─────────────────────────────────────────────────────────────

export function useFeedbackQuestions() {
  return useQuery<FeedbackQuestion[]>({
    queryKey: feedbackQuestionsQueryKey,
    queryFn: () => feedback360Service.getQuestions(),
    staleTime: QUESTIONS_STALE_TIME,
  });
}

export function useFeedbackPeers() {
  return useQuery<FeedbackPeer[]>({
    queryKey: feedbackPeersQueryKey,
    queryFn: () => feedback360Service.getPeers(),
  });
}

/**
 * Per-target submit-or-view state. `data.ratings === null` means the
 * requester hasn't submitted yet (page enters submit mode); non-null
 * means read-only with the prior ratings pre-filled.
 */
export function useFeedbackMyReview(targetUserId: number | null) {
  const id = targetUserId ?? -1;
  return useQuery<FeedbackMyReview>({
    queryKey: myFeedbackReviewQueryKey(id),
    queryFn: () => feedback360Service.getMyReview(id),
    enabled: targetUserId !== null && Number.isFinite(targetUserId),
  });
}

export function useFeedbackAggregate(targetUserId: number | null) {
  const id = targetUserId ?? -1;
  return useQuery<FeedbackAggregate>({
    queryKey: feedbackAggregateQueryKey(id),
    queryFn: () => feedback360Service.getAggregate(id),
    enabled: targetUserId !== null && Number.isFinite(targetUserId),
  });
}

// ── Mutations ─────────────────────────────────────────────────────────

export function useSubmitFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: FeedbackSubmitPayload) =>
      feedback360Service.submitReview(payload),
    onSuccess: () => {
      // Broadcast — catches peers (has_submitted flips), the just-
      // submitted target's aggregate (counts shift), and the
      // requester's own my-review for that target (now in read-only
      // mode). Questions registry has its own long staleTime and
      // doesn't need a refetch.
      qc.invalidateQueries({ queryKey: feedback360QueryKey });
    },
  });
}
