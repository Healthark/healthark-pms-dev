/**
 * YearlyGoals.tsx — Updated for Story 3.1 + 3.3.
 *
 * Changes:
 *   - Added handleCriterionUpdate to update a single criterion inside
 *     a goal's criteria array without refetching all goals
 *   - Passes onCriterionUpdate through GoalGroup → GoalCard → CriteriaChecklist
 *   - Progress_percent recomputed automatically by Pydantic on the next
 *     full refresh, but we also compute it client-side for instant feedback
 *
 * Placement: src/pages/YearlyGoals.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, Target } from "lucide-react";
import {
  goalService,
  type Goal,
  type GoalStatus,
  type GoalCreatePayload,
  type GoalUpdatePayload,
  type Criterion,
} from "../services/goal.service";
import { useAuth } from "../hooks/useAuth";
import { getErrorMessage } from "../utils/errors";
import { GoalGroup } from "../components/goals/GoalGroup";
import { GoalFormModal } from "../components/goals/GoalFormModal";
import { TeamGoalsTab } from "../components/goals/TeamGoalsTab";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANAGER_ROLES = ["Admin", "Manager", "Principal"] as const;

const GROUP_CONFIG = [
  { status: "pending" as const, label: "Pending", dotClass: "bg-amber-400" },
  {
    status: "in_progress" as const,
    label: "In Progress",
    dotClass: "bg-blue-400",
  },
  {
    status: "completed" as const,
    label: "Completed",
    dotClass: "bg-green-400",
  },
  {
    status: "cancelled" as const,
    label: "Cancelled",
    dotClass: "bg-slate-400",
  },
] as const;

type ActiveTab = "my" | "team";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Client-side progress recomputation after a criterion toggle.
 * Mirrors the backend's computed_field logic so the UI updates instantly
 * without waiting for a full goal refetch.
 */
function recomputeProgress(criteria: Criterion[]): number {
  if (criteria.length === 0) return 0;
  const completed = criteria.filter((c) => c.is_completed).length;
  return Math.round((completed / criteria.length) * 100);
}

// ---------------------------------------------------------------------------
// Stat pill
// ---------------------------------------------------------------------------

