import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  projectService,
  type ProjectResponse,
  type ProjectQuery,
  type ProjectsFilterOptions,
} from "../services/project.service";
import type { Page } from "../services/pagination";

/**
 * Strict, shared query key for the admin projects list
 * (`GET /projects/?include_completed=true`). Currently a single consumer
 * — `ProjectsTab` — but lives in `src/queries/` so future consumers
 * (e.g. a project picker elsewhere) dedupe automatically.
 *
 * The list always fetches with `include_completed=true` so toggling the
 * "Active / Completed / All" status filter is purely client-side.
 *
 * Mutations covered here are the *single-call* ones owned by ProjectsTab:
 *   - delete (soft delete)
 *   - markComplete
 *   - reopen
 *
 * Project create / update + assignment CRUD remain inside ProjectModal as
 * direct service calls — that flow is a compound transaction (project +
 * N assignments) better treated as a single black box for now. The parent
 * (ProjectsTab) invalidates `['admin', 'projects']` after the modal save
 * completes, so the list refreshes.
 */
// `adminProjectsQueryKey` stays the static prefix used by every mutation's
// invalidation — it prefix-matches the param-keyed page entries + the
// filter-options entry below, so delete/complete/reopen/modal-save refetch
// the visible page (and the dropdowns) automatically.
export const adminProjectsQueryKey = ["admin", "projects"] as const;
export const adminProjectsPageQueryKey = (params: ProjectQuery) =>
  ["admin", "projects", "page", params] as const;
export const projectsFilterOptionsQueryKey = [
  "admin",
  "projects",
  "filter-options",
] as const;

/** Paginated project list for the Admin Projects table. Param-keyed +
 *  keepPreviousData so paging/filtering doesn't blank the table. */
export function useAdminProjects(params: ProjectQuery) {
  return useQuery<Page<ProjectResponse>>({
    queryKey: adminProjectsPageQueryKey(params),
    queryFn: () => projectService.listProjects(params),
    placeholderData: keepPreviousData,
  });
}

// Year + PM dropdown options change only as projects are created /
// archived; cache for 60s so they don't refetch per page/filter/sort.
const PROJECTS_FILTER_OPTIONS_STALE_TIME = 60_000;

export function useProjectsFilterOptions() {
  return useQuery<ProjectsFilterOptions>({
    queryKey: projectsFilterOptionsQueryKey,
    queryFn: () => projectService.getProjectsFilterOptions(),
    staleTime: PROJECTS_FILTER_OPTIONS_STALE_TIME,
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: number) => projectService.deleteProject(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminProjectsQueryKey });
    },
  });
}

export function useMarkProjectComplete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: number) => projectService.markComplete(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminProjectsQueryKey });
    },
  });
}

export function useReopenProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: number) => projectService.reopen(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminProjectsQueryKey });
    },
  });
}
