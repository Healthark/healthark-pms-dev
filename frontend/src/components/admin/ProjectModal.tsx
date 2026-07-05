/**
 * ProjectModal.tsx — Create/Edit Project with Team Assignments (Revised).
 *
 * Changes:
 *   - Removed allocated hours
 *   - expected_end_date instead of end_date
 *   - "PM Reports To" is a typeable searchable combobox (required)
 *   - "Secondary Evaluator" is a typeable searchable combobox (optional,
 *     project-level — replaces per-member Secondary)
 *   - Members have a single "PM" checkbox (max one across the project);
 *     no more Primary/Secondary dropdown on each row
 *   - Assignment rows include Department dropdown
 *   - Assignment role auto-fills from user's designation when selected
 *
 * Placement: src/components/admin/ProjectModal.tsx
 */

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, UserPlus, Trash2, Pencil, GripVertical } from "lucide-react";
import {
  projectService,
  type ProjectDetail,
  type AssignmentResponse,
  type AssignmentCreatePayload,
} from "../../services/project.service";
import {
  type UserResponse,
} from "../../services/admin.service";
import { getErrorMessage } from "../../utils/errors";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { UserCombobox } from "../common/UserCombobox";
import {
  useDepartments,
  useDesignations,
} from "../../queries/adminReferenceData";

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-text-muted mb-1";

interface ProjectModalProps {
  readonly projectId: number | null;
  readonly users: UserResponse[];
  readonly onClose: () => void;
  readonly onSave: () => void;
}

interface DraftAssignment {
  tempId: string;
  user_id: string;
  assignment_role: string;
  department_id: string;
  is_pm: boolean;
  assigned_date: string;
  /** Multi-PM mode only. manager_user_id = the member's PM within the project
   *  ("" = top PM); secondary_evaluator_id = per-member Secondary ("" = none).
   *  Both stringified user ids (from <select>). Ignored in single-PM mode. */
  manager_user_id: string;
  secondary_evaluator_id: string;
  /** When set, this draft is an in-place edit of the existing assignment
   *  with this id. Save will PATCH instead of POST; X will restore the
   *  original read-only row by simply dropping the draft. */
  existingId?: number;
}

let nextTemp = 0;
function tempId(): string {
  nextTemp += 1;
  return `tmp_${nextTemp}`;
}

/** Member pickers must offer active users only, matching the non-deleted
 *  `users` prop the modal is handed. UserCombobox pulls the full org list
 *  (incl. deactivated) from useUsers(), so this narrows it back. Module-scope
 *  keeps the reference stable so the combobox's memo doesn't thrash. */
const notDeleted = (u: UserResponse): boolean => !u.is_deleted;

function toDateInput(val: string | null | undefined): string {
  if (!val) return "";
  return val.slice(0, 10);
}

