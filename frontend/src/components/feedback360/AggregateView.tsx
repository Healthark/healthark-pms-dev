import { useEffect, useState } from "react";
import { AlertCircle, Loader2, Users } from "lucide-react";
import {
  feedback360Service,
  type FeedbackAggregate,
  type FeedbackQuestionAggregate,
} from "../../services/feedback360.service";
import { getErrorMessage } from "../../utils/errors";
import { RatingTrack } from "./RatingTrack";

interface AggregateViewProps {
  /** Target whose 360 aggregate is being displayed. */
  readonly targetUserId: number;
  /** Header label — typically the target's name or "Your Feedback". */
  readonly heading?: string;
}

/**
 * Per-question 360 aggregate. Each question shows two rows — one for
 * the worked-with cohort and one for the not-worked-with cohort. Each
 * row is a dotted 1–5 track with a colored dot at the cohort's average
 * (interpolated, e.g. 4.2 sits 80% along the track). Cohorts below the
 * minimum-reviewer threshold are rendered as a muted placeholder so a
 * single rater can't be identified.
 */
export function AggregateView({ targetUserId, heading }: AggregateViewProps) {
  const [data, setData] = useState<FeedbackAggregate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");
    feedback360Service
      .getAggregate(targetUserId)
      .then((agg) => {
        if (!cancelled) setData(agg);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetUserId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading feedback…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  if (data.total_reviews === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border py-12 text-center">
        <Users className="h-8 w-8 text-text-muted mx-auto mb-2" />
        <p className="text-sm font-medium text-text-main">
          No feedback yet for FY{String(data.fy_year).slice(-2)}-
          {String(data.fy_year + 1).slice(-2)}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          The aggregate will populate as colleagues submit reviews.
        </p>
      </div>
    );
  }

  // Group by bucket — buckets are visual headings only, no roll-up.
  const grouped: { bucket: string; questions: FeedbackQuestionAggregate[] }[] = [];
  for (const q of data.questions) {
    const last = grouped[grouped.length - 1];
    if (last && last.bucket === q.bucket) {
      last.questions.push(q);
    } else {
      grouped.push({ bucket: q.bucket, questions: [q] });
    }
  }

  return (
    <div className="space-y-6">
      {heading && (
        <div className="flex flex-col gap-1 border-b border-border pb-3 sm:flex-row sm:items-end sm:justify-between">
          <h3 className="font-display text-base font-semibold text-text-main">
            {heading}
          </h3>
          <p className="text-[11px] text-text-muted">
            {data.total_reviews} review{data.total_reviews === 1 ? "" : "s"} ·
            FY{String(data.fy_year).slice(-2)}-
            {String(data.fy_year + 1).slice(-2)} · cohort hidden below{" "}
            {data.min_reviewers_threshold} reviewers
          </p>
        </div>
      )}

      {/* Scale legend above the plot grid */}
      <div className="hidden sm:grid grid-cols-[28%_72%] items-end gap-3 px-4 text-[10px] font-bold uppercase tracking-wider text-text-muted">
        <div />
        <div className="grid grid-cols-3">
          <span className="text-left">Strongly Disagree</span>
          <span className="text-center">Neutral</span>
          <span className="text-right">Strongly Agree</span>
        </div>
      </div>

      {grouped.map((g) => (
        <section
          key={g.bucket}
          className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden"
        >
          <div className="border-b border-border bg-slate-50/50 px-5 py-2.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              {g.bucket}
            </h4>
          </div>
          <div className="divide-y divide-border/50">
            {g.questions.map((q) => (
              <QuestionRow
                key={q.key}
                q={q}
                threshold={data.min_reviewers_threshold}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function QuestionRow({
  q,
  threshold,
}: {
  readonly q: FeedbackQuestionAggregate;
  readonly threshold: number;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-sm text-text-main mb-3">{q.text}</p>
      <div className="space-y-2.5">
        <CohortLine
          label="Worked with"
          cohortKey="worked"
          cohort={q.worked_with}
          threshold={threshold}
        />
        <CohortLine
          label="Not worked with"
          cohortKey="not_worked"
          cohort={q.not_worked_with}
          threshold={threshold}
        />
      </div>
    </div>
  );
}

function CohortLine({
  label,
  cohortKey,
  cohort,
  threshold,
}: {
  readonly label: string;
  readonly cohortKey: "worked" | "not_worked";
  readonly cohort: { count: number; avg: number } | null;
  readonly threshold: number;
}) {
  const labelColor =
    cohortKey === "worked" ? "text-brand" : "text-amber-700";

  return (
    <div className="grid grid-cols-[28%_72%] items-center gap-3">
      <span className={`text-[11px] font-semibold ${labelColor}`}>
        {label}
      </span>
      <div className="flex items-center gap-3">
        <RatingTrack
          avg={cohort ? cohort.avg : null}
          cohort={cohortKey}
          placeholder={`Need ${threshold}+ reviewers`}
        />
        <span className="w-28 shrink-0 text-right text-[11px] text-text-muted">
          {cohort
            ? `${cohort.avg.toFixed(1)} · ${cohort.count} reviewer${
                cohort.count === 1 ? "" : "s"
              }`
            : ""}
        </span>
      </div>
    </div>
  );
}
