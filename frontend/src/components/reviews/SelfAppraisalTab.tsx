/**
 * SelfAppraisalTab.tsx — Stage 1: Employee Self-Appraisal.
 *
 * States:
 *   1. No review exists (404)  → Show the self-appraisal form
 *   2. Review in draft          → Show form pre-filled (future: draft save)
 *   3. Review submitted         → Read-only view with status badge
 *   4. Review completed + published → Shows final rating
 *
 * Placement: src/components/reviews/SelfAppraisalTab.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { ClipboardCheck, Star, Send, Loader2 } from "lucide-react";
import {
  annualReviewService,
  type AnnualReview,
  type SelfAppraisalPayload,
} from "../../services/annual-review.service";
import { getErrorMessage } from "../../utils/errors";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import { StarRating } from "./StarRating";

// ── Constants ───────────────────────────────────────────────────────

const COMPETENCIES = [
  {
    key: "ownership",
    label: "Ownership",
    placeholder:
      "Describe how you took ownership of your responsibilities, proactively identified problems, and drove initiatives without being asked.",
  },
  {
    key: "productivity",
    label: "Productivity",
    placeholder:
      "Describe your output quality and volume, efficiency improvements, and how you managed your workload.",
  },
  {
    key: "communication",
    label: "Communication",
    placeholder:
      "Describe how you communicated with peers, stakeholders, and leadership — both written and verbal.",
  },
  {
    key: "leadership",
    label: "Leadership",
    placeholder:
      "Describe how you mentored others, led projects or initiatives, and influenced team direction.",
  },
  {
    key: "adaptability",
    label: "Adaptability",
    placeholder:
      "Describe how you handled change, learned new skills, and adapted to shifting priorities.",
  },
  {
    key: "time_management",
    label: "Time Management",
    placeholder:
      "Describe how you prioritized tasks, met deadlines, and balanced competing demands.",
  },
] as const;

type CompetencyKey = (typeof COMPETENCIES)[number]["key"];

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

// ── Skeleton ────────────────────────────────────────────────────────

function FormSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i}>
          <div className="h-3 w-28 rounded bg-slate-100 mb-2" />
          <div className="h-20 rounded-lg bg-slate-50 border border-border" />
        </div>
      ))}
    </div>
  );
}

// ── Read-Only View (After Submission) ───────────────────────────────

function SubmittedView({ review }: { readonly review: AnnualReview }) {
  const isPublished = review.final_rating_enabled;

  return (
    <div className="space-y-6">
      {/* Status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50">
            <ClipboardCheck
              className="h-5 w-5 text-green-600"
              aria-hidden="true"
            />
          </div>
          <div>
            <p className="font-display text-sm font-semibold text-text-main">
              Self-Appraisal Submitted
            </p>
            <p className="text-xs text-text-muted">
              Cycle: {review.cycle_name}
            </p>
          </div>
        </div>
        <ReviewStatusBadge status={review.status} />
      </div>

      {/* Self-rating */}
      {review.self_stars && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-muted">
            Your Rating:
          </span>
          <StarRating value={review.self_stars} readonly />
        </div>
      )}

      {/* Competency answers (read-only) */}
      <div className="space-y-4">
        {COMPETENCIES.map((comp) => {
          const selfKey = `self_desc_${comp.key}` as keyof AnnualReview;
          const selfValue = review[selfKey] as string | null;
          const mentorKey = `mentor_comment_${comp.key}` as keyof AnnualReview;
          const mentorValue = review[mentorKey] as string | null;

          return (
            <div
              key={comp.key}
              className="rounded-lg border border-border p-4 space-y-2"
            >
              <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
                {comp.label}
              </p>
              <p className="text-sm text-text-main whitespace-pre-wrap">
                {selfValue || "—"}
              </p>
              {/* Show mentor feedback if review is published */}
              {isPublished && mentorValue && (
                <div className="mt-2 rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
                  <p className="text-xs font-medium text-blue-700 mb-0.5">
                    Mentor Feedback
                  </p>
                  <p className="text-sm text-blue-900 whitespace-pre-wrap">
                    {mentorValue}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Final rating — only shown when published */}
      {isPublished && review.final_stars && (
        <div className="rounded-lg border-2 border-green-200 bg-green-50 p-5 text-center space-y-2">
          <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">
            Your Final Rating
          </p>
          <StarRating value={review.final_stars} readonly size="lg" />
          {review.management_comments && (
            <p className="text-sm text-green-800 mt-2">
              {review.management_comments}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Self-Appraisal Form ─────────────────────────────────────────────

export function SelfAppraisalTab() {
  const [review, setReview] = useState<AnnualReview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Form state — 6 competency fields + rating
  const [form, setForm] = useState<Record<CompetencyKey, string>>({
    ownership: "",
    productivity: "",
    communication: "",
    leadership: "",
    adaptability: "",
    time_management: "",
  });
  const [selfStars, setSelfStars] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  // Fetch existing review on mount
  useEffect(() => {
    annualReviewService
      .getMyReview()
      .then((data) => {
        setReview(data);
        setNotFound(false);
      })
      .catch((err: unknown) => {
        if (
          err !== null &&
          typeof err === "object" &&
          "response" in err &&
          (err as { response: { status: number } }).response.status === 404
        ) {
          setNotFound(true);
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const setField = useCallback((key: CompetencyKey, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const allFilled =
    COMPETENCIES.every((c) => form[c.key].trim().length > 0) && selfStars >= 1;

  const handleSubmit = async () => {
    setIsSaving(true);
    setError("");
    try {
      const payload: SelfAppraisalPayload = {
        self_desc_ownership: form.ownership,
        self_desc_productivity: form.productivity,
        self_desc_communication: form.communication,
        self_desc_leadership: form.leadership,
        self_desc_adaptability: form.adaptability,
        self_desc_time_management: form.time_management,
        self_stars: selfStars,
      };
      const created = await annualReviewService.submitSelfAppraisal(payload);
      setReview(created);
      setNotFound(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────

  if (isLoading) return <FormSkeleton />;

  // Review exists — show read-only view
  if (review && !notFound) {
    return <SubmittedView review={review} />;
  }

  // No review yet — show the form
  return (
    <div className="space-y-6">
      {/* Form header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light">
          <ClipboardCheck className="h-5 w-5 text-brand" aria-hidden="true" />
        </div>
        <div>
          <p className="font-display text-sm font-semibold text-text-main">
            Annual Self-Appraisal
          </p>
          <p className="text-xs text-text-muted">
            Reflect on your performance across 6 core competencies and rate
            yourself. Once submitted, your mentor will review it.
          </p>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* Competency fields */}
      <div className="space-y-5">
        {COMPETENCIES.map((comp, idx) => (
          <div key={comp.key}>
            <label
              htmlFor={`comp-${comp.key}`}
              className="block text-xs font-semibold text-text-main mb-1"
            >
              {idx + 1}. {comp.label} *
            </label>
            <textarea
              id={`comp-${comp.key}`}
              rows={4}
              className={INPUT_CLS}
              value={form[comp.key]}
              onChange={(e) => setField(comp.key, e.target.value)}
              placeholder={comp.placeholder}
            />
          </div>
        ))}
      </div>

      {/* Star rating */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-text-main">
          Overall Self-Rating *
        </p>
        <p className="text-xs text-text-muted">
          How would you rate your overall performance this year? (1 = Needs
          Improvement, 5 = Exceptional)
        </p>
        <StarRating value={selfStars} onChange={setSelfStars} />
      </div>

      {/* Submit */}
      <div className="flex items-center justify-between border-t border-border pt-5">
        <p className="text-xs text-text-muted">
          Once submitted, you cannot edit your self-appraisal.
        </p>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSaving || !allFilled}
          className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          {isSaving ? "Submitting…" : "Submit Self-Appraisal"}
        </button>
      </div>
    </div>
  );
}
