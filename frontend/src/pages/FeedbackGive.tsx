/**
 * FeedbackGive.tsx — single page that handles both submitting a 360
 * review on a peer AND viewing the requester's own already-submitted
 * review (read-only). Mode is decided by the my-review endpoint:
 *   ratings === null  → submit mode (sliders enabled, Submit button)
 *   ratings non-null  → read-only mode (sliders disabled, no submit)
 *
 * Uses the same single-container tabular layout as the aggregate view
 * (AggregateView): bucket on the left rowspan-style, statement in the
 * middle right-aligned, RatingTrack in the plot cell. The only
 * visual difference between submit and read-only is the `disabled`
 * flag on RatingTrack and whether the Clear button renders.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Lock,
  Send,
  UserCircle,
} from "lucide-react";
import {
  type FeedbackQuestion,
  type FeedbackRatings,
} from "../services/feedback360.service";
import {
  useFeedbackMyReview,
  useFeedbackQuestions,
  useSubmitFeedback,
} from "../queries/feedback360";
import { getErrorMessage } from "../utils/errors";
import { useToast } from "../hooks/useToast";
import { RatingTrack } from "../components/feedback360/RatingTrack";
import { Gridlines } from "../components/feedback360/Gridlines";

export function FeedbackGive() {
  const { id } = useParams<{ id: string }>();
  const targetUserId = Number(id);
  const isValidId = Number.isFinite(targetUserId);
  const navigate = useNavigate();
  const toast = useToast();

  // Two parallel queries — TanStack runs them concurrently. The
  // questions registry is shared (15-min staleTime) so multiple
  // FeedbackGive visits in one session hit the cache.
  const questionsQuery = useFeedbackQuestions();
  const myReviewQuery = useFeedbackMyReview(isValidId ? targetUserId : null);
  const submitFeedbackMutation = useSubmitFeedback();

  const questions = questionsQuery.data ?? [];
  const my = myReviewQuery.data ?? null;
  const isLoading =
    isValidId && (questionsQuery.isPending || myReviewQuery.isPending);
  const loadError = !isValidId
    ? "Invalid user."
    : questionsQuery.error
      ? getErrorMessage(questionsQuery.error)
      : myReviewQuery.error
        ? getErrorMessage(myReviewQuery.error)
        : "";

  const isReadOnly = my?.ratings != null;
  const [ratings, setRatings] = useState<FeedbackRatings>({});
  const [submitError, setSubmitError] = useState("");
  const isSubmitting = submitFeedbackMutation.isPending;

  // Pre-fill ratings when the read-only payload arrives. Effect over a
  // ref-style setter so re-renders during refetch don't clobber edits
  // mid-session — but here read-only is a terminal state (can't go
  // back to draft) so a simple effect is fine.
  useEffect(() => {
    if (my?.ratings) setRatings(my.ratings);
  }, [my?.ratings]);

  const grouped = useMemo(() => {
    const out: { bucket: string; questions: FeedbackQuestion[] }[] = [];
    for (const q of questions) {
      const last = out[out.length - 1];
      if (last && last.bucket === q.bucket) last.questions.push(q);
      else out.push({ bucket: q.bucket, questions: [q] });
    }
    return out;
  }, [questions]);

  const setRating = (key: string, value: number) => {
    if (isReadOnly) return;
    setRatings((prev) => ({ ...prev, [key]: value }));
  };

  const clearRating = (key: string) => {
    if (isReadOnly) return;
    setRatings((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const ratedCount = Object.keys(ratings).length;
  const canSubmit = !isReadOnly && ratedCount > 0 && !isSubmitting;

  const handleSubmit = async () => {
    setSubmitError("");
    try {
      await submitFeedbackMutation.mutateAsync({
        target_user_id: targetUserId,
        ratings,
      });
      toast.success("Feedback submitted.");
      // Broadcast invalidation in the mutation hook flips the peer's
      // has_submitted flag and refreshes the target's aggregate before
      // we navigate.
      navigate("/feedback");
    } catch (err) {
      setSubmitError(getErrorMessage(err));
    }
  };

  // ── Render ──────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
      </div>
    );
  }
  if (loadError || !my) {
    return (
      <div className="space-y-4">
        <Link
          to="/feedback"
          className="inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-brand"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to 360 Feedback
        </Link>
        <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-300 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">
            {loadError || "Could not load this peer."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/feedback"
        className="inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-brand"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to 360 Feedback
      </Link>

      {/* Header card — peer info + read-only banner */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 shrink-0">
            <UserCircle className="h-7 w-7 text-brand" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-lg font-semibold text-text-main">
              {isReadOnly ? "Feedback you submitted" : "Give Feedback"}
            </h1>
            <p className="mt-0.5 text-sm text-text-main">
              {my.target.full_name}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              {my.target.designation_name ?? "—"}
              {my.target.department_name && ` · ${my.target.department_name}`}
            </p>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  my.target.worked_with
                    ? "bg-brand/10 text-brand"
                    : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
                }`}
              >
                {my.target.worked_with ? "Worked with" : "Not worked with"}
              </span>
              <span className="text-[11px] text-text-muted">
                FY{String(my.fy_year).slice(-2)}-
                {String(my.fy_year + 1).slice(-2)} · Anonymous · Submit-once
              </span>
            </div>
          </div>
        </div>

        {isReadOnly && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 px-3 py-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-300 mt-0.5" />
            <p className="text-xs text-green-800 dark:text-green-300">
              You've already submitted this review. The slider positions
              below are what you rated. Reviews are submit-once and can't
              be edited or withdrawn.
            </p>
          </div>
        )}
      </div>

      {/* ── Single-container rating table ─────────────────────────── */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        {/* Header row — left cell summary, right cell scale labels */}
        <div className="flex items-stretch border-b border-border bg-surface-muted/50">
          <div className="w-[180px] shrink-0 px-6 py-4 border-r border-border/40">
            <h3 className="text-[14px] font-bold text-brand">
              {isReadOnly ? "Your ratings" : "Rate each statement"}
            </h3>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {isReadOnly
                ? "Submit-once · cannot edit"
                : `${ratedCount} of ${questions.length} rated`}
            </p>
          </div>
          <div className="flex flex-1">
            <div className="w-[38%] border-r border-border/40" />
            <div className="flex-1 px-6 py-4 relative">
              <div className="absolute inset-x-6 bottom-3 flex justify-between items-end pointer-events-none">
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted leading-tight w-24">
                  Strongly
                  <br />
                  Disagree
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted leading-tight text-center absolute left-1/2 -translate-x-1/2">
                  Neither Agree
                  <br />
                  Nor Disagree
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted leading-tight w-24 text-right">
                  Strongly
                  <br />
                  Agree
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bucket groups */}
        {grouped.map((group, gIdx) => (
          <div
            key={group.bucket}
            className={`flex ${gIdx > 0 ? "border-t border-border" : ""}`}
          >
            <div className="w-[180px] shrink-0 flex items-center justify-end px-5 py-4 border-r border-border/40 bg-surface-muted/30">
              <span className="italic font-semibold text-[13px] text-text-main text-right leading-tight">
                {group.bucket}
              </span>
            </div>
            <div className="flex flex-1 flex-col">
              {group.questions.map((q, qIdx) => (
                <div
                  key={q.key}
                  className={`flex ${
                    qIdx > 0 ? "border-t border-border/30" : ""
                  }`}
                >
                  <div className="w-[38%] flex items-center justify-end px-4 py-3 border-r border-border/40">
                    <p className="text-[13px] text-text-muted text-right leading-snug">
                      {q.text}
                    </p>
                  </div>
                  <div className="flex-1 px-6 py-3 min-h-[60px] relative">
                    <Gridlines />
                    {/* RatingTrack pinned to inset-x-6 so its dot
                        positions line up with the gridlines + scale
                        labels in the header, regardless of whether
                        the Clear button is rendered. */}
                    <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 z-10">
                      <RatingTrack
                        value={ratings[q.key]}
                        onChange={(v) => setRating(q.key, v)}
                        disabled={isReadOnly}
                      />
                    </div>
                    {!isReadOnly && ratings[q.key] !== undefined && (
                      <button
                        type="button"
                        onClick={() => clearRating(q.key)}
                        className="absolute right-2 top-1.5 text-[10px] font-medium text-text-muted hover:text-brand z-20 bg-surface px-1 rounded"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {submitError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-300 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">{submitError}</p>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        {isReadOnly ? (
          <p className="text-[11px] text-text-muted flex items-center gap-1.5">
            <Lock className="h-3 w-3" /> Read-only — already submitted.
          </p>
        ) : (
          <p className="text-[11px] text-text-muted">
            {ratedCount === 0
              ? "Rate at least one question to submit."
              : `${ratedCount} of ${questions.length} questions rated · skip the rest if you'd like.`}
          </p>
        )}
        <div className="flex gap-3">
          <Link
            to="/feedback"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-muted transition-colors"
          >
            {isReadOnly ? "Close" : "Cancel"}
          </Link>
          {!isReadOnly && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {isSubmitting ? "Submitting…" : "Submit Feedback"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
