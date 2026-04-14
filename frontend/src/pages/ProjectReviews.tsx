/**
 * ProjectReviews.tsx — Project Reviews Page (Revised PM-Centric Flow).
 *
 * No self-review. Employee just sees project cards with status:
 *   - "Pending" → waiting for PM to evaluate
 *   - "Reviewed" → can click to view the evaluation
 *
 * Tabs:
 *   "My Reviews"     → All users — project cards
 *   "Evaluate Team"  → PM (Primary evaluator) — evaluation queue
 *   "Secondary"      → Secondary evaluators — impact statement queue
 *
 * Placement: src/pages/ProjectReviews.tsx
 */

import { useState, useEffect, useCallback } from "react";
import {
  Briefcase, CalendarDays, Clock, CheckCircle2, Eye,
} from "lucide-react";
import {
  projectReviewService,
  type MyProjectCard,
} from "../services/project-review.service";
import { useAuth } from "../hooks/useAuth";
import { ReviewDetailView } from "../components/project-reviews/ReviewDetailView";
import { PMEvaluationTab } from "../components/project-reviews/PMEvaluationTab";
import { SecondaryEvalTab } from "../components/project-reviews/SecondaryEvalTab";

type ActiveTab = "my" | "evaluate" | "secondary";
type ViewMode = "list" | "detail";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Project Card (Employee View) ────────────────────────────────────

function ProjectCard({
  card,
  onViewReview,
}: {
  readonly card: MyProjectCard;
  readonly onViewReview: (reviewId: number) => void;
}) {
  const isReviewed = card.review_status === "reviewed";
  const isPending = card.review_status === "pending" || card.review_status === null;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm flex flex-col gap-3 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light shrink-0">
            <Briefcase className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <div>
            <p className="font-medium text-text-main leading-snug">{card.project_name}</p>
            <span className="text-xs text-text-muted font-mono">{card.project_code}</span>
          </div>
        </div>

        {/* Status badge */}
        {isPending && (
          <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 shrink-0">
            <Clock className="h-3 w-3" aria-hidden="true" />
            Pending
          </span>
        )}
        {isReviewed && (
          <span className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 shrink-0">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            Reviewed
          </span>
        )}
      </div>

      {/* Role + Department */}
      <div className="flex flex-wrap gap-3 text-xs text-text-muted">
        {card.assignment_role && (
          <span>Role: <span className="font-medium text-text-main">{card.assignment_role}</span></span>
        )}
        {card.department_name && (
          <span>Dept: <span className="font-medium text-text-main">{card.department_name}</span></span>
        )}
        {card.cycle && (
          <span>Cycle: <span className="font-medium text-text-main">{card.cycle}</span></span>
        )}
      </div>

      {/* Dates */}
      <div className="flex flex-wrap gap-4 text-xs text-text-muted">
        <div className="flex items-center gap-1">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Project: {formatDate(card.project_start_date)}
          {card.project_expected_end_date && ` — ${formatDate(card.project_expected_end_date)}`}
        </div>
        {card.assigned_date && (
          <div className="flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            You joined: {formatDate(card.assigned_date)}
          </div>
        )}
      </div>

      {/* Action */}
      <div className="mt-auto pt-2 border-t border-border">
        {isReviewed && card.review_id ? (
          <button
            type="button"
            onClick={() => onViewReview(card.review_id!)}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            View Evaluation
          </button>
        ) : (
          <div className="text-center text-xs text-text-muted py-2">
            Your project manager will evaluate your performance.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-9 w-9 rounded-lg bg-slate-100" />
        <div className="space-y-1.5">
          <div className="h-3 w-32 rounded bg-slate-100" />
          <div className="h-2.5 w-16 rounded bg-slate-100" />
        </div>
      </div>
      <div className="h-2.5 w-full rounded bg-slate-100 mb-2" />
      <div className="h-2.5 w-2/3 rounded bg-slate-100" />
    </div>
  );
}

// ── Page Component ──────────────────────────────────────────────────

export function ProjectReviews() {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [cards, setCards] = useState<MyProjectCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null);

  const loadCards = useCallback(async () => {
    setIsLoading(true);
    try {
      setCards(await projectReviewService.getMyProjects());
    } catch {
      // stays empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  const handleViewReview = (reviewId: number) => {
    setSelectedReviewId(reviewId);
    setViewMode("detail");
  };

  const handleBack = () => {
    setViewMode("list");
    setSelectedReviewId(null);
    void loadCards();
  };

  // Show evaluate tab for managers/admins (potential PMs)
  const showEvalTab = ["Admin", "Manager", "Principal"].includes(user?.role ?? "");

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  // ── Detail View ───────────────────────────────────────────────────
  if (viewMode === "detail" && selectedReviewId) {
    return <ReviewDetailView reviewId={selectedReviewId} onBack={handleBack} />;
  }

  // ── List View ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          Project Reviews
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          View your project evaluations and feedback from your project manager.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        <div className="flex border-b border-border px-2">
          <button type="button" className={tabCls("my")} onClick={() => setActiveTab("my")}>
            My Reviews
          </button>
          {showEvalTab && (
            <button type="button" className={tabCls("evaluate")} onClick={() => setActiveTab("evaluate")}>
              Evaluate Team
            </button>
          )}
          {showEvalTab && (
            <button type="button" className={tabCls("secondary")} onClick={() => setActiveTab("secondary")}>
              Secondary Reviews
            </button>
          )}
        </div>

        <div className="p-5">
          {activeTab === "my" && (
            <>
              {isLoading ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <CardSkeleton />
                  <CardSkeleton />
                  <CardSkeleton />
                </div>
              ) : cards.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
                  <Briefcase className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
                  <p className="font-display text-base font-medium text-text-main">No projects assigned</p>
                  <p className="mt-1 text-sm text-text-muted">You'll see your projects here once HR assigns you.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {cards.map((card) => (
                    <ProjectCard key={card.project_id} card={card} onViewReview={handleViewReview} />
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === "evaluate" && showEvalTab && <PMEvaluationTab />}
          {activeTab === "secondary" && showEvalTab && <SecondaryEvalTab />}
        </div>
      </div>
    </div>
  );
}