/**
 * GoalFormModal.tsx — Updated for Story 3.1 (Criteria Breakdown).
 *
 * Changes:
 *   - Added dynamic criteria array with "+ Add Key Result" button
 *   - Criteria are sent inside GoalCreatePayload on new goal creation
 *   - Edit mode shows existing criteria as read-only preview (editing
 *     individual criteria happens in the GoalCard's CriteriaChecklist)
 *   - Criteria can be removed before submission via the X button
 *
 * Placement: src/components/goals/GoalFormModal.tsx
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import type {
  Goal,
  GoalCreatePayload,
  GoalUpdatePayload,
  GoalStatus,
  CriterionCreatePayload,
} from "../../services/goal.service";

const STATUSES: { value: GoalStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

interface GoalFormModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: (
    payload: GoalCreatePayload | GoalUpdatePayload,
  ) => Promise<void>;
  readonly editingGoal: Goal | null;
  readonly userId: number;
  readonly isSaving: boolean;
  readonly error: string;
}

interface FormState {
  title: string;
  description: string;
  status: GoalStatus;
  start_date: string;
  due_date: string;
  progress_notes: string;
}

interface CriterionDraft {
  /** Temporary client-side ID for React keys */
  tempId: string;
  title: string;
}

const EMPTY: FormState = {
  title: "",
  description: "",
  status: "pending",
  start_date: "",
  due_date: "",
  progress_notes: "",
};

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

let nextTempId = 0;
function createTempId(): string {
  nextTempId += 1;
  return `temp_${nextTempId}`;
}

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-text-muted mb-1";

