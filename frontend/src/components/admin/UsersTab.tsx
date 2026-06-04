import { useEffect, useState } from "react";
import { Search, Pencil, UserX, UserCheck } from "lucide-react";
import type {
  UserResponse,
  UserQuery,
  DepartmentBrief,
  DesignationBrief,
} from "../../services/admin.service";
import { StatusBadge } from "./StatusBadge";
import { SortableHeader } from "../SortableHeader";
import { type SortState } from "../../utils/sort";
import { ExportExcelButton } from "../exports/ExportExcelButton";
import { TablePagination } from "../common/TablePagination";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { exportService } from "../../services/export.service";
import {
  useDeactivateUser,
  useReactivateUser,
  useUsersPage,
} from "../../queries/users";
import { useCoverageGaps } from "../../queries/adminSettings";
import { useConfirm } from "../../hooks/useConfirm";
import { useDebounce } from "../../hooks/useDebounce";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { getErrorMessage } from "../../utils/errors";

interface UsersTabProps {
  readonly departments: DepartmentBrief[];
  readonly designations: DesignationBrief[];
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;
  readonly onEdit: (user: UserResponse) => void;
}

type UsersSortKey =
  | "full_name"
  | "email"
  | "mentor_name"
  | "department_name"
  | "designation_name"
  | "status";

type RoleFilter = "all" | "Admin" | "Staff";
type StatusFilter = "all" | "active" | "inactive";
type DepartmentFilter = "all" | number;
type DesignationFilter = "all" | number;

const ROLE_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "Admin", label: "Admin" },
  { value: "Staff", label: "Staff" },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const FILTER_LABEL_CLS =
  "text-[11px] font-bold uppercase tracking-wider text-text-muted";
const FILTER_SELECT_CLS =
  "rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";
// Header cells, pinned to the page. The table has no internal scroll: it grows
// to fit its rows and the app shell's <main> (overflow-y-auto) is the scroll
// container, so `sticky top-0` pins each <th> to the top of <main> as the page
// scrolls — the column names stay visible while reading down a long table.
// Each <th> is pinned individually (sticky on <thead> is flaky cross-engine)
// with a fully OPAQUE background + z-20 so rows scroll completely behind it,
// and the bottom border lives on the cell so it travels with the pinned row
// under border-separate. (Works because the tab card has no overflow/transform
// that would otherwise capture the sticky context.)
const HEADER_CELL_CLS =
  "sticky top-0 z-20 px-5 py-3 border-b border-border bg-surface-muted";

