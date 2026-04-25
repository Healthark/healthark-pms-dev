import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Briefcase,
  FileText,
  Target,
  UserCircle,
  AlertTriangle,
} from "lucide-react";
import {
  menteeService,
  type MenteeDetail as MenteeDetailData,
} from "../services/mentee.service";
import { MenteeProfileTab } from "../components/mentees/MenteeProfileTab";
import { MenteeGoalsTab } from "../components/mentees/MenteeGoalsTab";
import { MenteeReviewTab } from "../components/mentees/MenteeReviewTab";
import { MenteeProjectsTab } from "../components/mentees/MenteeProjectsTab";
import { usePageTitleOverride } from "../hooks/usePageTitleOverride";

type TabKey = "profile" | "goals" | "review" | "projects";

const TABS: ReadonlyArray<{ key: TabKey; label: string; icon: typeof UserCircle }> = [
  { key: "profile", label: "Profile", icon: UserCircle },
  { key: "goals", label: "Annual Goals", icon: Target },
  { key: "review", label: "Annual Review", icon: FileText },
  { key: "projects", label: "Projects", icon: Briefcase },
];

function initialsFor(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function isTabKey(value: string | null): value is TabKey {
  return value === "profile" || value === "goals" || value === "review" || value === "projects";
}

export function MenteeDetail() {
  const { id } = useParams<{ id: string }>();
  const menteeId = Number(id);

  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const activeTab: TabKey = isTabKey(tabFromUrl) ? tabFromUrl : "profile";

  const [data, setData] = useState<MenteeDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Replace the "/3" segment in the Topbar breadcrumb with the mentee's name.
  usePageTitleOverride(data?.full_name ?? null);

  const loadDetail = useCallback(
    (options?: { silent?: boolean }) => {
      if (!menteeId || Number.isNaN(menteeId)) {
        setError("Invalid mentee id.");
        setIsLoading(false);
        return () => {};
      }
      let cancelled = false;
      // silent reload (e.g. after an action) keeps the existing tab content
      // visible instead of flashing the skeleton.
      if (!options?.silent) setIsLoading(true);
      setError(null);
      menteeService
        .getDetail(menteeId)
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch((err) => {
          if (cancelled) return;
          const msg =
            err?.response?.status === 404
              ? "This mentee is not assigned to you or doesn't exist."
              : "Could not load mentee details. Please try again.";
          setError(msg);
        })
        .finally(() => {
          if (!cancelled && !options?.silent) setIsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    },
    [menteeId],
  );

  useEffect(() => loadDetail(), [loadDetail]);

  const reloadDetail = useCallback(() => {
    loadDetail({ silent: true });
  }, [loadDetail]);

  const setActiveTab = (key: TabKey) => {
    // Preserve any other query params by copying from current search.
    const next = new URLSearchParams(searchParams);
    next.set("tab", key);
    setSearchParams(next, { replace: true });
  };

  const subtitle = useMemo(() => {
    if (!data) return null;
    return [data.designation_name, data.department_name].filter(Boolean).join(" · ");
  }, [data]);

  return (
    <div className="space-y-5">
      <Link
        to="/my-mentees"
        className="inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-brand"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to mentees
      </Link>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {isLoading && !data && (
        <div className="h-28 animate-pulse rounded-xl border border-border bg-surface" />
      )}

      {data && (
        <>
          {/* Header */}
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-base font-bold text-white shrink-0"
              aria-hidden="true"
            >
              {initialsFor(data.full_name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-lg font-semibold text-text-main">
                  {data.full_name}
                </h1>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    data.is_active
                      ? "bg-green-100 text-green-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {data.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-text-muted">
                {subtitle || data.role} · {data.employee_code}
              </p>
            </div>
            {data.pending_actions_count > 0 && (
              <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {data.pending_actions_count} pending
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="rounded-xl border border-border bg-surface shadow-sm">
            <div className="flex overflow-x-auto border-b border-border px-2">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = tab.key === activeTab;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "border-brand text-brand"
                        : "border-transparent text-text-muted hover:text-text-main"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="p-5">
              {activeTab === "profile" && <MenteeProfileTab mentee={data} />}
              {activeTab === "goals" && (
                <MenteeGoalsTab
                  goals={data.goals_list}
                  menteeName={data.full_name}
                  onReload={reloadDetail}
                />
              )}
              {activeTab === "review" && (
                <MenteeReviewTab
                  reviews={data.reviews_list}
                  menteeName={data.full_name}
                />
              )}
              {activeTab === "projects" && (
                <MenteeProjectsTab
                  assignments={data.project_assignments}
                  menteeName={data.full_name}
                  menteeUserId={data.user_id}
                  onReload={reloadDetail}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
