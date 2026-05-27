import { useEffect, useMemo, useState } from "react";
import { Search, Pencil, UserX, UserCheck } from "lucide-react";
import type {
  UserResponse,
  DepartmentBrief,
  DesignationBrief,
} from "../../services/admin.service";
import { StatusBadge } from "./StatusBadge";
import { SortableHeader } from "../SortableHeader";
import {
  compareValues,
  type SortKind,
  type SortState,
} from "../../utils/sort";
import { ExportExcelButton } from "../exports/ExportExcelButton";
import { TablePagination } from "../common/TablePagination";
import { exportService } from "../../services/export.service";
import { useDeactivateUser, useReactivateUser, useUsers } from "../../queries/users";
import { useConfirm } from "../../hooks/useConfirm";
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

const USERS_SORT_CONFIG: Record<
  UsersSortKey,
  { kind: SortKind; get: (u: UserResponse, all: readonly UserResponse[]) => unknown }
> = {
  full_name:        { kind: "alpha", get: (u) => u.full_name },
  email:            { kind: "alpha", get: (u) => u.email },
  mentor_name:      {
    kind: "alpha",
    get: (u, all) =>
      u.mentor_id ? all.find((x) => x.id === u.mentor_id)?.full_name ?? null : null,
  },
  department_name:  { kind: "alpha", get: (u) => u.department?.name ?? null },
  designation_name: { kind: "alpha", get: (u) => u.designation?.name ?? null },
  status:           { kind: "alpha", get: (u) => (u.is_deleted ? "Inactive" : "Active") },
};

const FILTER_LABEL_CLS =
  "text-[11px] font-bold uppercase tracking-wider text-text-muted";
const FILTER_SELECT_CLS =
  "rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";
// Sticky header cells. Each <th> is pinned individually (the reliable
// cross-browser pattern — sticky on <thead> is flaky in some engines) with a
// fully OPAQUE background so rows scrolling underneath are completely hidden,
// not blurred-but-visible. z-20 keeps it above tbody. The bottom border lives
// on the cell so it travels with the pinned row (a <tr> border would scroll
// away under border-separate).
const HEADER_CELL_CLS =
  "sticky top-0 z-20 px-5 py-3 border-b border-border bg-surface-muted";

export function UsersTab({
  departments,
  designations,
  searchQuery,
  onSearchChange,
  onEdit,
}: UsersTabProps) {
  const { data: users = [], isLoading } = useUsers();
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
  // Client-side pagination (frontend-only until the backend paginates).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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

  const visibleUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = users.filter((u) => {
      if (q) {
        const matchesSearch =
          u.full_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.employee_code.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter === "active" && u.is_deleted) return false;
      if (statusFilter === "inactive" && !u.is_deleted) return false;
      if (departmentFilter !== "all" && u.department?.id !== departmentFilter) return false;
      if (designationFilter !== "all" && u.designation?.id !== designationFilter) return false;
      return true;
    });
    if (!sort) return filtered;
    const { kind, get } = USERS_SORT_CONFIG[sort.key];
    return filtered.slice().sort((a, b) =>
      compareValues(get(a, users), get(b, users), kind, sort.direction),
    );
  }, [users, searchQuery, roleFilter, statusFilter, departmentFilter, designationFilter, sort]);

  // Snap back to the first page whenever the filtered set or page size
  // changes, so the user never lands on a now-empty page.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, roleFilter, statusFilter, departmentFilter, designationFilter, pageSize]);

  const pagedUsers = useMemo(
    () => visibleUsers.slice((page - 1) * pageSize, page * pageSize),
    [visibleUsers, page, pageSize],
  );

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
        // The table gets its OWN scroll region. Page-level sticky can't be
        // used here: the app shell's <main> sets `zoom: 0.9` and `p-6`, both
        // of which break CSS `position: sticky` (zoom corrupts the sticky
        // offset; a padded scroll container leaves rows visible above a
        // top:0 header). An `overflow-auto` wrapper with no padding/zoom is a
        // clean scroll context where the sticky <thead> pins reliably with no
        // gap or bleed-through. max-height keeps it generous but bounded.
        <div className="max-h-[75vh] overflow-auto">
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
              {visibleUsers.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-10 text-center text-text-muted"
                  >
                    No users match your filters.
                  </td>
                </tr>
              ) : (
                pagedUsers.map((user) => (
                  <tr
                    key={user.id}
                    className={`transition-colors hover:bg-surface-muted ${user.is_deleted ? "opacity-60" : ""}`}
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
                      {users.find((u) => u.id === user.mentor_id)?.full_name ?? "—"}
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

      {!isLoading && visibleUsers.length > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          totalItems={visibleUsers.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
    </div>
  );
}
