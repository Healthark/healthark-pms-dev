import { Search, AlertTriangle, ArrowUpDown } from "lucide-react";

export type MenteeSortKey = "name" | "designation" | "pending";

interface MenteeToolbarProps {
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly onlyPending: boolean;
  readonly onOnlyPendingChange: (value: boolean) => void;
  readonly sortKey: MenteeSortKey;
  readonly onSortChange: (value: MenteeSortKey) => void;
  readonly totalPendingActions: number;
}

export function MenteeToolbar({
  search,
  onSearchChange,
  onlyPending,
  onOnlyPendingChange,
  sortKey,
  onSortChange,
  totalPendingActions,
}: MenteeToolbarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Left: search */}
      <div className="relative w-full sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <input
          type="search"
          placeholder="Search by name or employee code"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-text-main placeholder:text-text-muted focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      {/* Right: filter + sort */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOnlyPendingChange(!onlyPending)}
          className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${
            onlyPending
              ? "border-amber-300 bg-amber-50 text-amber-700"
              : "border-border bg-surface text-text-muted hover:text-text-main"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          Needs attention
          {totalPendingActions > 0 && (
            <span
              className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                onlyPending ? "bg-amber-200 text-amber-800" : "bg-slate-100 text-text-muted"
              }`}
            >
              {totalPendingActions}
            </span>
          )}
        </button>

        <div className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs">
          <ArrowUpDown className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
          <label htmlFor="mentee-sort" className="text-text-muted">
            Sort:
          </label>
          <select
            id="mentee-sort"
            value={sortKey}
            onChange={(e) => onSortChange(e.target.value as MenteeSortKey)}
            className="bg-transparent font-medium text-text-main focus:outline-none"
          >
            <option value="name">Name</option>
            <option value="designation">Designation</option>
            <option value="pending">Pending actions</option>
          </select>
        </div>
      </div>
    </div>
  );
}
