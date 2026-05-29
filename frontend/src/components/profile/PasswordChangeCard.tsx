/**
 * PasswordChangeCard.tsx — Self-Service Password Change Form.
 *
 * Requires the current password before accepting a new one — prevents
 * session hijacking from an unlocked screen. Shows inline validation
 * for minimum length and mismatch, plus backend error messages
 * (e.g. "Current password is incorrect").
 *
 * Placement: src/components/profile/PasswordChangeCard.tsx
 */

import { useState, useCallback } from "react";
import { Lock } from "lucide-react";
import { useChangePassword } from "../../queries/profile";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { PasswordField } from "../common/PasswordField";

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-surface py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-text-muted mb-1";

/** Type-safe error extractor — never uses `as` casting. */
function getErrorMessage(err: unknown): string {
  if (
    err !== null &&
    typeof err === "object" &&
    "response" in err &&
    typeof (err as Record<string, unknown>).response === "object"
  ) {
    const response = (err as { response: { data?: { detail?: string } } })
      .response;
    if (response.data?.detail) return response.data.detail;
  }
  return "Something went wrong. Please try again.";
}

export function PasswordChangeCard() {
  const { refreshSession } = useAuth();
  const toast = useToast();
  const snackbar = useSnackbar();
  const changePasswordMutation = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const isSaving = changePasswordMutation.isPending;

  // ── Client-Side Validation ──────────────────────────────────────
  const mismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < 8;
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    !isSaving;

  const handleSubmit = useCallback(async () => {
    try {
      await changePasswordMutation.mutateAsync({
        current_password: currentPassword,
        new_password: newPassword,
      });

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated.");

      // Refresh session so must_change_password flips to false immediately,
      // lifting the /change-password gate for admin-reset users. This is
      // the auth/session cache (not TanStack-managed), so the mutation
      // hook can't trigger it — we do it here.
      void refreshSession();
    } catch (err: unknown) {
      snackbar.error(getErrorMessage(err));
    }
  }, [
    changePasswordMutation,
    currentPassword,
    newPassword,
    refreshSession,
    toast,
    snackbar,
  ]);

  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 mb-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light">
          <Lock className="h-4 w-4 text-brand" aria-hidden="true" />
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-text-main">
            Change Password
          </h3>
          <p className="text-xs text-text-muted">
            You'll need your current password to set a new one.
          </p>
        </div>
      </div>

      <div className="max-w-sm space-y-4">
        <PasswordField
          id="current-password"
          label="Current Password"
          value={currentPassword}
          onChange={setCurrentPassword}
          placeholder="Enter your current password"
          autoComplete="current-password"
          leadingIcon={Lock}
          labelClassName={LABEL_CLS}
          inputClassName={INPUT_CLS}
        />

        <PasswordField
          id="new-password"
          label="New Password"
          value={newPassword}
          onChange={setNewPassword}
          placeholder="Min. 8 characters"
          autoComplete="new-password"
          leadingIcon={Lock}
          labelClassName={LABEL_CLS}
          inputClassName={INPUT_CLS}
        />

        {tooShort && (
          <p className="text-xs text-amber-600 dark:text-amber-300">
            Password must be at least 8 characters.
          </p>
        )}

        <PasswordField
          id="confirm-password"
          label="Confirm New Password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Re-enter your new password"
          autoComplete="new-password"
          leadingIcon={Lock}
          labelClassName={LABEL_CLS}
          inputClassName={INPUT_CLS}
        />

        {mismatch && (
          <p className="text-xs text-red-600 dark:text-red-300">Passwords do not match.</p>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isSaving ? "Updating…" : "Update Password"}
        </button>
      </div>
    </div>
  );
}
