/**
 * SupportTicketModal — read-only detail view for a single support ticket,
 * opened from the admin Responses table's "View" button.
 *
 * Fetches the full ticket (incl. photo data URIs) on open — the list payload
 * carries only a count, so photos load lazily here. Clicking a photo opens a
 * full-size lightbox layered above the modal. Follows the app's shared modal
 * shell (portal + backdrop + Esc/X close), mirroring ProjectReviewDetailModal.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, Loader2, X } from "lucide-react";
import { useSupportTicket } from "../../queries/support";
import { getErrorMessage } from "../../utils/errors";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function SupportTicketModal({
  ticketId,
  onClose,
}: {
  readonly ticketId: number;
  readonly onClose: () => void;
}) {
  const { data, isPending, error } = useSupportTicket(ticketId);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Esc closes the lightbox first, then the modal.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lightbox) setLightbox(null);
      else onClose();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onClose, lightbox]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-ticket-modal-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/40">
              <HelpCircle className="h-4 w-4 text-blue-600 dark:text-blue-300" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="support-ticket-modal-title"
                className="font-display text-base font-semibold text-text-main"
              >
                Support Ticket
              </h2>
              {data && (
                <p className="mt-0.5 truncate text-xs text-text-muted">
                  {data.submitter_name} · {formatWhen(data.created_at)}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-muted"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {isPending ? (
            <div className="flex items-center py-10 text-sm text-text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading details…
            </div>
          ) : error || !data ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
              {error ? getErrorMessage(error) : "Could not load this ticket."}
            </p>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">{data.submitter_name}</Field>
                <Field label="Submitted">{formatWhen(data.created_at)}</Field>
                <Field label="PMS Page">{data.pms_page}</Field>
                <Field label="Tab">{data.tab ?? "—"}</Field>
              </div>

              <Field label="Issue / Query Description">
                <p className="whitespace-pre-wrap break-words text-sm text-text-main">
                  {data.description}
                </p>
              </Field>

              <Field label="Remarks">
                {data.remarks ? (
                  <p className="whitespace-pre-wrap break-words text-sm text-text-main">
                    {data.remarks}
                  </p>
                ) : (
                  <span className="text-sm text-text-muted">—</span>
                )}
              </Field>

              <Field label={`Photos${data.photos.length ? ` (${data.photos.length})` : ""}`}>
                {data.photos.length === 0 ? (
                  <span className="text-sm text-text-muted">No photos attached.</span>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {data.photos.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setLightbox(p.data_uri)}
                        className="h-24 w-24 overflow-hidden rounded-lg border border-border transition-transform hover:scale-[1.03]"
                        title={p.filename ?? "attachment"}
                      >
                        <img
                          src={p.data_uri}
                          alt={p.filename ?? "attachment"}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </Field>
            </div>
          )}
        </div>
      </div>

      {/* Photo lightbox — layered above the modal. */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 p-6"
          onClick={(e) => {
            e.stopPropagation();
            setLightbox(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Attachment preview"
        >
          <img
            src={lightbox}
            alt="Attachment full size"
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(null);
            }}
            className="absolute right-4 top-4 rounded-full bg-slate-800/80 p-2 text-white hover:bg-slate-700"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">
        {label}
      </p>
      <div className="text-sm text-text-main">{children}</div>
    </div>
  );
}
