import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import {
  MenteeTable,
  type MenteeTableSortKey,
} from "../components/mentees/MenteeTable";
import { MenteeToolbar } from "../components/mentees/MenteeToolbar";
import { type MenteeSummary } from "../services/mentee.service";
import { useMenteeSummaries } from "../queries/mentees";
import { compareValues, type SortKind, type SortState } from "../utils/sort";
import { TablePagination } from "../components/common/TablePagination";

const MENTEE_TABLE_SORT_CONFIG: Record<
  MenteeTableSortKey,
  { kind: SortKind; get: (m: MenteeSummary) => unknown }
> = {
  full_name:             { kind: "alpha",   get: (m) => m.full_name },
  employee_code:         { kind: "natural", get: (m) => m.employee_code },
  email:                 { kind: "alpha",   get: (m) => m.email },
  department_name:       { kind: "alpha",   get: (m) => m.department_name },
  designation_name:      { kind: "alpha",   get: (m) => m.designation_name },
  pending_actions_count: { kind: "numeric", get: (m) => m.pending_actions_count },
};

export function MyMentees() {
  const { data: mentees = [], isPending, error: queryError } = useMenteeSummaries();
  const error = queryError
    ? "Could not load mentees. Please try again."
    : null;
  const isLoading = isPending;

  const [employeeFilter, setEmployeeFilter] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [tableSort, setTableSort] = useState<SortState<MenteeTableSortKey> | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const hasActiveFilters = !!employeeFilter || onlyPending;
  const clearFilters = () => {
    setEmployeeFilter("");
    setOnlyPending(false);
  };

  const totalPendingActions = useMemo(
    () => mentees.reduce((sum, m) => sum + m.pending_actions_count, 0),
    [mentees],
  );
  const employeeOptions = useMemo(
    () => Array.from(new Set(mentees.map((m) => m.full_name))).sort(),
    [mentees],
  );

  const visibleMentees = useMemo(() => {
    let out = mentees;
    if (employeeFilter) out = out.filter((m) => m.full_name === employeeFilter);
    if (onlyPending) out = out.filter((m) => m.pending_actions_count > 0);

    if (tableSort) {
      const { kind, get } = MENTEE_TABLE_SORT_CONFIG[tableSort.key];
      return [...out].sort((a, b) =>
        compareValues(get(a), get(b), kind, tableSort.direction),
      );
    }
    return [...out].sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [mentees, employeeFilter, onlyPending, tableSort]);

  // Client-side pagination. Reset to page 1 when filters / sort / page size
  // change — tracked during render (React's reset-in-effect alternative).
  const filterKey = [
    employeeFilter,
    String(onlyPending),
    pageSize,
    tableSort ? `${tableSort.key}:${tableSort.direction}` : "",
  ].join("|");
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  let currentPage = page;
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
    currentPage = 1;
  }
  const totalPages = Math.max(1, Math.ceil(visibleMentees.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = visibleMentees.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            My Mentees
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {isLoading
              ? "Loading your mentees…"
              : `${mentees.length} ${mentees.length === 1 ? "mentee" : "mentees"} reporting to you.`}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        <div className="p-5 space-y-5">
          {/* Toolbar */}
          {!isLoading && mentees.length > 0 && (
            <MenteeToolbar
              employeeFilter={employeeFilter}
              onEmployeeChange={setEmployeeFilter}
              employeeOptions={employeeOptions}
              onlyPending={onlyPending}
              onOnlyPendingChange={setOnlyPending}
              totalPendingActions={totalPendingActions}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearFilters}
            />
          )}

          {/* States */}
          {error && (
            <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {isLoading && (
            <div className="rounded-lg border border-border bg-surface px-4 py-12 text-center text-sm text-text-muted animate-pulse">
              Loading mentees…
            </div>
          )}

          {!isLoading && mentees.length === 0 && !error && <EmptyState />}

          {!isLoading && mentees.length > 0 && visibleMentees.length === 0 && (
            <div className="rounded-md border border-border bg-surface px-4 py-6 text-center text-sm text-text-muted">
              No mentees match your filters.
            </div>
          )}

          {!isLoading && visibleMentees.length > 0 && (
            <div className="space-y-3">
              <MenteeTable
                mentees={pageRows}
                sort={tableSort}
                onSort={setTableSort}
                startIndex={(safePage - 1) * pageSize}
              />
              <TablePagination
                page={safePage}
                pageSize={pageSize}
                totalItems={visibleMentees.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-light">
        <Users className="h-6 w-6 text-brand" aria-hidden="true" />
      </div>
      <div>
        <p className="font-medium text-text-main">No mentees assigned yet</p>
        <p className="mt-1 text-sm text-text-muted">
          When an HR administrator assigns mentees to you, they'll appear here.
        </p>
      </div>
    </div>
  );
}
