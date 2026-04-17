import { useState, useEffect, useCallback } from "react";
import { Plus, Target, Lock } from "lucide-react";
import {
  goalService,
  type Goal,
  type GoalCreatePayload,
  type GoalUpdatePayload,
  type Criterion,
  type ApprovalStatus,
} from "../services/goal.service";
import { useAuth } from "../hooks/useAuth";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { getErrorMessage } from "../utils/errors";
import { YearlyGoalCard } from "../components/goals/YearlyGoalCard";
import { GoalFormModal } from "../components/goals/GoalFormModal";
import { TeamGoalsTab } from "../components/goals/TeamGoalsTab";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANAGER_ROLES = ["Admin", "Manager", "Principal"] as const;

type ApprovalFilter = "all" | ApprovalStatus;

const FILTER_CONFIG: { value: ApprovalFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Requested" },
  { value: "changes_requested", label: "Changes Required" },
  { value: "approved", label: "Approved" },
];

type ActiveTab = "my" | "team";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recomputeProgress(criteria: Criterion[]): number {
  if (criteria.length === 0) return 0;
  const completed = criteria.filter((c) => c.is_completed).length;
  return Math.round((completed / criteria.length) * 100);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FilterPills({
  goals,
  activeFilter,
  onFilterChange,
}: {
  goals: Goal[];
  activeFilter: ApprovalFilter;
  onFilterChange: (f: ApprovalFilter) => void;
}) {
  const count = (val: ApprovalFilter) =>
    val === "all"
      ? goals.length
      : goals.filter((g) => g.approval_status === val).length;

  return (
    <div className="flex flex-wrap gap-2">
      {FILTER_CONFIG.map((f) => {
        const isActive = activeFilter === f.value;
        const n = count(f.value);
        return (
          <button
            key={f.value}
            type="button"
            onClick={() => onFilterChange(f.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              isActive
                ? "bg-brand text-white"
                : "bg-slate-100 text-text-muted hover:bg-slate-200"
            }`}
          >
            {f.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                isActive
                  ? "bg-white/20 text-white"
                  : "bg-white text-text-muted"
              }`}
            >
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({
  onAdd,
  editGateOpen,
  hasFilter,
}: {
  onAdd: () => void;
  editGateOpen: boolean;
  hasFilter: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
      <Target className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
      <p className="font-display text-base font-medium text-text-main">
        {hasFilter ? "No goals match this filter" : "No goals yet"}
      </p>
      <p className="mt-1 text-sm text-text-muted">
        {hasFilter
          ? "Try selecting a different filter above."
          : editGateOpen
          ? "Set your first annual goal to start tracking progress."
          : "Goal submissions are currently closed. Check back when the next window opens."}
      </p>
      {!hasFilter && editGateOpen && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-4 flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add your first goal
        </button>
      )}
    </div>
  );
}

function GoalSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 animate-pulse">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className="h-44 rounded-lg border border-border bg-surface p-4"
        >
          <div className="h-3 w-3/4 rounded bg-slate-100 mb-3" />
          <div className="h-2.5 w-full rounded bg-slate-100" />
          <div className="h-2.5 w-2/3 rounded bg-slate-100 mt-1.5" />
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
  const { settings } = useSystemSettings();

  const isManager = MANAGER_ROLES.includes(
    user?.role as (typeof MANAGER_ROLES)[number],
  );
  const yearlyGoalsEditEnabled = settings?.yearly_goals_edit_enabled ?? false;

  // Extract bare FY label ("H1 FY26" → "FY26") for the page header.
  const fyLabel = settings?.active_cycle_name
    ? settings.active_cycle_name.split(" ").find((t) => t.startsWith("FY")) ??
      settings.active_cycle_name
    : null;

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>("all");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadGoals = useCallback(async () => {
    setIsLoading(true);
    try {
      setGoals(await goalService.getMyGoals("yearly"));
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

  // Create or update
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
        const created = await goalService.createGoal({
          ...(payload as GoalCreatePayload),
          goal_type: "yearly",
        });
        setGoals((prev) => [created, ...prev]);
      }
      closeModal();
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  // Submit draft / changes_requested goal for mentor review
  const handleSubmit = async (goal: Goal) => {
    try {
      const updated = await goalService.submitGoal(goal.id);
      setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
    } catch {
      /* goal stays in draft — user can retry */
    }
  };

  // Criterion toggle — client-side progress recompute for instant feedback
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

  const filteredGoals =
    approvalFilter === "all"
      ? goals
      : goals.filter((g) => g.approval_status === approvalFilter);

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
            {fyLabel && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                · {fyLabel}
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Define and track your annual objectives for mentor approval.
          </p>
        </div>

        {activeTab === "my" &&
          (yearlyGoalsEditEnabled ? (
            <button
              type="button"
              onClick={openAdd}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Goal
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Goal submissions are currently closed.
            </div>
          ))}
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
            <div className="space-y-4">
              {/* Filter pills — shown when goals exist, counts per state built in */}
              {!isLoading && goals.length > 0 && (
                <FilterPills
                  goals={goals}
                  activeFilter={approvalFilter}
                  onFilterChange={setApprovalFilter}
                />
              )}

              {/* Content */}
              {isLoading ? (
                <GoalSkeleton />
              ) : goals.length === 0 ? (
                <EmptyState
                  onAdd={openAdd}
                  editGateOpen={yearlyGoalsEditEnabled}
                  hasFilter={false}
                />
              ) : filteredGoals.length === 0 ? (
                <EmptyState
                  onAdd={openAdd}
                  editGateOpen={yearlyGoalsEditEnabled}
                  hasFilter={true}
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredGoals.map((goal) => (
                    <YearlyGoalCard
                      key={goal.id}
                      goal={goal}
                      onEdit={openEdit}
                      onSubmit={handleSubmit}
                      onCriterionUpdate={handleCriterionUpdate}
                      editGateOpen={yearlyGoalsEditEnabled}
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

      {/* Create / Edit modal */}
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
