import { useState } from "react";
import { createPortal } from "react-dom";
import { Copy, KeyRound, AlertTriangle, Check } from "lucide-react";
import type {
  PasswordResetResponse,
  UserResponse,
} from "../../services/admin.service";

interface ResetPasswordModalProps {
  readonly user: UserResponse;
  readonly onConfirm: () => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
  /** Populated after the reset succeeds — switches modal to reveal mode. */
  readonly result: PasswordResetResponse | null;
}

export function ResetPasswordModal({
  user,
  onConfirm,
  onClose,
  isSaving,
  error,
  result,
}: ResetPasswordModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.temporary_password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied — the password is still visible on screen */
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-modal-title"
    >
      <div className="w-full max-w-md rounded-xl bg-surface p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-amber-50 p-2">
            <KeyRound className="h-5 w-5 text-amber-600" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="reset-modal-title"
              className="font-display text-base font-semibold text-text-main"
            >
              {result ? "Temporary password generated" : "Reset password"}
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              {result ? (
                <>
                  Share this password with{" "}
                  <span className="font-medium text-text-main">
                    {result.full_name}
                  </span>{" "}
                  <span className="text-text-muted">({result.email})</span>.
                  They will be forced to change it on next login.
                </>
              ) : (
                <>
                  Generate a new temporary password for{" "}
                  <span className="font-medium text-text-main">
                    {user.full_name}
                  </span>
                  . Their current password will be invalidated immediately.
                </>
              )}
            </p>
          </div>
        </div>

        {result ? (
          <>
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className="h-4 w-4 shrink-0 text-amber-600 mt-0.5"
                  aria-hidden="true"
                />
                <p className="text-xs text-amber-800">
                  Copy this password now. It will not be shown again. If you
                  lose it, click Reset Password again to generate a new one.
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-border bg-slate-50 px-3 py-2.5 font-mono text-sm text-text-main select-all break-all">
                {result.temporary_password}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-green-600" aria-hidden="true" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    Copy
                  </>
                )}
              </button>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isSaving}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {isSaving ? "Resetting…" : "Reset password"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
