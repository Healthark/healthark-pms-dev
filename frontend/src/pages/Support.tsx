/**
 * Support.tsx — "Performance Evaluation System — Report an Issue".
 *
 * A first-class page (replaces the old Google-Sheet modal):
 *   • Every user gets the in-app issue form (SupportForm).
 *   • Admins get two tabs — "Report an Issue" (the same working form) and
 *     "Responses" (the submitted-ticket queue) — following the tab + card
 *     layout used across the app (Project Reviews, 360 Feedback, …).
 */

import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { SupportForm } from "../components/support/SupportForm";
import { ResponsesTable } from "../components/support/ResponsesTable";

type AdminView = "report" | "responses";

export function Support() {
  const { user } = useAuth();
  const isAdmin = user?.role === "Admin";
  const [view, setView] = useState<AdminView>("report");

  const tabCls = (v: AdminView) =>
    `px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
      view === v
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  const subtitle =
    isAdmin && view === "responses"
      ? "Review issues and questions submitted by your team."
      : "Hit a bug or have a question? Tell us where it happened and what went wrong — we'll follow up.";

  return (
    <div className="flex flex-col gap-6 pb-10 animate-in fade-in duration-500">
      {/* ── Page Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            Performance Evaluation System — Report an Issue
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>
        </div>
      </div>

      {/* ── Main Content Container ── */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        {isAdmin && (
          <div className="flex border-b border-border px-2">
            <button
              type="button"
              className={tabCls("report")}
              onClick={() => setView("report")}
            >
              Report an Issue
            </button>
            <button
              type="button"
              className={tabCls("responses")}
              onClick={() => setView("responses")}
            >
              Responses
            </button>
          </div>
        )}

        <div className="p-5">
          {isAdmin && view === "responses" ? <ResponsesTable /> : <SupportForm />}
        </div>
      </div>
    </div>
  );
}

export default Support;
