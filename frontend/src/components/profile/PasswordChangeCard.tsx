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
import { Lock, Eye, EyeOff, CheckCircle } from "lucide-react";
import { profileService } from "../../services/profile.service";

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand pr-10";
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

/** Toggle-able password input with eye icon. */
function PasswordInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (val: string) => void;
  readonly placeholder: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className={LABEL_CLS}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          className={INPUT_CLS}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={
            id === "current-password" ? "current-password" : "new-password"
          }
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main transition-colors"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

export function PasswordChangeCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

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
    setError("");
    setSuccess(false);
    setIsSaving(true);

    try {
      await profileService.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });

      // Clear form and show success
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }, [currentPassword, newPassword]);

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
        {/* Error banner */}
        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
            {error}
          </p>
        )}

        {/* Success banner */}
        {success && (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-2.5 text-sm text-green-700">
            <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Password updated successfully.
          </div>
        )}

        <PasswordInput
          id="current-password"
          label="Current Password"
          value={currentPassword}
          onChange={(v) => {
            setCurrentPassword(v);
            setError("");
            setSuccess(false);
          }}
          placeholder="Enter your current password"
        />

        <PasswordInput
          id="new-password"
          label="New Password"
          value={newPassword}
          onChange={(v) => {
            setNewPassword(v);
            setError("");
            setSuccess(false);
          }}
          placeholder="Min. 8 characters"
        />

        {tooShort && (
          <p className="text-xs text-amber-600">
            Password must be at least 8 characters.
          </p>
        )}

        <PasswordInput
          id="confirm-password"
          label="Confirm New Password"
          value={confirmPassword}
          onChange={(v) => {
            setConfirmPassword(v);
            setError("");
            setSuccess(false);
          }}
          placeholder="Re-enter your new password"
        />

        {mismatch && (
          <p className="text-xs text-red-600">Passwords do not match.</p>
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
