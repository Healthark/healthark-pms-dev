/**
 * ProjectsTab.tsx — Admin Panel tab for managing projects (Revised).
 *
 * Changes:
 *   - Removed allocated hours column
 *   - Shows end date (column header label "End Date"; backend field stays expected_end_date)
 *   - Shows "PM" column (Primary evaluator on the project)
 *   - Shows "PM Reports To" column (PM's senior reviewer)
 *
 * Placement: src/components/admin/ProjectsTab.tsx
 */

import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useCallback,
  useImperativeHandle,
  useMemo,
  type Ref,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search, Pencil, Trash2, Users, FolderOpen,
  CheckCircle2, RotateCcw,
} from "lucide-react";
import { type ProjectResponse } from "../../services/project.service";
import { ClearFiltersButton } from "../common/ClearFiltersButton";
import { getErrorMessage } from "../../utils/errors";
import { useUsers } from "../../queries/users";
import {
  adminProjectsQueryKey,
  useAdminProjects,
  useDeleteProject,
  useMarkProjectComplete,
  useReopenProject,
} from "../../queries/adminProjects";
import { exportService } from "../../services/export.service";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { extractFyToken } from "../../utils/fy";
import { ExportExcelButton } from "../exports/ExportExcelButton";
import { TablePagination } from "../common/TablePagination";
// ProjectModal lazy-loaded (F3) — it's a 718-LOC form with heavy
// deps (UserCombobox, multiple queries) that only mounts when admin
// clicks "Create" or the per-row pencil. Wrapping in React.lazy
// splits it into its own chunk, shaving the AdminPanel initial
// download for non-modal sessions. See docs/optimizations/20-lazy-modals.md.
const ProjectModal = lazy(() =>
  import("./ProjectModal").then((m) => ({ default: m.ProjectModal })),
);
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { useConfirm } from "../../hooks/useConfirm";
import { SortableHeader } from "../SortableHeader";
import {
  compareValues,
  type SortKind,
  type SortState,
} from "../../utils/sort";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

type ProjectsSortKey =
  | "name"
  | "project_code"
  | "start_date"
  | "expected_end_date"
  | "pm_name"
  | "reports_to_name"
  | "member_count"
  | "status";

const PROJECTS_SORT_CONFIG: Record<
  ProjectsSortKey,
  { kind: SortKind; get: (p: ProjectResponse) => unknown }
> = {
  name:              { kind: "alpha",   get: (p) => p.name },
  project_code:      { kind: "natural", get: (p) => p.project_code },
  start_date:        { kind: "alpha",   get: (p) => p.start_date },
  expected_end_date: { kind: "alpha",   get: (p) => p.expected_end_date },
  pm_name:           { kind: "alpha",   get: (p) => p.pm_name },
  reports_to_name:   { kind: "alpha",   get: (p) => p.reports_to_name },
  member_count:      { kind: "numeric", get: (p) => p.member_count },
  status:            { kind: "alpha",   get: (p) => p.status },
};

type StatusFilter = "active" | "completed" | "all";

const FILTER_LABEL_CLS =
  "text-[11px] font-bold uppercase tracking-wider text-text-muted";
const FILTER_SELECT_CLS =
  "rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";
// Sticky header cells. Each <th> is pinned individually (reliable across
// engines; sticky on <thead> is flaky) with a fully OPAQUE background so rows
// scrolling underneath are completely hidden. z-20 keeps it above tbody; the
// bottom border lives on the cell so it travels with the pinned row under
// border-separate. Mirrors UsersTab.
const HEADER_CELL_CLS =
  "sticky top-0 z-20 px-5 py-3 border-b border-border bg-surface-muted";

export interface ProjectsTabHandle {
  openCreate: () => void;
}

interface ProjectsTabProps {
  readonly ref?: Ref<ProjectsTabHandle>;
}

