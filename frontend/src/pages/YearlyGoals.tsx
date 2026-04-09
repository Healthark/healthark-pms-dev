import { useState, useEffect, useCallback } from "react";
import { Plus, Target } from "lucide-react";
import {
  goalService,
  type Goal,
  type GoalCreatePayload,
  type GoalUpdatePayload,
} from "../services/goal.service";
import { useAuth } from "../hooks/useAuth";
import { getErrorMessage } from "../utils/errors";
import { GoalGroup } from "../components/goals/GoalGroup";
import { GoalFormModal } from "../components/goals/GoalFormModal";

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
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add your first goal
      </button>
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
                className="h-28 rounded-lg border border-border bg-surface p-4"
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

export function YearlyGoals() {
  const { user } = useAuth();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadGoals = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await goalService.getMyGoals();
      setGoals(data);
    } catch {
      // Goals list stays empty — user sees the empty state
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGoals();
  }, [loadGoals]);

  const openAdd = () => {
    setEditingGoal(null);
    setModalError("");
    setShowModal(true);
  };
  const openEdit = (goal: Goal) => {
    setEditingGoal(goal);
    setModalError("");
    setShowModal(true);
  };
  const closeModal = () => {
    setShowModal(false);
    setEditingGoal(null);
    setModalError("");
  };

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

  // Stats
  const countByStatus = (status: Goal["status"]) =>
    goals.filter((g) => g.status === status).length;

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
        <button
          type="button"
          onClick={openAdd}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Goal
        </button>
      </div>

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

      {/* Content */}
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
            />
          ))}
        </div>
      )}

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
