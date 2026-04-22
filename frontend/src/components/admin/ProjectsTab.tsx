/**
 * ProjectsTab.tsx — Admin Panel tab for managing projects (Revised).
 *
 * Changes:
 *   - Removed allocated hours column
 *   - Shows expected end date
 *   - Shows "Reports To" column (PM's senior reviewer)
 *
 * Placement: src/components/admin/ProjectsTab.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { Search, Plus, Pencil, Trash2, Users, FolderOpen } from "lucide-react";
import {
  projectService,
  type ProjectResponse,
} from "../../services/project.service";
import { adminService, type UserResponse } from "../../services/admin.service";
import { getErrorMessage } from "../../utils/errors";
import { ProjectModal } from "./ProjectModal";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { useConfirm } from "../../hooks/useConfirm";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const TABLE_HEADERS = [
  "Project",
  "Code",
  "Start",
  "Expected End",
  "Reports To",
  "Members",
  "Actions",
];

export function ProjectsTab() {
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);

  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [projectsData, usersData] = await Promise.all([
        projectService.listProjects(),
        adminService.getUsers(),
      ]);
      setProjects(projectsData);
      setUsers(usersData.filter((u) => !u.is_deleted));
    } catch {
      // stays empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleDelete = async (project: ProjectResponse) => {
    const ok = await confirm({
      title: "Delete project?",
      message: `Delete "${project.name}"? This is a soft delete — the project is hidden but can be restored later.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;

    try {
      await projectService.deleteProject(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      toast.success(`"${project.name}" deleted.`);
    } catch (err: unknown) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const openCreate = () => {
    setEditingProjectId(null);
    setShowModal(true);
  };

  const openEdit = (projectId: number) => {
    setEditingProjectId(projectId);
    setShowModal(true);
  };

  const handleModalClose = () => {
    setShowModal(false);
    setEditingProjectId(null);
  };

  const handleModalSave = () => {
    handleModalClose();
    void loadData();
  };

  const filtered = projects.filter((p) => {
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.project_code.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {/* Toolbar */}
      <div className="border-b border-border px-5 py-4 flex items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search by name or code…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-4 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
            aria-label="Search projects"
          />
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity shrink-0"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Project
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-sm text-text-muted">
          Loading projects…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FolderOpen className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
          <p className="font-display text-base font-medium text-text-main">
            {searchQuery ? "No projects match your search" : "No projects yet"}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {searchQuery
              ? "Try a different search term."
              : "Create your first project to start assigning team members."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left">
                {TABLE_HEADERS.map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((project) => (
                <tr
                  key={project.id}
                  className="transition-colors hover:bg-slate-50"
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
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono text-text-muted">
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
                    {project.reports_to_name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1.5 text-text-muted">
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      {project.member_count}
                    </div>
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
                      <button
                        type="button"
                        onClick={() => handleDelete(project)}
                        title="Delete project"
                        className="rounded-md p-1.5 text-text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
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

      {showModal && (
        <ProjectModal
          projectId={editingProjectId}
          users={users}
          onClose={handleModalClose}
          onSave={handleModalSave}
        />
      )}
    </div>
  );
}