export function ProjectsTab({ ref }: ProjectsTabProps = {}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [sort, setSort] = useState<SortState<ProjectsSortKey> | null>(null);
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [pmFilter, setPmFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Client-side pagination (frontend-only until the backend paginates).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { settings } = useSystemSettings();
  const exportFy = settings?.active_cycle_name
    ? extractFyToken(settings.active_cycle_name)
    : undefined;

  // Shared ['users'] cache — stays in sync after admin user mutations.
  // Same active-only filter that used to live in the old loadData.
  const { data: allUsers = [], isLoading: isUsersLoading } = useUsers();
  const users = useMemo(
    () => allUsers.filter((u) => !u.is_deleted),
    [allUsers],
  );

  // ['admin', 'projects'] — shared TanStack cache. Always fetches with
  // include_completed=true so the Active / Completed / All status filter
  // is a pure client-side narrowing.
  const { data: projects = [], isLoading: isProjectsLoading } = useAdminProjects();
  const isLoading = isProjectsLoading || isUsersLoading;

  // Mutation hooks — each invalidates ['admin', 'projects'] on success,
  // which triggers a refetch and updates the table without manual
  // setState chains.
  const deleteMutation = useDeleteProject();
  const markCompleteMutation = useMarkProjectComplete();
  const reopenMutation = useReopenProject();

  const handleDelete = async (project: ProjectResponse) => {
    const ok = await confirm({
      title: "Delete project?",
      message: `Delete "${project.name}"? This is a soft delete — the project is hidden but can be restored later.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(project.id);
      toast.success(`"${project.name}" deleted.`);
    } catch (err: unknown) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const handleMarkComplete = async (project: ProjectResponse) => {
    const ok = await confirm({
      title: "Mark project as completed?",
      message:
        `"${project.name}" will be archived. The team list is preserved; ` +
        "new assignments and new reviews are blocked until the project " +
        "is re-opened.",
      confirmText: "Mark Complete",
    });
    if (!ok) return;
    try {
      await markCompleteMutation.mutateAsync(project.id);
      toast.success(`"${project.name}" marked as completed.`);
    } catch (err: unknown) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const handleReopen = async (project: ProjectResponse) => {
    const ok = await confirm({
      title: "Re-open project?",
      message:
        `Re-open "${project.name}"? It will return to the active list ` +
        "and become available for new assignments and reviews.",
      confirmText: "Re-open",
    });
    if (!ok) return;
    try {
      await reopenMutation.mutateAsync(project.id);
      toast.success(`"${project.name}" re-opened.`);
    } catch (err: unknown) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const openCreate = useCallback(() => {
    setEditingProjectId(null);
    setShowModal(true);
  }, []);

  useImperativeHandle(ref, () => ({ openCreate }), [openCreate]);

  const openEdit = (projectId: number) => {
    setEditingProjectId(projectId);
    setShowModal(true);
  };

  const handleModalClose = () => {
    setShowModal(false);
    setEditingProjectId(null);
  };

  // ProjectModal owns a compound transaction (project create/update +
  // assignment CRUD). When it finishes, we just invalidate the list
  // cache and let TanStack refetch — covers create, update, and any
  // member-count changes from assignment adds/removes.
  const handleModalSave = () => {
    handleModalClose();
    queryClient.invalidateQueries({ queryKey: adminProjectsQueryKey });
  };

  const availableYears = useMemo(
    () =>
      Array.from(
        new Set(
          projects
            .map((p) =>
              p.start_date ? new Date(p.start_date).getFullYear() : null,
            )
            .filter((y): y is number => y !== null),
        ),
      ).sort((a, b) => b - a),
    [projects],
  );

  const availablePms = useMemo(
    () =>
      Array.from(
        new Set(
          projects
            .map((p) => p.pm_name)
            .filter((n): n is string => !!n),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [projects],
  );

  const visibleProjects = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = projects.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (q) {
        const matchesSearch =
          p.name.toLowerCase().includes(q) ||
          p.project_code.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }
      if (yearFilter !== "all") {
        const year = p.start_date
          ? new Date(p.start_date).getFullYear().toString()
          : null;
        if (year !== yearFilter) return false;
      }
      if (pmFilter !== "all" && p.pm_name !== pmFilter) return false;
      return true;
    });
    if (!sort) return filtered;
    const { kind, get } = PROJECTS_SORT_CONFIG[sort.key];
    return filtered
      .slice()
      .sort((a, b) => compareValues(get(a), get(b), kind, sort.direction));
  }, [projects, searchQuery, yearFilter, pmFilter, statusFilter, sort]);

  // Snap back to the first page whenever the filtered set or page size
  // changes, so the user never lands on a now-empty page.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, yearFilter, pmFilter, statusFilter, pageSize]);

  const pagedProjects = useMemo(
    () => visibleProjects.slice((page - 1) * pageSize, page * pageSize),
    [visibleProjects, page, pageSize],
  );

  const hasActiveFilters =
    !!searchQuery ||
    yearFilter !== "all" ||
    pmFilter !== "all" ||
    statusFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setYearFilter("all");
    setPmFilter("all");
    setStatusFilter("all");
    setPage(1);
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
            placeholder="Search by name or code…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-4 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
            aria-label="Search projects"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="project-year-filter" className={FILTER_LABEL_CLS}>
            Start Year
          </label>
          <select
            id="project-year-filter"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className={`${FILTER_SELECT_CLS} min-w-[120px]`}
          >
            <option value="all">All Years</option>
            {availableYears.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="project-pm-filter" className={FILTER_LABEL_CLS}>
            PM
          </label>
          <select
            id="project-pm-filter"
            value={pmFilter}
            onChange={(e) => setPmFilter(e.target.value)}
            className={`${FILTER_SELECT_CLS} min-w-[160px]`}
          >
            <option value="all">All PMs</option>
            {availablePms.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="project-status-filter" className={FILTER_LABEL_CLS}>
            Status
          </label>
          <select
            id="project-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className={`${FILTER_SELECT_CLS} min-w-[120px]`}
          >
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="all">All</option>
          </select>
        </div>
        <ClearFiltersButton active={hasActiveFilters} onClear={clearFilters} />
        <div className="ml-auto">
          <ExportExcelButton
            label="Export Projects"
            onDownload={() => exportService.downloadProjects(exportFy, "inline")}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-sm text-text-muted">
          Loading projects…
        </div>
      ) : visibleProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FolderOpen className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
          <p className="font-display text-base font-medium text-text-main">
            {projects.length === 0
              ? "No projects yet"
              : "No projects match your filters"}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {projects.length === 0
              ? "Create your first project to start assigning team members."
              : "Try adjusting your search or filters."}
          </p>
        </div>
      ) : (
        // The table gets its OWN scroll region. Page-level sticky can't be
        // used here: the app shell's <main> sets `zoom: 0.9` and `p-6`, both
        // of which break CSS `position: sticky` (zoom corrupts the sticky
        // offset; a padded scroll container leaves rows visible above a
        // top:0 header). An `overflow-auto` wrapper with no padding/zoom pins
        // the sticky <thead> reliably with no gap or bleed-through. Mirrors
        // UsersTab.
        <div className="max-h-[75vh] overflow-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="bg-surface-muted text-left">
                <th className={HEADER_CELL_CLS}>
                  <SortableHeader label="Project" columnKey="name" sort={sort} onSort={setSort} />
                </th>
                <th className={HEADER_CELL_CLS}>
                  <SortableHeader label="Code" columnKey="project_code" sort={sort} onSort={setSort} />
                </th>
                <th className={HEADER_CELL_CLS}>
                  <SortableHeader label="Start Date" columnKey="start_date" sort={sort} onSort={setSort} />
                </th>
                <th className={HEADER_CELL_CLS}>
                  <SortableHeader label="End Date" columnKey="expected_end_date" sort={sort} onSort={setSort} />
                </th>
                <th className={HEADER_CELL_CLS}>
                  <SortableHeader label="PM" columnKey="pm_name" sort={sort} onSort={setSort} />
                </th>
                <th className={HEADER_CELL_CLS}>
                  <SortableHeader label="PM Reports To" columnKey="reports_to_name" sort={sort} onSort={setSort} />
                </th>
                <th className={HEADER_CELL_CLS}>
                  <SortableHeader label="Members" columnKey="member_count" sort={sort} onSort={setSort} />
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
              {pagedProjects.map((project) => (
                <tr
                  key={project.id}
                  className="transition-colors hover:bg-surface-muted"
                >
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-text-main">
                      {project.name}
                    </div>
                    {project.description && (
                      <div className="text-xs text-text-muted line-clamp-1 mt-0.5">
                        {project.description}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="rounded-md bg-surface-hover px-2 py-0.5 text-xs font-mono text-text-muted">
                      {project.project_code}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-text-muted">
                    {formatDate(project.start_date)}
                  </td>
                  <td className="px-5 py-3.5 text-text-muted">
                    {formatDate(project.expected_end_date)}
                  </td>
                  <td className="px-5 py-3.5 text-text-muted">
                    {project.pm_name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-text-muted">
                    {project.reports_to_name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1.5 text-text-muted">
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      {project.member_count}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    {project.status === "completed" ? (
                      <span
                        title={
                          project.completed_at
                            ? `Completed ${formatDate(project.completed_at)}` +
                              (project.completed_by_name
                                ? ` by ${project.completed_by_name}`
                                : "")
                            : "Completed"
                        }
                        className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-bold uppercase text-text-muted"
                      >
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        Completed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-950/40 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700 dark:text-green-300">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(project.id)}
                        title="Edit project"
                        className="rounded-md p-1.5 text-text-muted hover:bg-brand-light hover:text-brand transition-colors"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      {project.status === "active" ? (
                        <button
                          type="button"
                          onClick={() => handleMarkComplete(project)}
                          title="Mark as completed"
                          className="rounded-md p-1.5 text-text-muted hover:bg-green-50 dark:hover:bg-green-950/40 hover:text-green-700 dark:text-green-300 transition-colors"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleReopen(project)}
                          title="Re-open project"
                          className="rounded-md p-1.5 text-text-muted hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:text-amber-700 dark:text-amber-300 transition-colors"
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(project)}
                        title="Delete project"
                        className="rounded-md p-1.5 text-text-muted hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:text-red-300 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && visibleProjects.length > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          totalItems={visibleProjects.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

      <Suspense fallback={null}>
        {showModal && (
          <ProjectModal
            projectId={editingProjectId}
            users={users}
            onClose={handleModalClose}
            onSave={handleModalSave}
          />
        )}
      </Suspense>
    </div>
  );
}