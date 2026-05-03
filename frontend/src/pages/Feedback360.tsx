/**
 * Feedback360.tsx — entry page for the 360 Feedback module.
 *
 * Tabs:
 *   Give Feedback     — peer list w/ submit modal
 *   My Feedback       — aggregate of feedback received on the current user
 *   Mentee Feedback   — picker over direct mentees, then aggregate (hidden if !has_mentees)
 *   Org Feedback      — picker over the whole org, then aggregate (Management only)
 *
 * Aggregate access is checked at the API layer — the tabs themselves
 * are just navigation; a non-Management user can't see the Org tab,
 * but if they hit /aggregate/{any} directly the backend returns 403.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, UserCircle } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import {
  menteeService,
  type MenteeSummary,
} from "../services/mentee.service";
import {
  feedback360Service,
  type FeedbackPeer,
} from "../services/feedback360.service";
import { getErrorMessage } from "../utils/errors";
import { PeerList } from "../components/feedback360/PeerList";
import { AggregateView } from "../components/feedback360/AggregateView";

type TabKey = "give" | "my" | "mentees" | "org";

export function Feedback360() {
  const { user } = useAuth();
  const isMgmt = !!user?.is_management;
  const hasMentees = !!user?.has_mentees;

  const [activeTab, setActiveTab] = useState<TabKey>("give");

  const tabCls = (tab: TabKey) =>
    `px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main flex items-center gap-2">
          360 Feedback
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          Share peer feedback and view the aggregate of feedback received.
          Reviews are anonymous — submit-once per colleague, per fiscal year.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        <div className="flex border-b border-border px-2 overflow-x-auto">
          <button
            type="button"
            className={tabCls("give")}
            onClick={() => setActiveTab("give")}
          >
            Give Feedback
          </button>
          <button
            type="button"
            className={tabCls("my")}
            onClick={() => setActiveTab("my")}
          >
            My Feedback
          </button>
          {hasMentees && (
            <button
              type="button"
              className={tabCls("mentees")}
              onClick={() => setActiveTab("mentees")}
            >
              Mentee Feedback
            </button>
          )}
          {isMgmt && (
            <button
              type="button"
              className={tabCls("org")}
              onClick={() => setActiveTab("org")}
            >
              Org Feedback
            </button>
          )}
        </div>

        <div className="p-5">
          {activeTab === "give" && <PeerList />}
          {activeTab === "my" && user && (
            <AggregateView
              targetUserId={user.user_id}
              heading="Your aggregate"
            />
          )}
          {activeTab === "mentees" && hasMentees && <MenteeFeedbackTab />}
          {activeTab === "org" && isMgmt && <OrgFeedbackTab />}
        </div>
      </div>
    </div>
  );
}

// ── Mentee tab ──────────────────────────────────────────────────────

function MenteeFeedbackTab() {
  const [mentees, setMentees] = useState<MenteeSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<MenteeSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    menteeService
      .getSummaries()
      .then((rows) => {
        if (cancelled) return;
        setMentees(rows);
        if (rows.length > 0) setSelected(rows[0]);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading mentees…
      </div>
    );
  }
  if (error) {
    return (
      <p className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error}
      </p>
    );
  }
  if (mentees.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border py-12 text-center text-sm text-text-muted">
        No direct mentees yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="mentee-picker"
          className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1"
        >
          Mentee
        </label>
        <select
          id="mentee-picker"
          value={selected?.user_id ?? ""}
          onChange={(e) => {
            const id = Number(e.target.value);
            setSelected(mentees.find((m) => m.user_id === id) ?? null);
          }}
          className="w-full sm:w-72 rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main outline-none focus:border-brand"
        >
          {mentees.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name}
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <AggregateView
          key={selected.user_id}
          targetUserId={selected.user_id}
          heading={`${selected.full_name}'s aggregate`}
        />
      )}
    </div>
  );
}

// ── Org tab (Management only) ───────────────────────────────────────

function OrgFeedbackTab() {
  const [peers, setPeers] = useState<FeedbackPeer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<FeedbackPeer | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    feedback360Service
      .getPeers()
      .then((rows) => {
        if (!cancelled) setPeers(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return peers;
    return peers.filter((p) => p.full_name.toLowerCase().includes(q));
  }, [peers, search]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading org…
      </div>
    );
  }
  if (error) {
    return (
      <p className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Picker column */}
      <div className="md:col-span-1 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search org…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-1.5 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand"
          />
        </div>
        <div className="rounded-lg border border-border max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-4 text-xs italic text-text-muted">
              No matches.
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {filtered.map((p) => {
                const isActive = selected?.user_id === p.user_id;
                return (
                  <li key={p.user_id}>
                    <button
                      type="button"
                      onClick={() => setSelected(p)}
                      className={`w-full flex items-center gap-2 text-left px-3 py-2 transition-colors ${
                        isActive
                          ? "bg-brand/10"
                          : "hover:bg-slate-50/60"
                      }`}
                    >
                      <UserCircle className="h-4 w-4 text-text-muted shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-text-main truncate">
                          {p.full_name}
                        </p>
                        {p.designation_name && (
                          <p className="text-[11px] text-text-muted truncate">
                            {p.designation_name}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Aggregate column */}
      <div className="md:col-span-2">
        {selected ? (
          <AggregateView
            key={selected.user_id}
            targetUserId={selected.user_id}
            heading={`${selected.full_name}'s aggregate`}
          />
        ) : (
          <div className="rounded-lg border-2 border-dashed border-border py-16 text-center text-sm text-text-muted">
            Pick a colleague from the list to view their aggregate.
          </div>
        )}
      </div>
    </div>
  );
}
