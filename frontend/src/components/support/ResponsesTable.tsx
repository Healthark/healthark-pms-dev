/**
 * ResponsesTable — the admin "Responses" view of submitted support tickets.
 *
 * A filterable/searchable list (PMS page, lifecycle status, free-text). The
 * status filter defaults to "Pending" so the queue opens on what needs
 * attention. Each row shows an EDITABLE status control (set any state at any
 * time — no forced progression) and a "View" button that opens
 * SupportTicketModal with the full details.
 */

import { useEffect, useMemo, useState } from "react";
import { Eye, ImageIcon, Inbox, Loader2, Search, X } from "lucide-react";
import {
  useSupportTickets,
  useUpdateSupportTicketStatus,
} from "../../queries/support";
import {
  type SupportStatus,
  type SupportTicketRow,
} from "../../services/support.service";
import { getErrorMessage } from "../../utils/errors";
import { useToast } from "../../hooks/useToast";
import {
  DEFAULT_STATUS_FILTER,
  PMS_PAGES,
  SUPPORT_STATUS_OPTIONS,
  statusMeta,
} from "../../utils/supportOptions";
import { SupportTicketModal } from "./SupportTicketModal";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ResponsesTable() {
  const [pageFilter, setPageFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<SupportStatus | "">(
    DEFAULT_STATUS_FILTER,
  );
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [viewingId, setViewingId] = useState<number | null>(null);

  const toast = useToast();
  const updateStatus = useUpdateSupportTicketStatus();

  // Debounce search so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = useMemo(
    () => ({
      pms_page: pageFilter || undefined,
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
    }),
    [pageFilter, debouncedSearch, statusFilter],
  );

  const { data: tickets = [], isPending, error } = useSupportTickets(filters);

  const handleStatusChange = (id: number, status: SupportStatus) => {
    updateStatus.mutate(
      { id, status },
      {
        onSuccess: () =>
          toast.success(`Marked "${statusMeta(status).label}".`),
        onError: (err) => toast.info(getErrorMessage(err)),
      },
    );
  };

  const hasFilters = Boolean(pageFilter || debouncedSearch || statusFilter);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-48">
          <label
            htmlFor="responses-status-filter"
            className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Status
          </label>
          <select
            id="responses-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as SupportStatus | "")}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-brand"
          >
            <option value="">All statuses</option>
            {SUPPORT_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:w-48">
          <label
            htmlFor="responses-page-filter"
            className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            PMS Page
          </label>
          <select
            id="responses-page-filter"
            value={pageFilter}
            onChange={(e) => setPageFilter(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-brand"
          >
            <option value="">All pages</option>
            {PMS_PAGES.map((p) => (
              <option key={p.page} value={p.page}>
                {p.page}
              </option>
            ))}
          </select>
        </div>

        <div className="relative flex-1">
          <label
            htmlFor="responses-search"
            className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              id="responses-search"
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search reporter, description, remarks…"
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-9 text-sm text-text-main placeholder:text-text-muted outline-none focus:border-brand"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:bg-surface-muted"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* States */}
      {isPending ? (
        <div className="flex items-center justify-center py-16 text-sm text-text-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading responses…
        </div>
      ) : error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          {getErrorMessage(error)}
        </p>
      ) : tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border py-16 text-center text-sm text-text-muted">
          <Inbox className="h-6 w-6" />
          {hasFilters
            ? "No responses match your filters."
            : "No support responses yet."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-surface-muted/60 text-[11px] uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Name</th>
                <th className="px-3 py-2.5 font-semibold">PMS Page</th>
                <th className="px-3 py-2.5 font-semibold">Tab</th>
                <th className="px-3 py-2.5 font-semibold">Description</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Photos</th>
                <th className="px-3 py-2.5 font-semibold">Submitted</th>
                <th className="px-3 py-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tickets.map((t) => (
                <TicketRow
                  key={t.id}
                  row={t}
                  onView={() => setViewingId(t.id)}
                  onStatusChange={(status) => handleStatusChange(t.id, status)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewingId !== null && (
        <SupportTicketModal
          ticketId={viewingId}
          onClose={() => setViewingId(null)}
        />
      )}
    </div>
  );
}

function TicketRow({
  row,
  onView,
  onStatusChange,
}: {
  readonly row: SupportTicketRow;
  readonly onView: () => void;
  readonly onStatusChange: (status: SupportStatus) => void;
}) {
  return (
    <tr className="align-top transition-colors hover:bg-surface-muted/40">
      <td className="px-3 py-3 font-medium text-text-main">{row.submitter_name}</td>
      <td className="px-3 py-3 text-text-main">{row.pms_page}</td>
      <td className="px-3 py-3 text-text-muted">{row.tab ?? "—"}</td>
      <td className="max-w-[20rem] px-3 py-3 text-text-muted">
        <span className="line-clamp-1">{row.description}</span>
      </td>
      <td className="px-3 py-3">
        <StatusSelect value={row.status} onChange={onStatusChange} />
      </td>
      <td className="px-3 py-3 text-text-muted">
        {row.photo_count > 0 ? (
          <span className="inline-flex items-center gap-1">
            <ImageIcon className="h-3.5 w-3.5" />
            {row.photo_count}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-text-muted">
        {formatWhen(row.created_at)}
      </td>
      <td className="px-3 py-3 text-right">
        <button
          type="button"
          onClick={onView}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-main transition-colors hover:border-brand hover:text-brand"
        >
          <Eye className="h-3.5 w-3.5" />
          View
        </button>
      </td>
    </tr>
  );
}

/**
 * Editable status pill. Reflects the picked value immediately (local state)
 * while the server round-trips, and re-syncs if the server value changes.
 * Any status can be chosen at any time — no forced progression.
 */
function StatusSelect({
  value,
  onChange,
}: {
  readonly value: SupportStatus;
  readonly onChange: (status: SupportStatus) => void;
}) {
  const [local, setLocal] = useState<SupportStatus>(value);
  // Re-sync to the server value (after refetch) without an effect — the
  // render-time adjustment pattern, mirroring StringCombobox.
  const [seen, setSeen] = useState<SupportStatus>(value);
  if (seen !== value) {
    setSeen(value);
    setLocal(value);
  }

  const meta = statusMeta(local);

  return (
    <select
      value={local}
      aria-label="Ticket status"
      onChange={(e) => {
        const next = e.target.value as SupportStatus;
        setLocal(next);
        onChange(next);
      }}
      className={`cursor-pointer rounded-md border px-2 py-1 text-xs font-semibold outline-none focus:ring-1 focus:ring-brand ${meta.badgeClass}`}
    >
      {SUPPORT_STATUS_OPTIONS.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
