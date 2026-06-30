/**
 * SupportModal — popup launched from the sidebar "Support" item.
 *
 * Embeds the shared support form (where users describe the problem they're
 * facing) in an iframe so they can fill it out without leaving the app. Some
 * hosts (Google included) may refuse to be framed depending on sharing
 * settings, so an always-visible "Open in new tab" link is provided as a
 * fallback. Closes on Esc / X / backdrop, mirroring RoleExpectationsModal.
 *
 * To point Support at a different form, swap SUPPORT_FORM_URL below.
 */
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { HelpCircle, ExternalLink, X } from "lucide-react";

// The support intake form. Swap this for a Google Form (or any URL) without
// touching the rest of the component.
export const SUPPORT_FORM_URL =
  "https://docs.google.com/spreadsheets/d/1UbTNehtm3uiJraj0doo0xfTHYOz2CBhgli4cV6EcHfc/edit?usp=sharing";

export function SupportModal({ onClose }: { readonly onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-modal-title"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] max-h-[85vh] w-full max-w-4xl flex-col rounded-xl bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/50">
              <HelpCircle
                className="h-4 w-4 text-blue-600 dark:text-blue-300"
                aria-hidden="true"
              />
            </div>
            <div>
              <h2
                id="support-modal-title"
                className="font-display text-base font-semibold text-text-main"
              >
                Support
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">
                Describe the problem you're facing and we'll get back to you.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body — embedded support form. */}
        <div className="min-h-0 flex-1 overflow-hidden bg-surface-muted/30">
          <iframe
            src={SUPPORT_FORM_URL}
            title="Support form"
            className="h-full w-full border-0"
          />
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-6 py-3">
          <a
            href={SUPPORT_FORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Open in new tab
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-muted transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