export function GoalFormModal({
  isOpen,
  onClose,
  onSave,
  editingGoal,
  userId,
  isSaving,
  error,
}: GoalFormModalProps) {
  const isEditing = editingGoal !== null;
  const isApproved = editingGoal?.approval_status === "approved";

  const [form, setForm] = useState<FormState>(EMPTY);
  const [criteria, setCriteria] = useState<CriterionDraft[]>([]);

  useEffect(() => {
    if (editingGoal) {
      setForm({
        title: editingGoal.title,
        description: editingGoal.description ?? "",
        status: editingGoal.status,
        start_date: toDateInput(editingGoal.start_date),
        due_date: toDateInput(editingGoal.due_date),
        progress_notes: editingGoal.progress_notes ?? "",
      });
      // Don't populate criteria drafts for edit mode — criteria are
      // managed in-place via the CriteriaChecklist on the GoalCard
      setCriteria([]);
    } else {
      setForm(EMPTY);
      setCriteria([]);
    }
  }, [editingGoal, isOpen]);

  if (!isOpen) return null;

  const set = (field: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // ── Criteria Handlers ─────────────────────────────────────────────

  const addCriterion = () => {
    setCriteria((prev) => [...prev, { tempId: createTempId(), title: "" }]);
  };

  const updateCriterion = (tempId: string, title: string) => {
    setCriteria((prev) =>
      prev.map((c) => (c.tempId === tempId ? { ...c, title } : c)),
    );
  };

  const removeCriterion = (tempId: string) => {
    setCriteria((prev) => prev.filter((c) => c.tempId !== tempId));
  };

  // ── Submit ────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (isEditing) {
      await onSave({
        title: form.title || undefined,
        description: form.description || null,
        status: form.status,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
        progress_notes: form.progress_notes || null,
      } satisfies GoalUpdatePayload);
    } else {
      // Build criteria array — filter out empty titles
      const validCriteria: CriterionCreatePayload[] = criteria
        .filter((c) => c.title.trim().length > 0)
        .map((c, idx) => ({ title: c.title.trim(), sort_order: idx }));

      await onSave({
        title: form.title,
        description: form.description || null,
        status: form.status,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
        user_id: userId,
        criteria: validCriteria.length > 0 ? validCriteria : undefined,
      } satisfies GoalCreatePayload);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="goal-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <h2
            id="goal-modal-title"
            className="font-display text-base font-semibold text-text-main"
          >
            {isEditing ? "Edit Goal" : "Add New Goal"}
          </h2>
          {isApproved && (
            <p className="mt-0.5 text-xs text-text-muted">
              This goal is approved — you can update progress and add notes.
            </p>
          )}
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          {/* Title */}
          <div>
            <label htmlFor="goal-title" className={LABEL_CLS}>
              Objective (Title) *
            </label>
            <input
              id="goal-title"
              className={INPUT_CLS}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Complete onboarding certification"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="goal-desc" className={LABEL_CLS}>
              Description
            </label>
            <textarea
              id="goal-desc"
              rows={3}
              className={`${INPUT_CLS} resize-none`}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What does success look like?"
            />
          </div>

          {/* ── Key Results (Create mode only) ─────────────────────── */}
          {!isEditing && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className={LABEL_CLS}>Key Results (Criteria)</label>
                <button
                  type="button"
                  onClick={addCriterion}
                  className="flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add Key Result
                </button>
              </div>

              {criteria.length === 0 ? (
                <p className="text-xs text-text-muted italic">
                  No key results added yet. Click "Add Key Result" to break this
                  goal into measurable criteria.
                </p>
              ) : (
                <div className="space-y-2">
                  {criteria.map((c, idx) => (
                    <div key={c.tempId} className="flex items-center gap-2">
                      <span className="text-xs text-text-muted font-medium w-5 shrink-0 text-right">
                        {idx + 1}.
                      </span>
                      <input
                        className={INPUT_CLS}
                        value={c.title}
                        onChange={(e) =>
                          updateCriterion(c.tempId, e.target.value)
                        }
                        placeholder={`Key result ${idx + 1}`}
                        aria-label={`Key result ${idx + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeCriterion(c.tempId)}
                        className="shrink-0 rounded-md p-1.5 text-text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                        aria-label={`Remove key result ${idx + 1}`}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Existing criteria preview (Edit mode) */}
          {isEditing && editingGoal.criteria.length > 0 && (
            <div className="space-y-2">
              <p className={LABEL_CLS}>
                Key Results (
                {editingGoal.criteria.filter((c) => c.is_completed).length}/
                {editingGoal.criteria.length} complete)
              </p>
              <div className="rounded-lg border border-border bg-slate-50 p-3 space-y-1.5">
                {editingGoal.criteria.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    <span
                      className={`shrink-0 ${c.is_completed ? "text-green-600" : "text-text-muted"}`}
                    >
                      {c.is_completed ? "✓" : "○"}
                    </span>
                    <span
                      className={
                        c.is_completed
                          ? "line-through text-text-muted"
                          : "text-text-main"
                      }
                    >
                      {c.title}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-text-muted">
                Manage criteria from the goal card directly.
              </p>
            </div>
          )}

          {/* Status — editing only */}
          {isEditing && (
            <div>
              <label htmlFor="goal-status" className={LABEL_CLS}>
                Progress Status
              </label>
              <select
                id="goal-status"
                className={INPUT_CLS}
                value={form.status}
                onChange={(e) => set("status", e.target.value as GoalStatus)}
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="goal-start" className={LABEL_CLS}>
                Start Date
              </label>
              <input
                id="goal-start"
                type="date"
                className={INPUT_CLS}
                value={form.start_date}
                onChange={(e) => set("start_date", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="goal-due" className={LABEL_CLS}>
                Due Date
              </label>
              <input
                id="goal-due"
                type="date"
                className={INPUT_CLS}
                value={form.due_date}
                onChange={(e) => set("due_date", e.target.value)}
              />
            </div>
          </div>

          {/* Progress notes — only shown when editing an approved goal */}
          {isEditing && isApproved && (
            <div className="rounded-lg border border-brand/20 bg-brand-light/30 p-4 space-y-2">
              <label
                htmlFor="goal-notes"
                className="block text-xs font-semibold text-brand"
              >
                Progress Notes
              </label>
              <p className="text-xs text-text-muted">
                Log completed steps, links, or proof of work. Visible to your
                mentor.
              </p>
              <textarea
                id="goal-notes"
                rows={4}
                className={`${INPUT_CLS} resize-none`}
                value={form.progress_notes}
                onChange={(e) => set("progress_notes", e.target.value)}
                placeholder='e.g. "Completed module 3 on April 9th. Certificate attached in Drive."'
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
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
            disabled={isSaving || !form.title.trim()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? "Saving…" : isEditing ? "Save Changes" : "Add Goal"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
