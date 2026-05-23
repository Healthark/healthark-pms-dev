import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  projectService,
  type ProjectResponse,
} from "../services/project.service";

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
export const adminProjectsQueryKey = ["admin", "projects"] as const;

export function useAdminProjects() {
  return useQuery<ProjectResponse[]>({
    queryKey: adminProjectsQueryKey,
    queryFn: () => projectService.listProjects(true),
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