export function UsersTab({
  departments,
  designations,
  searchQuery,
  onSearchChange,
  onEdit,
}: UsersTabProps) {
  const deactivateMutation = useDeactivateUser();
  const reactivateMutation = useReactivateUser();
  const confirm = useConfirm();
  const toast = useToast();
  const snackbar = useSnackbar();

  const [sort, setSort] = useState<SortState<UsersSortKey> | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [departmentFilter, setDepartmentFilter] = useState<DepartmentFilter>("all");
  const [designationFilter, setDesignationFilter] = useState<DesignationFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // The search box is controlled by the parent (AdminPanel) via the
  // `searchQuery` prop. Debounce it locally into `debouncedSearch` so the
  // server query fires once after the user pauses, not per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  const [pushSearch] = useDebounce((value: string) => {
    setDebouncedSearch(value);
    setPage(1);
  }, 300);
  useEffect(() => {
    pushSearch(searchQuery);
  }, [searchQuery, pushSearch]);

  // Reset to page 1 whenever a filter/sort/pageSize changes (page itself
  // is not a dep, so Next/Prev don't bounce back to 1).
  useEffect(() => {
    setPage(1);
  }, [roleFilter, statusFilter, departmentFilter, designationFilter, sort, pageSize]);

  const query: UserQuery = {
    page,
    per_page: pageSize,
    search: debouncedSearch || undefined,
    role: roleFilter !== "all" ? roleFilter : undefined,
    status: statusFilter,
    department_id: departmentFilter !== "all" ? departmentFilter : undefined,
    designation_id: designationFilter !== "all" ? designationFilter : undefined,
    sort_by: sort?.key,
    sort_dir: sort?.direction,
  };

  const { data, isLoading, isFetching } = useUsersPage(query);
  const users = data?.items ?? [];
  const total = data?.total ?? 0;

  // Orphaned mentees (mentor was deactivated) — highlight their rows amber so
  // the admin can spot who needs a new mentor. Mirrors the coverage banner.
  const { data: coverageGaps } = useCoverageGaps();
  const orphanedMenteeIds = new Set(
    (coverageGaps?.orphaned_mentees ?? []).map((m) => m.id),
  );

  const hasActiveFilters =
    !!debouncedSearch ||
    roleFilter !== "all" ||
    statusFilter !== "all" ||
    departmentFilter !== "all" ||
    designationFilter !== "all";

  const clearFilters = () => {
    onSearchChange("");
    setRoleFilter("all");
    setStatusFilter("all");
    setDepartmentFilter("all");
    setDesignationFilter("all");
    setPage(1);
  };

  const handleDeactivate = async (user: UserResponse) => {
    const ok = await confirm({
      title: "Deactivate user?",
      message: `Deactivate ${user.full_name}? They will no longer be able to log in. This can be reversed by reactivating the user.`,
      variant: "danger",
      confirmText: "Deactivate",
    });
    if (!ok) return;
    try {
      await deactivateMutation.mutateAsync(user.id);
      toast.success(`${user.full_name} deactivated.`);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const handleReactivate = async (user: UserResponse) => {
    const ok = await confirm({
      title: "Reactivate user?",
      message: `Reactivate ${user.full_name}? They will regain access immediately using their previous password. Historical goals, reviews, and mentor assignment are preserved.`,
      variant: "default",
      confirmText: "Reactivate",
    });
    if (!ok) return;
    try {
      const updated = await reactivateMutation.mutateAsync(user.id);
      toast.success(`${updated.full_name} reactivated.`);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  return (
    <div>
      {/* Toolbar — search + filters */}
      <div className="border-b border-border px-5 py-4 flex items-center gap-4 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search by name, email or code…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-4 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
            aria-label="Search users"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="user-role-filter" className={FILTER_LABEL_CLS}>Role</label>
          <select
            id="user-role-filter"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
            className={`${FILTER_SELECT_CLS} min-w-[120px]`}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="user-status-filter" className={FILTER_LABEL_CLS}>Status</label>
          <select
            id="user-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className={`${FILTER_SELECT_CLS} min-w-[120px]`}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="user-department-filter" className={FILTER_LABEL_CLS}>Department</label>
          <select
            id="user-department-filter"
            value={departmentFilter}
            onChange={(e) =>
              setDepartmentFilter(e.target.value === "all" ? "all" : Number(e.target.value))
            }
            className={`${FILTER_SELECT_CLS} min-w-[160px]`}
          >
            <option value="all">All</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="user-designation-filter" className={FILTER_LABEL_CLS}>Designation</label>
          <select
            id="user-designation-filter"
            value={designationFilter}
            onChange={(e) =>
              setDesignationFilter(e.target.value === "all" ? "all" : Number(e.target.value))
            }
            className={`${FILTER_SELECT_CLS} min-w-[160px]`}
          >
            <option value="all">All</option>
            {designations.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <ClearFiltersButton active={hasActiveFilters} onClear={clearFilters} />
        <div className="ml-auto">
          <ExportExcelButton
            label="Export Users"
            onDownload={() => exportService.downloadUsers(undefined, "inline")}
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-sm text-text-muted">
          Loading users…
        </div>
      ) : (
        // No internal scroll: the table grows to fit all rows and the app
        // shell's <main> handles scrolling, so the page height adjusts to the
        // record count instead of trapping rows in a 75vh box.
        <div
          className={`transition-opacity ${
            isFetching ? "opacity-60" : "opacity-100"
          }`}
          aria-busy={isFetching}
        >
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="bg-surface-muted text-left">
                <th className={HEADER_CELL_CLS}>
                  <SortableHeader label="Employee" columnKey="full_name" sort={sort} onSort={setSort} />
                </th>
                <th className={HEADER_CELL_CLS}>
                  <SortableHeader label="Email" columnKey="email" sort={sort} onSort={setSort} />
                </th>
                <th className={`${HEADER_CELL_CLS} text-xs font-semibold uppercase tracking-wide text-text-muted`}>
                  Phone
                </th>
                <th className={HEADER_CELL_CLS}>
                  <SortableHeader label="Mentor" columnKey="mentor_name" sort={sort} onSort={setSort} />
                </th>
                <th className={HEADER_CELL_CLS}>
                  <SortableHeader label="Department" columnKey="department_name" sort={sort} onSort={setSort} />
                </th>
                <th className={HEADER_CELL_CLS}>
                  <SortableHeader label="Designation" columnKey="designation_name" sort={sort} onSort={setSort} />
                </th>
                <th className={HEADER_CELL_CLS}>
                  <SortableHeader label="Status" columnKey="status" sort={sort} onSort={setSort} />
                </th>
                <th className={`${HEADER_CELL_CLS} text-xs font-semibold uppercase tracking-wide text-text-muted`}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {total === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-10 text-center text-text-muted"
                  >
                    {hasActiveFilters
                      ? "No users match your filters."
                      : "No users yet."}
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr
                    key={user.id}
                    title={
                      orphanedMenteeIds.has(user.id)
                        ? "This mentee's mentor was deactivated — assign a new mentor."
                        : undefined
                    }
                    className={`transition-colors ${
                      orphanedMenteeIds.has(user.id)
                        ? "bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-950/60"
                        : "hover:bg-surface-muted"
                    }${user.is_deleted ? " opacity-60" : ""}`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-text-main">
                          {user.full_name}
                        </span>
                        {user.role === "Admin" && (
                          <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                            Admin
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted">
                        {user.employee_code}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">
                      {user.email}
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">
                      {user.phone ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">
                      {user.mentor_name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">
                      {user.department?.name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">
                      {user.designation?.name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge isDeleted={user.is_deleted} />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(user)}
                          title="Edit user"
                          className="rounded-md p-1.5 text-text-muted hover:bg-brand-light hover:text-brand transition-colors"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {!user.is_deleted && (
                          <button
                            type="button"
                            onClick={() => handleDeactivate(user)}
                            title="Deactivate user"
                            className="rounded-md p-1.5 text-text-muted hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:text-red-300 transition-colors"
                          >
                            <UserX className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                        {user.is_deleted && (
                          <button
                            type="button"
                            onClick={() => handleReactivate(user)}
                            title="Reactivate user"
                            className="rounded-md p-1.5 text-text-muted hover:bg-green-50 dark:hover:bg-green-950/40 hover:text-green-600 dark:text-green-300 transition-colors"
                          >
                            <UserCheck className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && total > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          totalItems={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}
