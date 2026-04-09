import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type {
  Goal,
  GoalCreatePayload,
  GoalUpdatePayload,
  GoalStatus,
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
    } else {
      setForm(EMPTY);
    }
  }, [editingGoal, isOpen]);

  if (!isOpen) return null;

  const set = (field: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

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
      await onSave({
        title: form.title,
        description: form.description || null,
        status: form.status,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
        user_id: userId,
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
              Title *
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
