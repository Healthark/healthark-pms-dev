import type { Goal, GoalStatus, Criterion } from "../../services/goal.service";
import { GoalCard } from "./GoalCard";

interface GoalGroupProps {
  readonly title: string;
  readonly dotClass: string;
  readonly goals: Goal[];
  readonly onEdit: (goal: Goal) => void;
  readonly onSubmit: (goal: Goal) => void;
  readonly onProgressUpdate: (goal: Goal, newStatus: GoalStatus) => void;
  readonly onCriterionUpdate: (goalId: number, updated: Criterion) => void;
}

export function GoalGroup({
  title,
  dotClass,
  goals,
  onEdit,
  onSubmit,
  onProgressUpdate,
  onCriterionUpdate,
}: GoalGroupProps) {
  if (goals.length === 0) return null;

  return (
    <section aria-labelledby={`group-${title}`}>
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${dotClass}`}
          aria-hidden="true"
        />
        <h2
          id={`group-${title}`}
          className="text-sm font-semibold text-text-main"
        >
          {title}
        </h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-text-muted">
          {goals.length}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {goals.map((goal) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            onEdit={onEdit}
            onSubmit={onSubmit}
            onProgressUpdate={onProgressUpdate}
            onCriterionUpdate={onCriterionUpdate}
          />
        ))}
      </div>
    </section>
  );
}