function StatPill({
  label,
  count,
  colorClass,
}: {
  label: string;
  count: number;
  colorClass: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-sm shadow-sm">
      <span className={`font-semibold ${colorClass}`}>{count}</span>
      <span className="text-text-muted">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
      <Target className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
      <p className="font-display text-base font-medium text-text-main">
        No goals yet
      </p>
      <p className="mt-1 text-sm text-text-muted">
        Set your first annual goal to start tracking progress.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function GoalSkeleton() {
  return (
    <div className="space-y-6">
      {[1, 2].map((g) => (
        <div key={g} className="space-y-3 animate-pulse">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-slate-200" />
            <div className="h-3 w-24 rounded bg-slate-200" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[1, 2].map((c) => (
              <div
                key={c}
                className="h-32 rounded-lg border border-border bg-surface p-4"
              >
                <div className="h-3 w-3/4 rounded bg-slate-100 mb-2" />
                <div className="h-2.5 w-full rounded bg-slate-100" />
                <div className="h-2.5 w-1/2 rounded bg-slate-100 mt-1.5" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function YearlyGoals() {
  const { user } = useAuth();
  const isManager = MANAGER_ROLES.includes(
    user?.role as (typeof MANAGER_ROLES)[number],
  );

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadGoals = useCallback(async () => {
    setIsLoading(true);
    try {
      setGoals(await goalService.getMyGoals());
    } catch {
      /* stays empty */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGoals();
  }, [loadGoals]);

  // Modal helpers
  const openAdd = () => {
    setEditingGoal(null);
    setModalError("");
    setShowModal(true);
  };
  const openEdit = (g: Goal) => {
    setEditingGoal(g);
    setModalError("");
    setShowModal(true);
  };
  const closeModal = () => {
    setShowModal(false);
    setEditingGoal(null);
    setModalError("");
  };

  // Save (create or update)
  const handleSave = async (payload: GoalCreatePayload | GoalUpdatePayload) => {
    setIsSaving(true);
    setModalError("");
    try {
      if (editingGoal) {
        const updated = await goalService.updateGoal(
          editingGoal.id,
          payload as GoalUpdatePayload,
        );
        setGoals((prev) =>
          prev.map((g) => (g.id === updated.id ? updated : g)),
        );
      } else {
        const created = await goalService.createGoal(
          payload as GoalCreatePayload,
        );
        setGoals((prev) => [created, ...prev]);
      }
      closeModal();
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  // Submit for review
  const handleSubmit = async (goal: Goal) => {
    try {
      const updated = await goalService.submitGoal(goal.id);
      setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
    } catch {
      // Goal stays in draft — user can retry
    }
  };

  // Quick progress cycling (approved goals only)
  const handleProgressUpdate = async (goal: Goal, newStatus: GoalStatus) => {
    try {
      const updated = await goalService.updateGoal(goal.id, {
        status: newStatus,
      });
      setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
    } catch {
      // Status stays unchanged — user can retry
    }
  };

  /**
   * Criterion update handler — replaces the updated criterion inside
   * the parent goal's criteria array and recomputes progress_percent
   * client-side for instant visual feedback.
   */
  const handleCriterionUpdate = useCallback(
    (goalId: number, updated: Criterion) => {
      setGoals((prev) =>
        prev.map((g) => {
          if (g.id !== goalId) return g;
          const newCriteria = g.criteria.map((c) =>
            c.id === updated.id ? updated : c,
          );
          return {
            ...g,
            criteria: newCriteria,
            progress_percent: recomputeProgress(newCriteria),
          };
        }),
      );
    },
    [],
  );

  const countByStatus = (s: Goal["status"]) =>
    goals.filter((g) => g.status === s).length;

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            Yearly Goals
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Define, track, and complete your annual objectives.
          </p>
        </div>
        {activeTab === "my" && (
          <button
            type="button"
            onClick={openAdd}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Goal
          </button>
        )}
      </div>

      {/* Tab container */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-border px-2">
          <button
            type="button"
            className={tabCls("my")}
            onClick={() => setActiveTab("my")}
          >
            My Goals
          </button>
          {isManager && (
            <button
              type="button"
              className={tabCls("team")}
              onClick={() => setActiveTab("team")}
            >
              Team Goals
            </button>
          )}
        </div>

        <div className="p-5">
          {/* ── My Goals tab ── */}
          {activeTab === "my" && (
            <div className="space-y-5">
              {/* Stats */}
              {!isLoading && goals.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <StatPill
                    label="Total"
                    count={goals.length}
                    colorClass="text-text-main"
                  />
                  <StatPill
                    label="Pending"
                    count={countByStatus("pending")}
                    colorClass="text-amber-600"
                  />
                  <StatPill
                    label="In Progress"
                    count={countByStatus("in_progress")}
                    colorClass="text-blue-600"
                  />
                  <StatPill
                    label="Completed"
                    count={countByStatus("completed")}
                    colorClass="text-green-600"
                  />
                </div>
              )}

              {isLoading ? (
                <GoalSkeleton />
              ) : goals.length === 0 ? (
                <EmptyState onAdd={openAdd} />
              ) : (
                <div className="space-y-8">
                  {GROUP_CONFIG.map(({ status, label, dotClass }) => (
                    <GoalGroup
                      key={status}
                      title={label}
                      dotClass={dotClass}
                      goals={goals.filter((g) => g.status === status)}
                      onEdit={openEdit}
                      onSubmit={handleSubmit}
                      onProgressUpdate={handleProgressUpdate}
                      onCriterionUpdate={handleCriterionUpdate}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Team Goals tab ── */}
          {activeTab === "team" && isManager && <TeamGoalsTab />}
        </div>
      </div>

      {/* Modal */}
      <GoalFormModal
        isOpen={showModal}
        onClose={closeModal}
        onSave={handleSave}
        editingGoal={editingGoal}
        userId={user?.user_id ?? 0}
        isSaving={isSaving}
        error={modalError}
      />
    </div>
  );
}
