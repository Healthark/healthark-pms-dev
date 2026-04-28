import { useState } from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  KeyRound,
  AlertTriangle,
  Check,
  Mail,
  MailX,
  ExternalLink,
} from "lucide-react";
import type { PasswordResetResponse } from "../../services/admin.service";

interface TempPasswordRevealModalProps {
  /** Populated by the admin reset endpoint; the modal opens when this is set. */
  readonly result: PasswordResetResponse;
  readonly onClose: () => void;
}

/**
 * Reveal-once modal for an admin-issued password-reset link.
 *
 * The user's previous password has already been invalidated server-side.
 * Email delivery of the reset link is best-effort — the link is shown here
 * once so the admin can relay it manually if SMTP is down or unconfigured.
 */
export function TempPasswordRevealModal({
  result,
  onClose,
}: TempPasswordRevealModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.reset_link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied — the link is still visible on screen */
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="temp-password-modal-title"
    >
      <div className="w-full max-w-md rounded-xl bg-surface p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-amber-50 p-2">
            <KeyRound className="h-5 w-5 text-amber-600" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="temp-password-modal-title"
              className="font-display text-base font-semibold text-text-main"
            >
              Password reset link generated
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              A one-time link has been issued for{" "}
              <span className="font-medium text-text-main">
                {result.full_name}
              </span>{" "}
              <span className="text-text-muted">({result.email})</span>. Their
              previous password is no longer valid. The link expires in{" "}
              <span className="font-medium text-text-main">
                {result.expires_in_minutes} minutes
              </span>
              .
            </p>
          </div>
        </div>

        {/* Email delivery status */}
        {result.email_sent ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3">
            <Mail className="h-4 w-4 shrink-0 text-green-600 mt-0.5" aria-hidden="true" />
            <p className="text-xs text-green-800">
              Reset link queued for delivery to{" "}
              <span className="font-medium">{result.email}</span>. The copy
              below is a fallback — if they don't receive it, click Reset
              Password again to issue a fresh link.
            </p>
          </div>
        ) : (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <MailX className="h-4 w-4 shrink-0 text-red-600 mt-0.5" aria-hidden="true" />
            <p className="text-xs text-red-800">
              Outbound email is not configured on the server. Copy the link
              below and share it with the user via a secure channel.
            </p>
          </div>
        )}

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-amber-600 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-xs text-amber-800">
              This link is shown only once and is single-use. If the user
              loses it before setting a new password, click Reset Password
              again to generate a fresh link.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <code className="flex-1 rounded-lg border border-border bg-slate-50 px-3 py-2.5 font-mono text-xs text-text-main select-all break-all">
            {result.reset_link}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors shrink-0"
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

        <div className="mt-3">
          <a
            href={result.reset_link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            Open link in new tab
          </a>
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
      </div>
    </div>,
    document.body,
  );
}