/** Readable date for the "removed on …" audit line (e.g. "12 Mar 2026"). */
function formatRemovedDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
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
  const [expectedEndDate, setExpectedEndDate] = useState("");
  const [reportsToId, setReportsToId] = useState<number | null>(null);
  const [secondaryEvaluatorId, setSecondaryEvaluatorId] = useState<number | null>(null);
  // Multi-PM hierarchy: each member gets their own PM + Secondary instead of
  // one Primary evaluating everyone. Toggling this swaps the member form.
  const [multiPmEnabled, setMultiPmEnabled] = useState(false);

  // ── Reference Data (shared cache via ['admin', 'departments|designations']) ─
  const { data: departments = [] } = useDepartments();
  const { data: designations = [] } = useDesignations();

  // ── Assignment State ────────────────────────────────────────────
  const [draftAssignments, setDraftAssignments] = useState<DraftAssignment[]>([]);
  const [existingAssignments, setExistingAssignments] = useState<AssignmentResponse[]>([]);

  // ── UI State ────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const toast = useToast();
  const snackbar = useSnackbar();

  // ── Load existing project (reference data now via shared hooks above) ──
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
        setExpectedEndDate(toDateInput(detail.expected_end_date));
        setReportsToId(detail.reports_to_id ?? null);
        setSecondaryEvaluatorId(detail.secondary_evaluator_id ?? null);
        setMultiPmEnabled(detail.multi_pm_enabled);
        setExistingAssignments(detail.assignments);
      })
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setIsLoading(false));
  }, [isEditing, projectId]);

  // ── Draft Assignment Helpers ────────────────────────────────────
  // New member cards are prepended so a fresh, empty card always appears at
  // the TOP of the list — no scrolling to the bottom to fill it in.
  const addDraftAssignment = () => {
    setDraftAssignments((prev) => [
      {
        tempId: tempId(),
        user_id: "",
        assignment_role: "",
        department_id: "",
        is_pm: false,
        assigned_date: "",
        manager_user_id: "",
        secondary_evaluator_id: "",
      },
      ...prev,
    ]);
  };

  // Drag-to-reorder for the draft cards. Native HTML5 DnD; the grip handle is
  // the drag source and each card is a drop target.
  const dragIndexRef = useRef<number | null>(null);
  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };
  const handleDropOn = (index: number) => {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from === null || from === index) return;
    setDraftAssignments((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
  };

  const updateDraft = <K extends keyof DraftAssignment>(
    id: string,
    field: K,
    value: DraftAssignment[K],
  ) => {
    setDraftAssignments((prev) =>
      prev.map((a) => (a.tempId === id ? { ...a, [field]: value } : a)),
    );
  };

  /** Toggle PM flag on a draft. Multiple drafts may be checked as PM in the
   *  form — the "more than one PM" rule is enforced at submit time with an
   *  inline error rather than blocked here, so the admin can mark a new PM and
   *  then clear the old one (a swap) without being stuck. */
  const toggleDraftPm = (id: string) => {
    setDraftAssignments((prev) =>
      prev.map((a) => (a.tempId === id ? { ...a, is_pm: !a.is_pm } : a)),
    );
  };

  /** Auto-fill role and department when user is selected */
  const handleUserSelect = (draftId: string, userId: string) => {
    updateDraft(draftId, "user_id", userId);

    if (!userId) return;

    const selectedUser = users.find((u) => u.id === Number(userId));
    if (!selectedUser) return;

    if (selectedUser.department_id) {
      updateDraft(draftId, "department_id", selectedUser.department_id.toString());
    }
    if (selectedUser.designation) {
      updateDraft(draftId, "assignment_role", selectedUser.designation.name);
    }
  };

  // Drop a draft card. For an edit-in-place draft this just cancels the edit
  // (the original read-only row reappears via the filter). A draft marked PM
  // can be removed freely — the at-least-one / at-most-one PM rules are checked
  // at submit time, not blocked here.
  const removeDraft = (id: string) => {
    setDraftAssignments((prev) => prev.filter((a) => a.tempId !== id));
  };

  // Refresh just the assignment list after a soft remove / restore, so the
  // member moves between the active and removed (greyed) groups without
  // clobbering any unsaved edits to the project fields above.
  const reloadAssignments = async () => {
    if (projectId === null) return;
    const detail = await projectService.getProjectDetail(projectId);
    setExistingAssignments(detail.assignments);
  };

  // Soft remove: the row is kept (greyed at the bottom) with who/when audit.
  const removeExisting = async (assignmentId: number) => {
    const target = existingAssignments.find((a) => a.id === assignmentId);
    if (target?.evaluator_type === "Primary") {
      snackbar.error("PM cannot be removed.");
      return;
    }
    try {
      await projectService.removeAssignment(assignmentId);
      await reloadAssignments();
    } catch (err: unknown) {
      snackbar.error(getErrorMessage(err));
    }
  };

  // Re-add a previously removed member (clears the removal marker).
  const restoreExisting = async (assignmentId: number) => {
    try {
      await projectService.restoreAssignment(assignmentId);
      await reloadAssignments();
    } catch (err: unknown) {
      snackbar.error(getErrorMessage(err));
    }
  };

  /** Promote an existing assignment into draftAssignments for in-place
   *  editing. The original row in existingAssignments is hidden by the
   *  render filter while a draft with this existingId is present, so
   *  no state copy is needed — dropping the draft restores the read-only
   *  view automatically. */
  const startEditExisting = (a: AssignmentResponse) => {
    setDraftAssignments((prev) => [
      ...prev,
      {
        tempId: tempId(),
        existingId: a.id,
        user_id: String(a.user_id),
        assignment_role: a.assignment_role ?? "",
        department_id: a.department_id ? String(a.department_id) : "",
        is_pm: a.evaluator_type === "Primary",
        assigned_date: a.assigned_date ?? "",
        manager_user_id: a.manager_id ? String(a.manager_id) : "",
        secondary_evaluator_id: a.secondary_evaluator_id
          ? String(a.secondary_evaluator_id)
          : "",
      },
    ]);
  };

  // ── Computed ────────────────────────────────────────────────────
  // Existing IDs currently in edit mode — their read-only rows are
  // hidden in favor of the matching draft, and any PM / "already
  // assigned" derivations must ignore them so the draft acts as
  // the source of truth for those checks.
  const editingExistingIds = new Set(
    draftAssignments
      .map((d) => d.existingId)
      .filter((id): id is number => id !== undefined),
  );

  // Active (non-removed) rows drive every current-team derivation below, so a
  // soft-removed member frees their slot (re-addable) and never counts as PM.
  const visibleExistingAssignments = existingAssignments.filter(
    (a) => !a.is_deleted && !editingExistingIds.has(a.id),
  );
  // Soft-removed rows render greyed at the very bottom with a Re-add action.
  const removedAssignments = existingAssignments.filter((a) => a.is_deleted);

  // Members who serve as a PM — drives the read-only "PM" badge. In single-PM
  // mode that's the one Primary; in multi-PM every top-level PM (Primary) plus
  // anyone who is another member's manager gets the badge, so the project's
  // multiple PMs are all visible at a glance.
  const managerUserIds = new Set(
    existingAssignments
      .filter((a) => !a.is_deleted && a.manager_id != null)
      .map((a) => a.manager_id as number),
  );
  const isPmMember = (a: AssignmentResponse): boolean =>
    a.evaluator_type === "Primary" ||
    (multiPmEnabled && managerUserIds.has(a.user_id));

  const assignedUserIds = new Set([
    ...visibleExistingAssignments.map((a) => a.user_id),
    ...draftAssignments.filter((a) => a.user_id).map((a) => Number(a.user_id)),
  ]);

  const existingPrimary =
    visibleExistingAssignments.find((a) => a.evaluator_type === "Primary") ?? null;
  const draftPrimary = draftAssignments.find((a) => a.is_pm) ?? null;
  const hasPrimary = !!existingPrimary || !!draftPrimary;

  // A project may have at most one PM. The form lets the admin tick more than
  // one (so they can mark a new PM before clearing the old), but saving is
  // blocked with an inline error until exactly one remains.
  const pmCount =
    (existingPrimary ? 1 : 0) + draftAssignments.filter((d) => d.is_pm).length;
  const tooManyPms = pmCount > 1;

  // Validation requirements (for create + final save):
  //   - PM checked on exactly one member
  //   - reports_to_id set
  //   - reports_to_id != PM (a PM cannot review themselves)
  //   - secondary_evaluator_id != PM (no self-review)
  //   - secondary_evaluator_id != reports_to_id (the same person can't
  //     play both reviewer roles — the secondary should be an outside
  //     perspective, not the same senior who already reviews the PM)
  //   - expected_end_date >= start_date when both set
  const pmUserId = existingPrimary?.user_id ?? (draftPrimary && draftPrimary.user_id ? Number(draftPrimary.user_id) : null);
  const reportsToConflict = pmUserId !== null && reportsToId === pmUserId;
  const secondaryConflictWithPm = pmUserId !== null && secondaryEvaluatorId === pmUserId;
  const secondaryConflictWithReportsTo =
    secondaryEvaluatorId !== null && secondaryEvaluatorId === reportsToId;
  // The secondary evaluator is an outside reviewer — they can't also be a
  // member of the team they evaluate.
  const secondaryConflictWithMember =
    secondaryEvaluatorId !== null && assignedUserIds.has(secondaryEvaluatorId);
  const endBeforeStart = !!startDate && !!expectedEndDate && expectedEndDate < startDate;
  // A member's joined date cannot precede the project's start date.
  // Only enforce when both dates are set on the draft; the field stays
  // optional, but if filled it must be >= project start.
  const draftJoinedBeforeStart =
    !!startDate &&
    draftAssignments.some((d) => !!d.assigned_date && d.assigned_date < startDate);

  // Dropdown exclusions — keep the two reviewer-role pickers from
  // surfacing each other or the PM as candidates.
  const reportsToExclude: number[] = [];
  if (pmUserId !== null) reportsToExclude.push(pmUserId);
  if (secondaryEvaluatorId !== null) reportsToExclude.push(secondaryEvaluatorId);

  const secondaryExclude: number[] = [];
  if (pmUserId !== null) secondaryExclude.push(pmUserId);
  if (reportsToId !== null) secondaryExclude.push(reportsToId);
  // A team member can't be the secondary evaluator — keep them out of the picker.
  secondaryExclude.push(...assignedUserIds);

  // Members selectable as a "Project Manager" in multi-PM mode: existing
  // (non-edited) rows + drafts that have a practitioner chosen, deduped by id.
  const memberOptions = (() => {
    const seen = new Set<number>();
    const out: { id: number; name: string }[] = [];
    for (const a of visibleExistingAssignments) {
      if (!seen.has(a.user_id)) {
        seen.add(a.user_id);
        out.push({ id: a.user_id, name: a.user_name });
      }
    }
    for (const d of draftAssignments) {
      if (!d.user_id) continue;
      const id = Number(d.user_id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: users.find((u) => u.id === id)?.full_name ?? `#${id}` });
    }
    return out;
  })();

  // Multi-PM validation. The backend is the source of truth (it runs the full
  // graph + cycle checks on create); the frontend just guards common mistakes.
  const draftMembersWithUser = draftAssignments.filter((d) => d.user_id);
  const multiPmError: string | null = (() => {
    if (!multiPmEnabled) return null;
    if (memberOptions.length === 0) return "Add at least one team member.";
    if (
      draftMembersWithUser.some(
        (d) => d.manager_user_id && Number(d.manager_user_id) === Number(d.user_id),
      )
    )
      return "A member cannot be their own Project Manager.";
    // Multiple same-level PMs are supported: any number of members may have no
    // Project Manager — they're top-level PMs, each reviewed by "PM Reports To".
    // There is deliberately no "exactly one top PM" rule (the backend hierarchy
    // validator explicitly allows zero, one, or many roots). Cycle detection
    // stays on the backend, which is the source of truth on create.
    return null;
  })();

  // validationError drives the Create/Save button's disabled state. Multi-PM's
  // structural requirements (multiPmError) are intentionally NOT folded in here:
  // they used to grey out the button with no visible reason. Instead they're
  // shown inline (see the Team Members section) and re-checked at submit time,
  // so the button stays clickable and the admin gets actionable feedback.
  const validationError =
    !projectCode.trim()
      ? "Project Code is required."
      : !name.trim()
        ? "Project Name is required."
        : endBeforeStart
          ? "End Date cannot be before Start Date."
          : draftJoinedBeforeStart
            ? "A member's Joined Date cannot be earlier than the project Start Date."
            : !isEditing && reportsToId === null
              ? "PM Reports To is required."
              : multiPmEnabled
                ? null
                : tooManyPms
                  ? "A Project cannot have more than 1 PM."
                  : !hasPrimary
                    ? "Project must have at least one PM."
                    : reportsToConflict
                      ? "PM Reports To must be a different user than the PM."
                      : secondaryConflictWithPm
                        ? "Secondary Evaluator must be a different user than the PM."
                        : secondaryConflictWithReportsTo
                          ? "Secondary Evaluator must be a different user than PM Reports To."
                          : secondaryConflictWithMember
                            ? "Secondary Evaluator cannot also be a team member of the project."
                            : null;

  // ── Submit ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    // Multi-PM structural checks don't disable the button (so it stays
    // clickable with inline guidance), but they still gate an actual submit
    // — the backend runs the authoritative graph/cycle checks on create.
    if (multiPmEnabled && multiPmError) {
      setError(multiPmError);
      return;
    }
    setIsSaving(true);
    setError("");

    try {
      // Multi-PM: the member's PM comes from manager_user_id; each top-level PM
      // (no manager) is flagged Primary so display resolvers keep working. In
      // single-PM mode the per-member fields are omitted and the PM checkbox
      // drives evaluator_type as before.
      const draftToPayload = (d: DraftAssignment) =>
        multiPmEnabled
          ? {
              assignment_role: d.assignment_role || null,
              department_id: d.department_id ? Number(d.department_id) : null,
              evaluator_type: (d.manager_user_id ? null : "Primary") as "Primary" | null,
              assigned_date: d.assigned_date || null,
              manager_id: d.manager_user_id ? Number(d.manager_user_id) : null,
              secondary_evaluator_id: d.secondary_evaluator_id
                ? Number(d.secondary_evaluator_id)
                : null,
            }
          : {
              assignment_role: d.assignment_role || null,
              department_id: d.department_id ? Number(d.department_id) : null,
              evaluator_type: (d.is_pm ? "Primary" : null) as "Primary" | null,
              assigned_date: d.assigned_date || null,
            };

      if (isEditing) {
        await projectService.updateProject(projectId, {
          project_code: projectCode,
          name,
          description: description || null,
          start_date: startDate || null,
          expected_end_date: expectedEndDate || null,
          reports_to_id: reportsToId,
          secondary_evaluator_id: multiPmEnabled ? null : secondaryEvaluatorId,
          multi_pm_enabled: multiPmEnabled,
        });

        const editDrafts = draftAssignments.filter((d) => d.user_id && d.existingId !== undefined);
        const newDrafts = draftAssignments.filter((d) => d.user_id && d.existingId === undefined);

        // Single-PM: PATCH any PM demotion first (frees the one Primary slot
        // before another row claims it). Multi-PM has no single-Primary
        // constraint, so edits run in any order.
        const demotions = multiPmEnabled
          ? []
          : editDrafts.filter((d) => {
              const orig = existingAssignments.find((a) => a.id === d.existingId);
              return orig?.evaluator_type === "Primary" && !d.is_pm;
            });
        const otherEdits = editDrafts.filter((d) => !demotions.includes(d));

        for (const d of demotions) {
          await projectService.updateAssignment(d.existingId as number, {
            assignment_role: d.assignment_role || null,
            department_id: d.department_id ? Number(d.department_id) : null,
            evaluator_type: null,
            assigned_date: d.assigned_date || null,
          });
        }
        for (const d of otherEdits) {
          await projectService.updateAssignment(d.existingId as number, draftToPayload(d));
        }
        for (const d of newDrafts) {
          await projectService.addAssignment(projectId, {
            user_id: Number(d.user_id),
            ...draftToPayload(d),
          });
        }
      } else {
        const assignments: AssignmentCreatePayload[] = draftAssignments
          .filter((a) => a.user_id)
          .map((a) => ({ user_id: Number(a.user_id), ...draftToPayload(a) }));

        // reports_to_id is required by backend; validation above guarantees non-null here.
        await projectService.createProject({
          project_code: projectCode,
          name,
          description: description || null,
          start_date: startDate || null,
          expected_end_date: expectedEndDate || null,
          reports_to_id: reportsToId as number,
          secondary_evaluator_id: multiPmEnabled ? null : secondaryEvaluatorId,
          assignments,
          multi_pm_enabled: multiPmEnabled,
        });
      }

      onSave();
      toast.success(isEditing ? "Project updated." : "Project created.");
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const canSubmit = !validationError && !isSaving;

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
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-muted transition-colors"
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
                <p className="rounded-lg bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-sm text-red-600 dark:text-red-300">{error}</p>
              )}

              {/* ── Project Details ────────────────────────────── */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="proj-code" className={LABEL_CLS}>Project Code *</label>
                  <input id="proj-code" className={INPUT_CLS} value={projectCode} onChange={(e) => setProjectCode(e.target.value)} placeholder="PRJ-001" />
                </div>
                <div>
                  <label htmlFor="proj-name" className={LABEL_CLS}>Project Name *</label>
                  <input id="proj-name" className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)} placeholder="Market Access Study Q2" />
                </div>
              </div>

              <div>
                <label htmlFor="proj-desc" className={LABEL_CLS}>Description</label>
                <textarea id="proj-desc" rows={2} className={`${INPUT_CLS} resize-none`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of the project scope…" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="proj-start" className={LABEL_CLS}>Start Date</label>
                  <input id="proj-start" type="date" className={INPUT_CLS} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="proj-end" className={LABEL_CLS}>End Date</label>
                  <input
                    id="proj-end"
                    type="date"
                    className={INPUT_CLS}
                    value={expectedEndDate}
                    min={startDate || undefined}
                    onChange={(e) => setExpectedEndDate(e.target.value)}
                    aria-invalid={endBeforeStart}
                  />
                  {endBeforeStart && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-300">End Date cannot be before Start Date.</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <UserCombobox
                  value={reportsToId}
                  onChange={setReportsToId}
                  label="PM Reports To"
                  required
                  excludeIds={reportsToExclude}
                />
                {/* In multi-PM mode the Secondary is per member, so the single
                    project-level picker is hidden. */}
                {!multiPmEnabled && (
                  <UserCombobox
                    value={secondaryEvaluatorId}
                    onChange={setSecondaryEvaluatorId}
                    label="Secondary Evaluator"
                    placeholder="Optional — can be added later"
                    excludeIds={secondaryExclude}
                  />
                )}
              </div>

              {/* Multiple-PM toggle — swaps the team form to a per-member PM +
                  Secondary hierarchy. Switch style matches the settings toggles
                  (PeriodSettingsSection). */}
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-muted/50 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-main">
                    Enable Multiple PM support
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    Each member gets their own Project Manager &amp; Secondary
                    Evaluator
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={multiPmEnabled}
                  aria-label="Enable Multiple PM support"
                  onClick={() => setMultiPmEnabled((v) => !v)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1 ${
                    multiPmEnabled ? "bg-brand" : "bg-slate-200 dark:bg-slate-700"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-surface shadow transition duration-200 ${
                      multiPmEnabled ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* ── Team Members ───────────────────────────────── */}
              {/* flex-col + order-* so draft cards render ABOVE the existing
                  read-only rows without moving them in the DOM. */}
              <div className="border-t border-border pt-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
                    Team Members
                  </p>
                  <button type="button" onClick={addDraftAssignment} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add Member
                  </button>
                </div>

                {/* Only meaningful in single-PM mode. When "Enable Multiple PM
                    support" is on, more than one PM is expected, so suppress the
                    warning (submit validation already skips this rule too). */}
                {!multiPmEnabled && tooManyPms && (
                  <p className="rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-600 dark:text-red-300">
                    A Project cannot have more than 1 PM. Uncheck PM on the extra
                    member before saving.
                  </p>
                )}

                {/* Multi-PM guidance — surfaced inline so the admin can see what
                    still needs fixing instead of a silently-disabled button. */}
                {multiPmEnabled && multiPmError && (
                  <p className="rounded-lg bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    {multiPmError}
                  </p>
                )}

                {/* Existing Assignments — read-only rows, rendered BELOW the
                    draft cards (order-2) so a freshly added card sits on top.
                    Clicking the pencil promotes the row into draftAssignments
                    for in-place editing; the original row is hidden via the
                    visibleExistingAssignments filter while its draft is present. */}
                <div className="order-2 flex flex-col gap-3">
                {visibleExistingAssignments.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-text-main">{a.user_name}</span>
                    </div>
                    {a.department_name && (
                      <span className="text-xs text-text-muted shrink-0">{a.department_name}</span>
                    )}
                    {isPmMember(a) && (
                      <span className="rounded-full bg-brand-light px-2 py-0.5 text-xs font-medium text-brand shrink-0">PM</span>
                    )}
                    {a.assigned_date && (
                      <span className="text-xs text-text-muted shrink-0">Joined: {a.assigned_date}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => startEditExisting(a)}
                      className="shrink-0 rounded-md p-1 text-text-muted hover:bg-brand/10 hover:text-brand transition-colors"
                      aria-label={`Edit ${a.user_name}`}
                      title="Edit team member"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeExisting(a.id)}
                      className="shrink-0 rounded-md p-1 text-text-muted hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:text-red-300 transition-colors"
                      aria-label={`Remove ${a.user_name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                </div>

                {/* Draft Assignments — rendered ABOVE the existing rows
                    (order-1) so the newest (prepended) card is on top. Also
                    hosts edit-in-place rows (draft.existingId set); for those
                    the Practitioner select is locked (user_id isn't editable on the
                    AssignmentUpdate API). Cards are drag-reorderable. */}
                <div className="order-1 flex flex-col gap-3">
                {draftAssignments.map((draft, draftIndex) => {
                  const isEditDraft = draft.existingId !== undefined;
                  // Only gate on having picked a practitioner. Multiple members
                  // may be ticked PM here; the "more than one PM" rule is an
                  // inline submit-time error, not a per-checkbox block.
                  const pmDisabled = !draft.is_pm && !draft.user_id;
                  const pmDisabledReason =
                    pmDisabled ? "Pick a practitioner first." : null;
                  const joinedBeforeStart =
                    !!startDate && !!draft.assigned_date && draft.assigned_date < startDate;
                  return (
                  <div
                    key={draft.tempId}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDropOn(draftIndex)}
                    className={`rounded-lg border p-3 space-y-2 ${
                      isEditDraft ? "border-brand bg-brand/5" : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      {/* Drag handle — reorders the team member cards. */}
                      <button
                        type="button"
                        draggable
                        onDragStart={() => handleDragStart(draftIndex)}
                        onDragEnd={() => (dragIndexRef.current = null)}
                        className="-ml-1 cursor-grab rounded p-1 text-text-muted hover:bg-surface-muted active:cursor-grabbing"
                        aria-label="Drag to reorder"
                        title="Drag to reorder"
                      >
                        <GripVertical className="h-4 w-4" aria-hidden="true" />
                      </button>
                      {isEditDraft && (
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
                          Editing team member
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-12 gap-2 items-end">
                      {/* Practitioner — 4 cols (locked when editing an existing row) */}
                      <div className="col-span-4">
                        <UserCombobox
                          value={draft.user_id ? Number(draft.user_id) : null}
                          onChange={(userId) => handleUserSelect(draft.tempId, userId !== null ? String(userId) : "")}
                          label="Practitioner"
                          placeholder="Search practitioner…"
                          disabled={isEditDraft}
                          excludeIds={[...assignedUserIds, ...(secondaryEvaluatorId !== null ? [secondaryEvaluatorId] : [])]}
                          filter={notDeleted}
                        />
                      </div>

                      {/* Role (auto-filled from designation) */}
                      <div className={multiPmEnabled ? "col-span-4" : "col-span-3"}>
                        <label className={LABEL_CLS}>Role (Designation)</label>
                        <select
                          className={INPUT_CLS}
                          value={draft.assignment_role}
                          onChange={(e) => updateDraft(draft.tempId, "assignment_role", e.target.value)}
                        >
                          <option value="">— Select —</option>
                          {designations.map((d) => (
                            <option key={d.id} value={d.name}>{d.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Department */}
                      <div className={multiPmEnabled ? "col-span-3" : "col-span-2"}>
                        <label className={LABEL_CLS}>Department</label>
                        <select
                          className={INPUT_CLS}
                          value={draft.department_id}
                          onChange={(e) => updateDraft(draft.tempId, "department_id", e.target.value)}
                        >
                          <option value="">— Select —</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* PM: single-PM mode shows the "is PM" checkbox here.
                          In multi-PM mode the member's Project Manager picker
                          lives in the bottom row, left of Secondary Evaluator. */}
                      {!multiPmEnabled && (
                        <div className="col-span-2">
                          <label className={LABEL_CLS}>PM</label>
                          <label
                            className={`flex h-9 items-center gap-2 rounded-lg border px-2.5 text-sm ${
                              pmDisabled
                                ? "border-border bg-surface-muted text-text-muted cursor-not-allowed"
                                : draft.is_pm
                                  ? "border-brand bg-brand-light text-brand cursor-pointer"
                                  : "border-border bg-surface text-text-main cursor-pointer hover:bg-surface-muted"
                            }`}
                            title={pmDisabledReason ?? undefined}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-brand"
                              checked={draft.is_pm}
                              disabled={pmDisabled}
                              onChange={() => toggleDraftPm(draft.tempId)}
                            />
                            <span>is PM</span>
                          </label>
                        </div>
                      )}

                      {/* Remove — 1 col */}
                      <div className="col-span-1 flex justify-center pb-1">
                        <button type="button" onClick={() => removeDraft(draft.tempId)} className="rounded-md p-1.5 text-text-muted hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:text-red-300 transition-colors" aria-label="Remove member">
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {/* Second row (multi-PM) — Project Manager, then Secondary
                        Evaluator, then Joined Date. */}
                    <div className="grid grid-cols-12 gap-2">
                      {multiPmEnabled && (
                        <div className="col-span-4">
                          <UserCombobox
                            value={draft.manager_user_id ? Number(draft.manager_user_id) : null}
                            onChange={(id) => updateDraft(draft.tempId, "manager_user_id", id !== null ? String(id) : "")}
                            label="Project Manager"
                            placeholder="Search project manager…"
                            excludeIds={draft.user_id ? [Number(draft.user_id)] : []}
                            filter={notDeleted}
                          />
                        </div>
                      )}
                      {multiPmEnabled && (
                        <div className="col-span-4">
                          <UserCombobox
                            value={draft.secondary_evaluator_id ? Number(draft.secondary_evaluator_id) : null}
                            onChange={(id) => updateDraft(draft.tempId, "secondary_evaluator_id", id !== null ? String(id) : "")}
                            label="Secondary Evaluator"
                            placeholder="Search evaluator…"
                            excludeIds={draft.user_id ? [Number(draft.user_id)] : []}
                            filter={notDeleted}
                          />
                        </div>
                      )}
                      <div className={multiPmEnabled ? "col-span-4" : "col-span-3"}>
                        <label className={LABEL_CLS}>Joined Date</label>
                        <input
                          type="date"
                          className={INPUT_CLS}
                          value={draft.assigned_date}
                          min={startDate || undefined}
                          aria-invalid={joinedBeforeStart}
                          onChange={(e) => updateDraft(draft.tempId, "assigned_date", e.target.value)}
                        />
                        {joinedBeforeStart && (
                          <p className="mt-1 text-xs text-red-600 dark:text-red-300">
                            Cannot be earlier than Start Date.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })}
                </div>

                {existingAssignments.length === 0 && draftAssignments.length === 0 && (
                  <p className="text-xs text-text-muted italic text-center py-3">
                    No team members added yet. Click "Add Member" above.
                  </p>
                )}

                {/* Removed members — greyed, pinned at the very bottom (order-3),
                    with the who/when audit line and a Re-add action. */}
                {removedAssignments.length > 0 && (
                  <div className="order-3 flex flex-col gap-2 border-t border-dashed border-border pt-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      Removed members
                    </p>
                    {removedAssignments.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-3 rounded-lg border border-border bg-surface-muted/40 px-3 py-2 opacity-70"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-text-muted line-through">
                            {a.user_name}
                          </span>
                          <span className="ml-2 text-xs text-text-muted">
                            Removed
                            {a.removed_by_name ? ` by ${a.removed_by_name}` : ""}
                            {a.removed_at ? ` on ${formatRemovedDate(a.removed_at)}` : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => restoreExisting(a.id)}
                          className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/10 transition-colors"
                        >
                          Re-add
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4 shrink-0">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-muted transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {isSaving ? "Saving…" : isEditing ? "Save Changes" : "Create Project"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}