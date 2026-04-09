import { createPortal } from "react-dom";
import type { UserResponse } from "../../services/admin.service";

interface DeactivateModalProps {
  readonly user: UserResponse;
  readonly onConfirm: () => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
}

export function DeactivateModal({
  user,
  onConfirm,
  onClose,
  isSaving,
}: DeactivateModalProps) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deactivate-modal-title"
    >
      <div className="w-full max-w-sm rounded-xl bg-surface p-6 shadow-xl">
        <h2
          id="deactivate-modal-title"
          className="font-display text-base font-semibold text-text-main"
        >
          Deactivate User
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Are you sure you want to deactivate{" "}
          <span className="font-medium text-text-main">{user.full_name}</span>?
          They will no longer be able to log in. This can be reversed by editing
          the user.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {isSaving ? "Deactivating…" : "Deactivate"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
