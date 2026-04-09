import { useState } from "react";
import { Lock, Loader2, CheckCircle } from "lucide-react";
import { profileService } from "../../services/profile.service";
import { getErrorMessage } from "../../utils/errors";

interface FormState {
  current: string;
  next: string;
  confirm: string;
}

const EMPTY_FORM: FormState = { current: "", next: "", confirm: "" };

const INPUT_CLS =
  "block w-full pl-10 pr-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand focus:border-brand bg-background text-text-main text-sm transition-colors placeholder:text-text-muted";

export function PasswordChangeCard() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const set = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear feedback as soon as the user starts typing again
    setError("");
    setSuccess(false);
  };

  const validate = (): string => {
    if (!form.current) return "Please enter your current password.";
    if (form.next.length < 8)
      return "New password must be at least 8 characters.";
    if (form.next === form.current)
      return "New password must be different from your current password.";
    if (form.next !== form.confirm) return "New passwords do not match.";
    return "";
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      await profileService.changePassword(form.current, form.next);
      setSuccess(true);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm space-y-5">
      <div>
        <h2 className="font-display text-base font-semibold text-text-main">
          Change Password
        </h2>
        <p className="mt-0.5 text-sm text-text-muted">
          Choose a strong password of at least 8 characters.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600"
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700"
        >
          <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Password updated successfully.
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Current password */}
        <div>
          <label
            htmlFor="current-password"
            className="block text-sm font-medium text-text-main mb-1"
          >
            Current Password
          </label>
          <div className="relative">
            <div
              className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
              aria-hidden="true"
            >
              <Lock className="h-5 w-5 text-text-muted" />
            </div>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              required
              value={form.current}
              onChange={(e) => set("current", e.target.value)}
              className={INPUT_CLS}
              placeholder="Enter current password"
            />
          </div>
        </div>

        {/* New password */}
        <div>
          <label
            htmlFor="new-password"
            className="block text-sm font-medium text-text-main mb-1"
          >
            New Password
          </label>
          <div className="relative">
            <div
              className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
              aria-hidden="true"
            >
              <Lock className="h-5 w-5 text-text-muted" />
            </div>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={form.next}
              onChange={(e) => set("next", e.target.value)}
              className={INPUT_CLS}
              placeholder="Min. 8 characters"
            />
          </div>
        </div>

        {/* Confirm new password */}
        <div>
          <label
            htmlFor="confirm-password"
            className="block text-sm font-medium text-text-main mb-1"
          >
            Confirm New Password
          </label>
          <div className="relative">
            <div
              className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
              aria-hidden="true"
            >
              <Lock className="h-5 w-5 text-text-muted" />
            </div>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={form.confirm}
              onChange={(e) => set("confirm", e.target.value)}
              className={INPUT_CLS}
              placeholder="Repeat new password"
            />
          </div>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={isLoading}
            aria-busy={isLoading}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span className="sr-only">Updating…</span>
              </>
            ) : (
              "Update Password"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
