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

// Shared snapshot/rollback shape for the three project lifecycle
// mutations below — each cancels in-flight refetches, snapshots the
// cached list, mutates the row in place (or drops it for delete), and
// rolls back to the snapshot if the server rejects.
type ProjectsContext = { previous: ProjectResponse[] | undefined };

function snapshotAdminProjects(
  qc: ReturnType<typeof useQueryClient>,
): Promise<ProjectsContext> {
  return qc
    .cancelQueries({ queryKey: adminProjectsQueryKey })
    .then(() => ({
      previous: qc.getQueryData<ProjectResponse[]>(adminProjectsQueryKey),
    }));
}

function rollbackAdminProjects(
  qc: ReturnType<typeof useQueryClient>,
  context: ProjectsContext | undefined,
): void {
  if (context?.previous !== undefined) {
    qc.setQueryData(adminProjectsQueryKey, context.previous);
  }
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation<void, Error, number, ProjectsContext>({
    mutationFn: (projectId: number) => projectService.deleteProject(projectId),
    // Optimistic: row vanishes from the table on click. The soft-delete
    // is server-authoritative; if it fails (e.g. project has active
    // reviews) the rollback restores the row.
    onMutate: async (projectId) => {
      const context = await snapshotAdminProjects(qc);
      qc.setQueryData<ProjectResponse[]>(adminProjectsQueryKey, (old) =>
        old?.filter((p) => p.id !== projectId),
      );
      return context;
    },
    onError: (_err, _vars, context) => rollbackAdminProjects(qc, context),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminProjectsQueryKey });
    },
  });
}

export function useMarkProjectComplete() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, number, ProjectsContext>({
    mutationFn: (projectId: number) => projectService.markComplete(projectId),
    // Optimistic: status pill flips to "completed" instantly. Important
    // for the Active filter — the row leaves the visible set without
    // waiting for the refetch.
    onMutate: async (projectId) => {
      const context = await snapshotAdminProjects(qc);
      qc.setQueryData<ProjectResponse[]>(adminProjectsQueryKey, (old) =>
        old?.map((p) => (p.id === projectId ? { ...p, status: "completed" } : p)),
      );
      return context;
    },
    onError: (_err, _vars, context) => rollbackAdminProjects(qc, context),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminProjectsQueryKey });
    },
  });
}

export function useReopenProject() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, number, ProjectsContext>({
    mutationFn: (projectId: number) => projectService.reopen(projectId),
    // Optimistic: status pill flips to "active" instantly.
    onMutate: async (projectId) => {
      const context = await snapshotAdminProjects(qc);
      qc.setQueryData<ProjectResponse[]>(adminProjectsQueryKey, (old) =>
        old?.map((p) => (p.id === projectId ? { ...p, status: "active" } : p)),
      );
      return context;
    },
    onError: (_err, _vars, context) => rollbackAdminProjects(qc, context),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: adminProjectsQueryKey });
    },
  });
}
