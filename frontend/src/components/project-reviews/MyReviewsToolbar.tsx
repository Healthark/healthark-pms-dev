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
  projectCodeFilter,
  onProjectCodeFilterChange,
  availableProjectCodes,
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
  readonly projectCodeFilter: string;
  readonly onProjectCodeFilterChange: (v: string) => void;
  readonly availableProjectCodes: readonly string[];
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
      <div className="flex items-center gap-2">
        <label
          htmlFor="my-project-code-filter"
          className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
        >
          Project Code
        </label>
        <StringCombobox
          id="my-project-code-filter"
          options={availableProjectCodes}
          value={projectCodeFilter}
          onChange={onProjectCodeFilterChange}
          placeholder="All codes"
          minWidth="150px"
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
      {/* Status + Clear share a non-wrapping group so Clear never lands alone
          on its own row: when the toolbar wraps, the Status filter comes down
          with it (instead of Clear stranded right-aligned in a sea of space). */}
      <div className="flex items-center gap-4">
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
            <option value="pending">Pending</option>
            <option value="reviewed">PM Reviewed</option>
          </select>
        </div>
        <ClearFiltersButton active={hasActiveFilters} onClear={onClearFilters} />
      </div>
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
