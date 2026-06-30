import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  Loader2,
  Search,
  Send,
  UserCircle,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type FeedbackPeer } from "../../services/feedback360.service";
import { useFeedbackPeers } from "../../queries/feedback360";
import { getErrorMessage } from "../../utils/errors";
import { ClearFiltersButton } from "../common/ClearFiltersButton";

/**
 * Give Feedback tab — every active org user (excluding self), with a
 * search + filter toolbar. Each row links to /feedback/give/:user_id.
 *
 * Org-sized peer lists can reach 500+ rows, so the visible cards are
 * rendered through @tanstack/react-virtual v3. We virtualize at the
 * row level and pair items into a 2-column inner grid so the original
 * desktop layout is preserved.
 */
const ROW_GAP_PX = 8; // matches the old `gap-2` between cards
const ESTIMATED_ROW_PX = 76; // ~card height + vertical padding
const OVERSCAN = 6;

export function PeerList() {
  const {
    data: peers = [],
    isPending,
    error: queryError,
  } = useFeedbackPeers();
  const isLoading = isPending;
  const error = queryError ? getErrorMessage(queryError) : "";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "worked" | "not_worked">(
    "all",
  );
  const [deptFilter, setDeptFilter] = useState<string>("all");

  const hasActiveFilters =
    !!search || filter !== "all" || deptFilter !== "all";

  const clearFilters = () => {
    setSearch("");
    setFilter("all");
    setDeptFilter("all");
  };

  // Department options derived from the peers actually in the list, so the
  // dropdown only offers departments that exist — dynamic, like the other
  // data-driven filters in the app.
  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const p of peers) if (p.department_name) set.add(p.department_name);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [peers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return peers.filter((p) => {
      if (q && !p.full_name.toLowerCase().includes(q)) return false;
      if (filter === "worked" && !p.worked_with) return false;
      if (filter === "not_worked" && p.worked_with) return false;
      if (deptFilter !== "all" && p.department_name !== deptFilter) return false;
      return true;
    });
  }, [peers, search, filter, deptFilter]);

  // Pair items so each virtual row owns up to 2 cards. This keeps the
  // existing desktop 2-col grid look while letting us virtualize a
  // straight row index.
  const pairs = useMemo(() => {
    const out: FeedbackPeer[][] = [];
    for (let i = 0; i < filtered.length; i += 2) {
      out.push(filtered.slice(i, i + 2));
    }
    return out;
  }, [filtered]);

  const parentRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: pairs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_PX,
    gap: ROW_GAP_PX,
    overscan: OVERSCAN,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading peers…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-300 mt-0.5" />
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      </div>
    );
  }
  if (peers.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border py-12 text-center text-sm text-text-muted">
        No employees to review.
      </div>
    );
  }

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search employees…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-1.5 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {departments.length > 0 && (
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              aria-label="Filter by department"
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer"
            >
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All ({peers.length})
          </FilterChip>
          <FilterChip
            active={filter === "worked"}
            onClick={() => setFilter("worked")}
          >
            Worked with
          </FilterChip>
          <FilterChip
            active={filter === "not_worked"}
            onClick={() => setFilter("not_worked")}
          >
            Not worked with
          </FilterChip>
          <ClearFiltersButton active={hasActiveFilters} onClear={clearFilters} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-border py-12 text-center text-sm text-text-muted">
          No employees match the current filter.
        </div>
      ) : (
        <div
          ref={parentRef}
          className="rounded-lg border border-border bg-surface"
          style={{
            height: 640,
            overflow: "auto",
            position: "relative",
            contain: "strict",
          }}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualRows.map((virtualRow) => {
              const row = pairs[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="grid grid-cols-1 gap-2 px-2 sm:grid-cols-2">
                    {row.map((p) => (
                      <PeerRow key={p.user_id} peer={p} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PeerRow({ peer }: { readonly peer: FeedbackPeer }) {
  return (
    <Link
      to={`/feedback/give/${peer.user_id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm hover:border-brand/40 hover:bg-surface-muted/40 transition-colors"
    >
      <UserCircle className="h-7 w-7 text-text-muted shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text-main truncate">{peer.full_name}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {peer.designation_name && (
            <span className="text-[11px] text-text-muted truncate">
              {peer.designation_name}
              {peer.department_name && ` · ${peer.department_name}`}
            </span>
          )}
          <span
            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              peer.worked_with
                ? "bg-brand/10 text-brand"
                : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
            }`}
          >
            {peer.worked_with ? "Worked with" : "Not worked with"}
          </span>
        </div>
      </div>
      {peer.has_submitted ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-green-50 dark:bg-green-950/40 px-2 py-1 text-[11px] font-medium text-green-700 dark:text-green-300 shrink-0">
          <Eye className="h-3 w-3" /> View
          <CheckCircle2 className="h-3 w-3 ml-0.5" />
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-brand/10 px-2.5 py-1 text-[11px] font-medium text-brand shrink-0">
          <Send className="h-3 w-3" /> Give Feedback
        </span>
      )}
    </Link>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "bg-brand text-white"
          : "bg-surface border border-border text-text-muted hover:bg-surface-muted"
      }`}
    >
      {children}
    </button>
  );
}
