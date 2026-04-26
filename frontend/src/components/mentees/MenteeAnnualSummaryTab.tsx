/**
 * MenteeAnnualSummaryTab — Mentor's at-a-glance view of everything they
 * need to write a mentee's annual review for the selected FY.
 *
 * Surfaces:
 *   - Year picker + review status pill + "Fill Annual Review" CTA
 *   - Mentee's self review (rating + paragraph) when filed
 *   - Annual goals for the FY, each with H1 + H2 self/mentor review text
 *     side by side and criteria progress at the top
 *   - Project assignments grouped by half within the FY, each with
 *     performance group + PM eval excerpt
 *
 * The CTA reuses the same EvalModal as /annual-reviews → Team Review tab.
 * On submit, calls onReload() so the parent's silent refetch updates the
 * status pill without flashing a skeleton.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Target,
} from "lucide-react";
import {
  annualReviewService,
  type AnnualReview,
  type MenteeAnnualReview,
  type MentorEvalPayload,
  type MentorEvalDraftPayload,
  type ReviewStatus,
} from "../../services/annual-review.service";
import type { MenteeDetail } from "../../services/mentee.service";
import type {
  TeamGoal,
  GoalSelfReview,
  GoalMentorReview,
  SelfReviewCycleHalf,
} from "../../services/goal.service";
import type { MenteeProjectAssignment } from "../../services/mentee.service";
import { EvalModal } from "../reviews/EvalModal";
import { PerformanceRatingBadge } from "../reviews/PerformanceRatingBadge";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { useConfirm } from "../../hooks/useConfirm";
import { getErrorMessage } from "../../utils/errors";
import {
  extractFyToken,
  formatFyLabel,
  fyTokenToStartYear,
} from "../../utils/fy";

interface MenteeAnnualSummaryTabProps {
  readonly mentee: MenteeDetail;
  readonly onReload: () => void;
}

// ── Status helpers ──────────────────────────────────────────────────

const STATUS_PILL: Record<
  ReviewStatus | "none",
  { label: string; cls: string }
> = {
  none: {
    label: "Not started",
    cls: "bg-slate-100 text-slate-600",
  },
  draft: {
    label: "Mentee drafting",
    cls: "bg-slate-100 text-slate-600",
  },
  pending_mentor: {
    label: "Awaiting your evaluation",
    cls: "bg-amber-50 text-amber-700",
  },
  // Both post-mentor states read as "Reviewed" from the mentor's POV —
  // they've done their part; management calibration is a downstream step.
  pending_management: {
    label: "Reviewed",
    cls: "bg-green-50 text-green-700",
  },
  completed: {
    label: "Reviewed",
    cls: "bg-green-50 text-green-700",
  },
};

function StatusPill({ status }: { readonly status: ReviewStatus | null }) {
  const cfg = STATUS_PILL[status ?? "none"];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

// ── Self-review card ────────────────────────────────────────────────

function SelfReviewCard({
  review,
}: {
  readonly review: AnnualReview;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = review.self_overall_review ?? "";
  const isLong = text.length > 280;
  const display = expanded || !isLong ? text : `${text.slice(0, 280)}…`;

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Mentee's self review
        </p>
        {review.self_performance_rating !== null && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-muted">Self-rating</span>
            <PerformanceRatingBadge value={review.self_performance_rating} />
          </div>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-text-main">
        {display || <span className="italic text-text-muted">No self-review text</span>}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" /> Read full
            </>
          )}
        </button>
      )}
    </section>
  );
}

// ── Goal card with H1/H2 columns ────────────────────────────────────

function HalfPanel({
  half,
  self,
  mentor,
}: {
  readonly half: SelfReviewCycleHalf;
  readonly self: GoalSelfReview | undefined;
  readonly mentor: GoalMentorReview | undefined;
}) {
  return (
    <div className="rounded-md border border-border bg-slate-50/50 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-muted">
        {half}
      </p>
      <div className="space-y-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Self-review
          </p>
          {self ? (
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-text-main">
              {self.self_overall_review}
            </p>
          ) : (
            <p className="mt-0.5 text-xs italic text-text-muted">
              Not submitted
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Your review
          </p>
          {mentor ? (
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-text-main">
              {mentor.mentor_overall_review}
            </p>
          ) : (
            <p className="mt-0.5 text-xs italic text-text-muted">—</p>
          )}
        </div>
      </div>
    </div>
  );
}

function GoalSummaryCard({ goal }: { readonly goal: TeamGoal }) {
  const h1Self = goal.self_reviews.find((sr) => sr.cycle_half === "H1");
  const h2Self = goal.self_reviews.find((sr) => sr.cycle_half === "H2");
  const h1Mentor = goal.mentor_reviews.find((mr) => mr.cycle_half === "H1");
  const h2Mentor = goal.mentor_reviews.find((mr) => mr.cycle_half === "H2");

  const completedCount = goal.criteria.filter((c) => c.is_completed).length;
  const totalCriteria = goal.criteria.length;

  return (
    <article className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <header className="mb-3">
        <p className="font-medium text-text-main">{goal.title}</p>
        {goal.description && (
          <p className="mt-1 text-xs text-text-muted line-clamp-2">
            {goal.description}
          </p>
        )}
        <div className="mt-2 flex items-center gap-3">
          {totalCriteria > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-32 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    goal.progress_percent === 100
                      ? "bg-green-500"
                      : goal.progress_percent >= 50
                        ? "bg-blue-500"
                        : "bg-amber-500"
                  }`}
                  style={{ width: `${goal.progress_percent}%` }}
                />
              </div>
              <span className="text-xs font-medium text-text-muted">
                {completedCount}/{totalCriteria} key results · {goal.progress_percent}%
              </span>
            </div>
          )}
        </div>
      </header>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <HalfPanel half="H1" self={h1Self} mentor={h1Mentor} />
        <HalfPanel half="H2" self={h2Self} mentor={h2Mentor} />
      </div>
    </article>
  );
}

// ── Project card ────────────────────────────────────────────────────

const COMPETENCY_LABELS: ReadonlyArray<{
  key:
    | "comment_task_execution"
    | "comment_ownership"
    | "comment_project_management"
    | "comment_client_deliverables"
    | "comment_communication"
    | "comment_mentoring"
    | "comment_competency_skills";
  label: string;
}> = [
  { key: "comment_task_execution", label: "Task Execution" },
  { key: "comment_ownership", label: "Ownership" },
  { key: "comment_project_management", label: "Project Management" },
  { key: "comment_client_deliverables", label: "Client Deliverables" },
  { key: "comment_communication", label: "Communication" },
  { key: "comment_mentoring", label: "Mentoring" },
  { key: "comment_competency_skills", label: "Competency & Skills" },
];

function ProjectSummaryCard({
  assignment,
}: {
  readonly assignment: MenteeProjectAssignment;
}) {
  const [expanded, setExpanded] = useState(false);
  const detail = assignment.review_detail;
  const filledComments = detail
    ? COMPETENCY_LABELS.filter(({ key }) => Boolean(detail[key]))
    : [];
  const secondaryEvals = detail?.secondary_evaluations ?? [];
  const hasNarrative = filledComments.length > 0 || secondaryEvals.length > 0;

  return (
    <article className="rounded-lg border border-border bg-surface p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-text-main truncate">
            {assignment.project_name}
            <span className="ml-1.5 text-[11px] font-mono text-text-muted">
              ({assignment.project_code})
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {assignment.assignment_role ?? "—"}
            {assignment.cycle && ` · ${assignment.cycle}`}
            {assignment.pm_name && ` · PM: ${assignment.pm_name}`}
          </p>
        </div>
        {assignment.performance_group && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] text-text-muted">Rating</span>
            <PerformanceRatingBadge
              value={Number(assignment.performance_group)}
            />
          </div>
        )}
      </div>

      {hasNarrative ? (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" /> Hide PM eval
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> Read PM eval
                {filledComments.length > 0 &&
                  ` (${filledComments.length} competenc${
                    filledComments.length === 1 ? "y" : "ies"
                  })`}
                {secondaryEvals.length > 0 &&
                  ` · ${secondaryEvals.length} impact statement${
                    secondaryEvals.length === 1 ? "" : "s"
                  }`}
              </>
            )}
          </button>
          {expanded && (
            <div className="mt-2 space-y-2 rounded-md bg-slate-50/60 p-3">
              {filledComments.map(({ key, label }) => (
                <div key={key}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {label}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-text-main">
                    {detail![key]}
                  </p>
                </div>
              ))}
              {secondaryEvals.map((s, idx) => (
                <div key={`sec-${idx}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Impact statement
                    {s.evaluator_name ? ` — ${s.evaluator_name}` : ""}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-text-main">
                    {s.impact_statement || "—"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-xs italic text-text-muted">
          {assignment.review_status === "reviewed"
            ? "PM evaluation has no narrative comments."
            : "Not yet evaluated by PM."}
        </p>
      )}
    </article>
  );
}

// ── Main ────────────────────────────────────────────────────────────

export function MenteeAnnualSummaryTab({
  mentee,
  onReload,
}: MenteeAnnualSummaryTabProps) {
  const { settings } = useSystemSettings();
  const activeFyToken = settings?.active_cycle_name
    ? extractFyToken(settings.active_cycle_name)
    : "";

  // Map cycle_name → AnnualReview for fast lookup.
  const reviewByCycle = useMemo(() => {
    const m = new Map<string, AnnualReview>();
    for (const r of mentee.reviews_list) {
      m.set(extractFyToken(r.cycle_name), r);
    }
    return m;
  }, [mentee.reviews_list]);

  // FYs the picker exposes: every FY with a review row + the active FY (so
  // the mentor can land here even before the mentee files self-review).
  const availableFys = useMemo(() => {
    const s = new Set<string>();
    if (activeFyToken) s.add(activeFyToken);
    for (const r of mentee.reviews_list) s.add(extractFyToken(r.cycle_name));
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [mentee.reviews_list, activeFyToken]);

  const [selectedFy, setSelectedFy] = useState(
    activeFyToken || availableFys[0] || "",
  );

  // Settings load is async — once active FY arrives, default to it.
  useEffect(() => {
    if (activeFyToken && !selectedFy) setSelectedFy(activeFyToken);
  }, [activeFyToken, selectedFy]);

  const selectedReview = selectedFy
    ? reviewByCycle.get(selectedFy) ?? null
    : null;
  const selectedYear = selectedFy ? fyTokenToStartYear(selectedFy) : null;
  const isActiveFy = !!activeFyToken && selectedFy === activeFyToken;

  const goalsInFy = useMemo(
    () =>
      selectedYear !== null
        ? mentee.goals_list.filter((g) => g.fy_year === selectedYear)
        : [],
    [mentee.goals_list, selectedYear],
  );

  // Group projects by half within the FY. `cycle` may be "H1 FY26-27",
  // "H2 FY26-27", "FY26-27" (annual cadence), etc. Anything tagged to the
  // selected FY belongs in this section; the half prefix decides grouping.
  const projectsInFy = useMemo(() => {
    if (!selectedFy) return { h1: [], h2: [], unknown: [] };
    const buckets: {
      h1: MenteeProjectAssignment[];
      h2: MenteeProjectAssignment[];
      unknown: MenteeProjectAssignment[];
    } = { h1: [], h2: [], unknown: [] };
    for (const p of mentee.project_assignments) {
      if (!p.cycle) continue;
      if (extractFyToken(p.cycle) !== selectedFy) continue;
      const upper = p.cycle.toUpperCase();
      if (upper.startsWith("H1")) buckets.h1.push(p);
      else if (upper.startsWith("H2")) buckets.h2.push(p);
      else buckets.unknown.push(p);
    }
    return buckets;
  }, [mentee.project_assignments, selectedFy]);

  // Eval modal state
  const [evalOpen, setEvalOpen] = useState(false);
  const [evalSaving, setEvalSaving] = useState(false);
  const [evalDraftSaving, setEvalDraftSaving] = useState(false);
  const [evalError, setEvalError] = useState("");
  const confirm = useConfirm();

  const handleEvalSubmit = async (
    reviewId: number,
    payload: MentorEvalPayload,
  ) => {
    const ok = await confirm({
      title: `Submit annual review for ${mentee.full_name}?`,
      message: `Submit your evaluation for ${mentee.full_name} (${formatFyLabel(
        selectedFy,
      )}). Once submitted you can't edit it, and the review is forwarded to management for final calibration.`,
      variant: "warning",
      confirmText: "Submit Evaluation",
    });
    if (!ok) return;
    setEvalSaving(true);
    setEvalError("");
    try {
      await annualReviewService.submitMentorEval(reviewId, payload);
      setEvalOpen(false);
      onReload();
    } catch (err) {
      setEvalError(getErrorMessage(err));
    } finally {
      setEvalSaving(false);
    }
  };

  const handleEvalSaveDraft = async (
    reviewId: number,
    payload: MentorEvalDraftPayload,
  ) => {
    setEvalDraftSaving(true);
    setEvalError("");
    try {
      await annualReviewService.saveMentorDraft(reviewId, payload);
      onReload();
    } catch (err) {
      setEvalError(getErrorMessage(err));
    } finally {
      setEvalDraftSaving(false);
    }
  };

  // Adapt selectedReview into a MenteeAnnualReview for the shared modal.
  const enrichedReview: MenteeAnnualReview | null = selectedReview
    ? {
        ...selectedReview,
        employee_name: mentee.full_name,
        employee_email: mentee.email,
        department: mentee.department_name,
        designation: mentee.designation_name,
      }
    : null;

  const status = selectedReview?.status ?? null;
  const canFill = isActiveFy && status === "pending_mentor";

  // CTA / status note copy. Only states where the mentor *can't* act yet
  // get a hint here (pre-mentor stages). Post-mentor states are conveyed
  // entirely by the green "Reviewed" pill — no extra note.
  const ctaNote: string | null = (() => {
    if (!isActiveFy) return null;
    if (status === null) return "Awaiting mentee's self-review";
    if (status === "draft") return "Mentee is drafting their self-review";
    return null;
  })();

  if (availableFys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border bg-surface px-6 py-10 text-center">
        <ClipboardCheck className="h-6 w-6 text-text-muted" />
        <p className="mt-2 text-sm font-medium text-text-main">
          No annual review cycles yet
        </p>
        <p className="text-xs text-text-muted">
          Once the active fiscal year is configured, the summary will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header strip — year picker, status, CTA */}
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <label
            htmlFor="annual-summary-fy"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            FY
          </label>
          <select
            id="annual-summary-fy"
            value={selectedFy}
            onChange={(e) => setSelectedFy(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer"
          >
            {availableFys.map((fy) => (
              <option key={fy} value={fy}>
                {formatFyLabel(fy)}
                {fy === activeFyToken ? " (current)" : ""}
              </option>
            ))}
          </select>
          <StatusPill status={status} />
        </div>
        <div className="flex items-center gap-2">
          {canFill ? (
            <button
              type="button"
              onClick={() => {
                setEvalError("");
                setEvalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              <ClipboardCheck className="h-4 w-4" />
              Fill Annual Review for {formatFyLabel(selectedFy)}
            </button>
          ) : ctaNote ? (
            <p className="text-xs italic text-text-muted">{ctaNote}</p>
          ) : null}
        </div>
      </div>

      {/* Mentee self review */}
      {selectedReview &&
        (selectedReview.self_overall_review ||
          selectedReview.self_performance_rating !== null) && (
          <SelfReviewCard review={selectedReview} />
        )}

      {/* Goals section */}
      <section className="space-y-3">
        <header className="flex items-center gap-2">
          <Target className="h-4 w-4 text-text-muted" />
          <h2 className="text-sm font-semibold text-text-main">
            Annual Goals
            <span className="ml-1 font-normal text-text-muted">
              ({goalsInFy.length} in {formatFyLabel(selectedFy)})
            </span>
          </h2>
        </header>
        {goalsInFy.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center text-xs text-text-muted">
            No annual goals in {formatFyLabel(selectedFy)} yet.
          </div>
        ) : (
          <div className="space-y-3">
            {goalsInFy.map((g) => (
              <GoalSummaryCard key={g.id} goal={g} />
            ))}
          </div>
        )}
      </section>

      {/* Projects section */}
      <section className="space-y-3">
        <header className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-text-muted" />
          <h2 className="text-sm font-semibold text-text-main">
            Project Reviews
            <span className="ml-1 font-normal text-text-muted">
              (
              {projectsInFy.h1.length +
                projectsInFy.h2.length +
                projectsInFy.unknown.length}{" "}
              in {formatFyLabel(selectedFy)})
            </span>
          </h2>
        </header>
        {projectsInFy.h1.length +
          projectsInFy.h2.length +
          projectsInFy.unknown.length ===
        0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center text-xs text-text-muted">
            No project reviews recorded for {formatFyLabel(selectedFy)}.
          </div>
        ) : (
          <div className="space-y-4">
            {projectsInFy.h1.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  H1
                </p>
                {projectsInFy.h1.map((p) => (
                  <ProjectSummaryCard
                    key={`h1-${p.project_id}`}
                    assignment={p}
                  />
                ))}
              </div>
            )}
            {projectsInFy.h2.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  H2
                </p>
                {projectsInFy.h2.map((p) => (
                  <ProjectSummaryCard
                    key={`h2-${p.project_id}`}
                    assignment={p}
                  />
                ))}
              </div>
            )}
            {projectsInFy.unknown.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Annual / Other
                </p>
                {projectsInFy.unknown.map((p) => (
                  <ProjectSummaryCard
                    key={`u-${p.project_id}`}
                    assignment={p}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Eval modal */}
      {evalOpen && enrichedReview && (
        <EvalModal
          review={enrichedReview}
          onSubmit={handleEvalSubmit}
          onSaveDraft={handleEvalSaveDraft}
          onClose={() => {
            setEvalOpen(false);
            setEvalError("");
          }}
          isSaving={evalSaving}
          isDraftSaving={evalDraftSaving}
          error={evalError}
        />
      )}
    </div>
  );
}
