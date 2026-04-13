/**
 * ProjectModal.tsx — Create/Edit Project with Team Assignments.
 *
 * Create mode: project form + add members inline before saving
 * Edit mode:   fetch project detail, update metadata, manage assignments
 *              (add/remove members, change roles/evaluator types)
 *
 * Placement: src/components/admin/ProjectModal.tsx
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plus, X, Loader2, UserPlus, Trash2 } from "lucide-react";
import {
  projectService,
  type ProjectDetail,
  type AssignmentResponse,
  type AssignmentCreatePayload,
} from "../../services/project.service";
import type { UserResponse } from "../../services/admin.service";
import { getErrorMessage } from "../../utils/errors";

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-text-muted mb-1";
const EVALUATOR_TYPES = ["", "Primary", "Secondary"] as const;

interface ProjectModalProps {
  readonly projectId: number | null; // null = create mode
  readonly users: UserResponse[];
  readonly onClose: () => void;
  readonly onSave: () => void;
}

interface DraftAssignment {
  tempId: string;
  user_id: string;
  assignment_role: string;
  evaluator_type: string;
  assigned_date: string;
}

let nextTemp = 0;
function tempId(): string {
  nextTemp += 1;
  return `tmp_${nextTemp}`;
}

function toDateInput(val: string | null | undefined): string {
  if (!val) return "";
  return val.slice(0, 10);
}

export function ProjectModal({
  projectId,
  users,
  onClose,
  onSave,
}: ProjectModalProps) {
  const isEditing = projectId !== null;

  // ── Form State ──────────────────────────────────────────────────
  const [projectCode, setProjectCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [allocatedHours, setAllocatedHours] = useState("");

  // ── Assignment State ────────────────────────────────────────────
  const [draftAssignments, setDraftAssignments] = useState<DraftAssignment[]>([]);
  const [existingAssignments, setExistingAssignments] = useState<AssignmentResponse[]>([]);

  // ── UI State ────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  // ── Load existing project in edit mode ──────────────────────────
  useEffect(() => {
    if (!isEditing) return;
    setIsLoading(true);
    projectService
      .getProjectDetail(projectId)
      .then((detail: ProjectDetail) => {
        setProjectCode(detail.project_code);
        setName(detail.name);
        setDescription(detail.description ?? "");
        setStartDate(toDateInput(detail.start_date));
        setEndDate(toDateInput(detail.end_date));
        setAllocatedHours(detail.allocated_hours ?? "");
        setExistingAssignments(detail.assignments);
      })
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setIsLoading(false));
  }, [isEditing, projectId]);

  // ── Draft Assignment Helpers ────────────────────────────────────
  const addDraftAssignment = () => {
    setDraftAssignments((prev) => [
      ...prev,
      {
        tempId: tempId(),
        user_id: "",
        assignment_role: "",
        evaluator_type: "",
        assigned_date: "",
      },
    ]);
  };

  const updateDraft = (id: string, field: keyof DraftAssignment, value: string) => {
    setDraftAssignments((prev) =>
      prev.map((a) => (a.tempId === id ? { ...a, [field]: value } : a)),
    );
  };

  const removeDraft = (id: string) => {
    setDraftAssignments((prev) => prev.filter((a) => a.tempId !== id));
  };

  // ── Remove Existing Assignment (Edit Mode) ─────────────────────
  const removeExisting = async (assignmentId: number) => {
    try {
      await projectService.removeAssignment(assignmentId);
      setExistingAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    }
  };

  // ── Already Assigned User IDs (for filtering dropdowns) ────────
  const assignedUserIds = new Set([
    ...existingAssignments.map((a) => a.user_id),
    ...draftAssignments.filter((a) => a.user_id).map((a) => Number(a.user_id)),
  ]);

  // ── Primary Evaluator Guard ────────────────────────────────────
  const hasPrimary =
    existingAssignments.some((a) => a.evaluator_type === "Primary") ||
    draftAssignments.some((a) => a.evaluator_type === "Primary");

  // ── Submit ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setIsSaving(true);
    setError("");

    try {
      if (isEditing) {
        // Update project metadata
        await projectService.updateProject(projectId, {
          project_code: projectCode,
          name,
          description: description || null,
          start_date: startDate || null,
          end_date: endDate || null,
          allocated_hours: allocatedHours || null,
        });

        // Add new assignments one by one
        for (const draft of draftAssignments) {
          if (!draft.user_id) continue;
          await projectService.addAssignment(projectId, {
            user_id: Number(draft.user_id),
            assignment_role: draft.assignment_role || null,
            evaluator_type: draft.evaluator_type || null,
            assigned_date: draft.assigned_date || null,
          });
        }
      } else {
        // Build assignments payload
        const assignments: AssignmentCreatePayload[] = draftAssignments
          .filter((a) => a.user_id)
          .map((a) => ({
            user_id: Number(a.user_id),
            assignment_role: a.assignment_role || null,
            evaluator_type: a.evaluator_type || null,
            assigned_date: a.assigned_date || null,
          }));

        await projectService.createProject({
          project_code: projectCode,
          name,
          description: description || null,
          start_date: startDate || null,
          end_date: endDate || null,
          allocated_hours: allocatedHours || null,
          assignments,
        });
      }

      onSave();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const canSubmit = projectCode.trim() && name.trim() && !isSaving;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-modal-title"
    >
      <div className="w-full max-w-2xl rounded-xl bg-surface shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <h2
            id="project-modal-title"
            className="font-display text-base font-semibold text-text-main"
          >
            {isEditing ? "Edit Project" : "Create New Project"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-text-muted">
              <Loader2 className="h-5 w-5 animate-spin mr-2" aria-hidden="true" />
              Loading project…
            </div>
          ) : (
            <>
              {error && (
                <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
                  {error}
                </p>
              )}

              {/* ── Project Details ────────────────────────────── */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="proj-code" className={LABEL_CLS}>
                    Project Code *
                  </label>
                  <input
                    id="proj-code"
                    className={INPUT_CLS}
                    value={projectCode}
                    onChange={(e) => setProjectCode(e.target.value)}
                    placeholder="PRJ-001"
                  />
                </div>
                <div>
                  <label htmlFor="proj-name" className={LABEL_CLS}>
                    Project Name *
                  </label>
                  <input
                    id="proj-name"
                    className={INPUT_CLS}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Market Access Study Q2"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="proj-desc" className={LABEL_CLS}>
                  Description
                </label>
                <textarea
                  id="proj-desc"
                  rows={2}
                  className={`${INPUT_CLS} resize-none`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of the project scope…"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="proj-start" className={LABEL_CLS}>
                    Start Date
                  </label>
                  <input
                    id="proj-start"
                    type="date"
                    className={INPUT_CLS}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="proj-end" className={LABEL_CLS}>
                    End Date
                  </label>
                  <input
                    id="proj-end"
                    type="date"
                    className={INPUT_CLS}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="proj-hours" className={LABEL_CLS}>
                    Allocated Hours
                  </label>
                  <input
                    id="proj-hours"
                    className={INPUT_CLS}
                    value={allocatedHours}
                    onChange={(e) => setAllocatedHours(e.target.value)}
                    placeholder="e.g. 200"
                  />
                </div>
              </div>

              {/* ── Team Members ───────────────────────────────── */}
              <div className="border-t border-border pt-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
                    Team Members
                  </p>
                  <button
                    type="button"
                    onClick={addDraftAssignment}
                    className="flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                  >
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add Member
                  </button>
                </div>

                {/* Existing Assignments (Edit Mode) */}
                {existingAssignments.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-slate-50 px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-text-main">
                        {a.user_name}
                      </span>
                      {a.assignment_role && (
                        <span className="ml-2 text-xs text-text-muted">
                          ({a.assignment_role})
                        </span>
                      )}
                    </div>
                    {a.evaluator_type && (
                      <span className="rounded-full bg-brand-light px-2 py-0.5 text-xs font-medium text-brand shrink-0">
                        {a.evaluator_type}
                      </span>
                    )}
                    {a.assigned_date && (
                      <span className="text-xs text-text-muted shrink-0">
                        Joined: {a.assigned_date}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeExisting(a.id)}
                      className="shrink-0 rounded-md p-1 text-text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                      aria-label={`Remove ${a.user_name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}

                {/* Draft Assignments (New members) */}
                {draftAssignments.map((draft) => (
                  <div
                    key={draft.tempId}
                    className="grid grid-cols-12 gap-2 items-end"
                  >
                    {/* User Select — 3 cols */}
                    <div className="col-span-3">
                      <label className={LABEL_CLS}>Employee</label>
                      <select
                        className={INPUT_CLS}
                        value={draft.user_id}
                        onChange={(e) =>
                          updateDraft(draft.tempId, "user_id", e.target.value)
                        }
                      >
                        <option value="">Select…</option>
                        {users
                          .filter(
                            (u) =>
                              !assignedUserIds.has(u.id) ||
                              String(u.id) === draft.user_id,
                          )
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.full_name}
                            </option>
                          ))}
                      </select>
                    </div>

                    {/* Role — 3 cols */}
                    <div className="col-span-3">
                      <label className={LABEL_CLS}>Project Role</label>
                      <input
                        className={INPUT_CLS}
                        value={draft.assignment_role}
                        onChange={(e) =>
                          updateDraft(draft.tempId, "assignment_role", e.target.value)
                        }
                        placeholder="e.g. Tester"
                      />
                    </div>

                    {/* Evaluator Type — 2 cols */}
                    <div className="col-span-2">
                      <label className={LABEL_CLS}>Evaluator</label>
                      <select
                        className={INPUT_CLS}
                        value={draft.evaluator_type}
                        onChange={(e) =>
                          updateDraft(draft.tempId, "evaluator_type", e.target.value)
                        }
                      >
                        <option value="">None</option>
                        {EVALUATOR_TYPES.filter((t) => t !== "").map((t) => (
                          <option
                            key={t}
                            value={t}
                            disabled={t === "Primary" && hasPrimary && draft.evaluator_type !== "Primary"}
                          >
                            {t}
                            {t === "Primary" && hasPrimary && draft.evaluator_type !== "Primary"
                              ? " (taken)"
                              : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Assigned Date — 3 cols */}
                    <div className="col-span-2">
                      <label className={LABEL_CLS}>Joined</label>
                      <input
                        type="date"
                        className={INPUT_CLS}
                        value={draft.assigned_date}
                        onChange={(e) =>
                          updateDraft(draft.tempId, "assigned_date", e.target.value)
                        }
                      />
                    </div>

                    {/* Remove — 1 col */}
                    <div className="col-span-1 flex justify-center pb-1">
                      <button
                        type="button"
                        onClick={() => removeDraft(draft.tempId)}
                        className="rounded-md p-1.5 text-text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                        aria-label="Remove member"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}

                {existingAssignments.length === 0 &&
                  draftAssignments.length === 0 && (
                    <p className="text-xs text-text-muted italic text-center py-3">
                      No team members added yet. Click "Add Member" above.
                    </p>
                  )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {isSaving
              ? "Saving…"
              : isEditing
                ? "Save Changes"
                : "Create Project"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}