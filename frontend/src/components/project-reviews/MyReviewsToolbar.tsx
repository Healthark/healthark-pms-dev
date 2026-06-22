import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { StringCombobox } from "../common/StringCombobox";

/**
 * Toolbar for the My Reviews tab: a cycle select, a searchable Project
 * combobox, and pm / status selects.
 *
 * State lives in the parent (ProjectReviews page); this component is a
 * pure controlled-input collection.
 */
export function MyReviewsToolbar({
  selectedCycle,
  onSelectedCycleChange,
  availableCycles,
  projectFilter,
  onProjectFilterChange,
  availableProjects,
  pmFilter,
  onPmFilterChange,
  availablePMs,
  statusFilter,
  onStatusFilterChange,
  hasActiveFilters,
  onClearFilters,
}: {
  readonly selectedCycle: string;
  readonly onSelectedCycleChange: (v: string) => void;
  readonly availableCycles: readonly string[];
  readonly projectFilter: string;
  readonly onProjectFilterChange: (v: string) => void;
  readonly availableProjects: readonly string[];
  readonly pmFilter: string;
  readonly onPmFilterChange: (v: string) => void;
  readonly availablePMs: readonly string[];
  readonly statusFilter: string;
  readonly onStatusFilterChange: (v: string) => void;
  readonly hasActiveFilters: boolean;
  readonly onClearFilters: () => void;
}) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <FilterSelect
        label="Cycle"
        value={selectedCycle}
        onChange={onSelectedCycleChange}
        allLabel="All Cycles"
        options={availableCycles}
        minWidth={120}
      />
      <div className="flex items-center gap-2">
        <label
          htmlFor="my-project-filter"
          className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
        >
          Project
        </label>
        <StringCombobox
          id="my-project-filter"
          options={availableProjects}
          value={projectFilter === "all" ? "" : projectFilter}
          onChange={(v) => onProjectFilterChange(v || "all")}
          placeholder="All projects"
        />
      </div>
      <FilterSelect
        label="PM"
        value={pmFilter}
        onChange={onPmFilterChange}
        allLabel="All PMs"
        options={availablePMs}
        minWidth={140}
      />
      <div className="flex items-center gap-2">
        <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
          Status
        </label>
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
        >
          <option value="all">All</option>
          <option value="reviewed">Reviewed</option>
          <option value="pending">Pending</option>
        </select>
      </div>
      <ClearFiltersButton
        active={hasActiveFilters}
        onClear={onClearFilters}
        className="ml-auto"
      />
    </div>
  );
}

// Small local helper — only used here, not worth its own file.
function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
  minWidth,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly allLabel: string;
  readonly options: readonly string[];
  readonly minWidth: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer"
        style={{ minWidth: `${minWidth}px` }}
      >
        <option value="all">{allLabel}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}
