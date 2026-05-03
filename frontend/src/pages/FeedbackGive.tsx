/**
 * FeedbackGive.tsx — single page that handles both submitting a 360
 * review on a peer AND viewing the requester's own already-submitted
 * review (read-only). Mode is decided by the my-review endpoint:
 *   ratings === null  → submit mode (sliders enabled, Submit button)
 *   ratings non-null  → read-only mode (sliders disabled, no submit)
 *
 * Navigated to from PeerList instead of opened as a modal so the
 * slider layout has room to breathe and the URL can be shared / used
 * as the "view my submitted review" entry point.
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
  feedback360Service,
  type FeedbackMyReview,
  type FeedbackQuestion,
  type FeedbackRatings,
} from "../services/feedback360.service";
import { getErrorMessage } from "../utils/errors";
import { useToast } from "../hooks/useToast";
import { RatingTrack } from "../components/feedback360/RatingTrack";

export function FeedbackGive() {
  const { id } = useParams<{ id: string }>();
  const targetUserId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();

  const [questions, setQuestions] = useState<FeedbackQuestion[]>([]);
  const [my, setMy] = useState<FeedbackMyReview | null>(null);
  const [ratings, setRatings] = useState<FeedbackRatings>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Initial load — questions + my-review run in parallel.
  useEffect(() => {
    if (!Number.isFinite(targetUserId)) {
      setLoadError("Invalid user.");
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setLoadError("");
    Promise.all([
      feedback360Service.getQuestions(),
      feedback360Service.getMyReview(targetUserId),
    ])
      .then(([qs, mine]) => {
        if (cancelled) return;
        setQuestions(qs);
        setMy(mine);
        // Pre-fill ratings when in read-only mode.
        if (mine.ratings) setRatings(mine.ratings);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetUserId]);

  const isReadOnly = my?.ratings != null;

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
    setIsSubmitting(true);
    try {
      await feedback360Service.submitReview({
        target_user_id: targetUserId,
        ratings,
      });
      toast.success("Feedback submitted.");
      navigate("/feedback");
    } catch (err) {
      setSubmitError(getErrorMessage(err));
      setIsSubmitting(false);
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
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
          <p className="text-sm text-red-700">
            {loadError || "Could not load this peer."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        to="/feedback"
        className="inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-brand"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to 360 Feedback
      </Link>

      {/* Header card — peer info + mode banner */}
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
                    : "bg-amber-50 text-amber-700"
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
          <div className="mt-4 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 mt-0.5" />
            <p className="text-xs text-green-800">
              You've already submitted this review. The slider positions
              below are what you rated. Reviews are submit-once and can't
              be edited or withdrawn.
            </p>
          </div>
        )}

        {!isReadOnly && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            <span>1 Strongly disagree</span>
            <span>2 Disagree</span>
            <span>3 Neutral</span>
            <span>4 Agree</span>
            <span className="sm:text-right">5 Strongly agree</span>
          </div>
        )}
      </div>

      {/* Questions, grouped by bucket */}
      <div className="space-y-6">
        {grouped.map((g) => (
          <section
            key={g.bucket}
            className="rounded-xl border border-border bg-surface shadow-sm"
          >
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                {g.bucket}
              </h2>
            </div>
            <div className="divide-y divide-border/50">
              {g.questions.map((q) => (
                <div key={q.key} className="px-5 py-4 space-y-2">
                  <p className="text-sm text-text-main">{q.text}</p>
                  <div className="flex items-center gap-3">
                    <RatingTrack
                      value={ratings[q.key]}
                      onChange={(v) => setRating(q.key, v)}
                      disabled={isReadOnly}
                    />
                    {!isReadOnly && ratings[q.key] !== undefined && (
                      <button
                        type="button"
                        onClick={() => clearRating(q.key)}
                        className="text-[11px] font-medium text-text-muted hover:text-brand shrink-0"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {submitError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
          <p className="text-sm text-red-700">{submitError}</p>
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
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
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
