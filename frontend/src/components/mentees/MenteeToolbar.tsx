import { AlertTriangle } from "lucide-react";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { StringCombobox } from "../common/StringCombobox";

interface MenteeToolbarProps {
  readonly employeeFilter: string;
  readonly onEmployeeChange: (value: string) => void;
  readonly employeeOptions: string[];
  readonly onlyPending: boolean;
  readonly onOnlyPendingChange: (value: boolean) => void;
  readonly totalPendingActions: number;
  readonly hasActiveFilters: boolean;
  readonly onClearFilters: () => void;
}

/**
 * My Mentees list toolbar — standardized: a searchable Mentee combobox + a
 * "Needs attention" filter + Clear. No free-text search bar or Cards/Table
 * toggle (sorting is via the table's column headers).
 */
export function MenteeToolbar({
  employeeFilter,
  onEmployeeChange,
  employeeOptions,
  onlyPending,
  onOnlyPendingChange,
  totalPendingActions,
  hasActiveFilters,
  onClearFilters,
}: MenteeToolbarProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <label
          htmlFor="mentee-employee-filter"
          className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
        >
          Mentee
        </label>
        <StringCombobox
          id="mentee-employee-filter"
          options={employeeOptions}
          value={employeeFilter}
          onChange={onEmployeeChange}
          placeholder="All mentees"
        />
      </div>

      <button
        type="button"
        onClick={() => onOnlyPendingChange(!onlyPending)}
        className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${
          onlyPending
            ? "border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
            : "border-border bg-surface text-text-muted hover:text-text-main"
        }`}
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        Needs attention
        {totalPendingActions > 0 && (
          <span
            className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              onlyPending
                ? "bg-amber-200 text-amber-800 dark:text-amber-300"
                : "bg-surface-hover text-text-muted"
            }`}
          >
            {totalPendingActions}
          </span>
        )}
      </button>

      <ClearFiltersButton
        active={hasActiveFilters}
        onClear={onClearFilters}
        className="ml-auto"
      />
    </div>
  );
}
