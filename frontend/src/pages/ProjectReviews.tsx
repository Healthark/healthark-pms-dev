/**
 * ProjectReviews.tsx — Employee's Project Reviews Page.
 *
 * Shows a list of projects the employee is assigned to with:
 *   - Project name, code, dates (project start + assignment date)
 *   - Review status (not started / draft / submitted)
 *   - "Write Review" or "View Review" action
 *
 * Tabs (role-dependent):
 *   "My Reviews"    → All users — self-review cards
 *   "Evaluations"   → Primary evaluators — pending reviews to evaluate
 *
 * Placement: src/pages/ProjectReviews.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { Briefcase, CalendarDays, FileText, Loader2 } from "lucide-react";
import {
  projectReviewService,
  type MyProjectReviewCard,
  type ProjectReviewResponse,
} from "../services/project-review.service";
import { useAuth } from "../hooks/useAuth";
import { SelfReviewForm } from "../components/project-reviews/SelfReviewForm";
import { ReviewDetailView } from "../components/project-reviews/ReviewDetailView";
import { EvaluationsTab } from "../components/project-reviews/EvaluationsTab";

type ActiveTab = "my" | "evaluations";
type ViewMode = "list" | "self-review" | "detail";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Project Card ────────────────────────────────────────────────────

function ProjectCard({
  card,
  onWriteReview,
  onViewReview,
}: {
  readonly card: MyProjectReviewCard;
  readonly onWriteReview: (card: MyProjectReviewCard) => void;
  readonly onViewReview: (reviewId: number) => void;
}) {
  const hasReview = card.review_id !== null;
  const isSubmitted = card.review_status === "submitted";
  const canWrite = !hasReview || card.review_status === "draft";

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm flex flex-col gap-3 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light shrink-0">
            <Briefcase className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <div>
            <p className="font-medium text-text-main leading-snug">
              {card.project_name}
            </p>
            <span className="text-xs text-text-muted font-mono">
              {card.project_code}
            </span>
          </div>
        </div>

        {/* Status badge */}
        {!hasReview && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 shrink-0">
            Not Started
          </span>
        )}
        {card.review_status === "draft" && (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 shrink-0">
            Draft
          </span>
        )}
        {isSubmitted && (
          <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 shrink-0">
            Submitted
          </span>
        )}
      </div>

      {/* Role */}
      {card.assignment_role && (
        <p className="text-xs text-text-muted">
          Your Role: <span className="font-medium text-text-main">{card.assignment_role}</span>
        </p>
      )}

      {/* Dates */}
      <div className="flex flex-wrap gap-4 text-xs text-text-muted">
        <div className="flex items-center gap-1">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Project: {formatDate(card.project_start_date)}
          {card.project_end_date && ` — ${formatDate(card.project_end_date)}`}
        </div>
        {card.assigned_date && (
          <div className="flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            You joined: {formatDate(card.assigned_date)}
          </div>
        )}
      </div>

      {/* Primary feedback indicator */}
      {isSubmitted && card.primary_submitted && (
        <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          Manager feedback available
        </div>
      )}

      {/* Action */}
      <div className="mt-auto pt-2 border-t border-border">
        {canWrite ? (
          <button
            type="button"
            onClick={() => onWriteReview(card)}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            {hasReview ? "Continue Draft" : "Write Self-Review"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onViewReview(card.review_id!)}
            className="w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-slate-50 transition-colors"
          >
            View Review
          </button>
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
  const [cards, setCards] = useState<MyProjectReviewCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // For self-review form
  const [selectedCard, setSelectedCard] = useState<MyProjectReviewCard | null>(null);
  // For detail view
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

  const handleWriteReview = (card: MyProjectReviewCard) => {
    setSelectedCard(card);
    setViewMode("self-review");
  };

  const handleViewReview = (reviewId: number) => {
    setSelectedReviewId(reviewId);
    setViewMode("detail");
  };

  const handleBack = () => {
    setViewMode("list");
    setSelectedCard(null);
    setSelectedReviewId(null);
    void loadCards(); // Refresh to pick up status changes
  };

  // Check if user is a Primary evaluator on any project
  // (simplified: show evaluations tab for managers/admins)
  const showEvalTab = ["Admin", "Manager", "Principal"].includes(user?.role ?? "");

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  // ── Sub-views ─────────────────────────────────────────────────────
  if (viewMode === "self-review" && selectedCard) {
    return (
      <SelfReviewForm
        card={selectedCard}
        onBack={handleBack}
      />
    );
  }

  if (viewMode === "detail" && selectedReviewId) {
    return (
      <ReviewDetailView
        reviewId={selectedReviewId}
        onBack={handleBack}
      />
    );
  }

  // ── List View ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          Project Reviews
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          Write self-assessments for your projects and view evaluator feedback.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-border px-2">
          <button
            type="button"
            className={tabCls("my")}
            onClick={() => setActiveTab("my")}
          >
            My Reviews
          </button>
          {showEvalTab && (
            <button
              type="button"
              className={tabCls("evaluations")}
              onClick={() => setActiveTab("evaluations")}
            >
              Evaluations
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
                  <p className="font-display text-base font-medium text-text-main">
                    No projects assigned
                  </p>
                  <p className="mt-1 text-sm text-text-muted">
                    You'll see your projects here once HR assigns you.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {cards.map((card) => (
                    <ProjectCard
                      key={card.project_id}
                      card={card}
                      onWriteReview={handleWriteReview}
                      onViewReview={handleViewReview}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === "evaluations" && showEvalTab && <EvaluationsTab />}
        </div>
      </div>
    </div>
  );
}