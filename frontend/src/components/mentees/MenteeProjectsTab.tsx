import { Fragment, useState } from "react";
import {
  ChevronDown,
  Clock,
  MessageSquare,
  Star,
  UserCircle,
} from "lucide-react";
import type { MenteeProjectAssignment } from "../../services/mentee.service";
import type { ProjectReviewResponse } from "../../services/project-review.service";

interface MenteeProjectsTabProps {
  readonly assignments: MenteeProjectAssignment[];
  readonly menteeName: string;
}

const COMPETENCIES = [
  { key: "task_execution", label: "Task Execution & Problem Solving" },
  { key: "ownership", label: "Ownership & Accountability" },
  { key: "project_management", label: "Project Management and Risk Mitigation" },
  { key: "client_deliverables", label: "Building Client-Ready Deliverables" },
  { key: "communication", label: "Communication & Client/Stakeholder Management" },
  { key: "mentoring", label: "Mentoring and Team Development" },
  { key: "competency_skills", label: "Competency and Skills" },
] as const;

function statusBadge(status: string | null) {
  if (status === "reviewed") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
        Reviewed
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        Pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
      No review
    </span>
  );
}

function rowKey(a: MenteeProjectAssignment): string {
  return `${a.project_id}-${a.cycle ?? "none"}`;
}

export function MenteeProjectsTab({ assignments, menteeName }: MenteeProjectsTabProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (assignments.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface px-4 py-6 text-center text-sm text-text-muted">
        {menteeName} has no project assignments.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-text-muted">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium w-8"></th>
            <th className="px-4 py-2.5 text-left font-medium">Project</th>
            <th className="px-4 py-2.5 text-left font-medium">Role</th>
            <th className="px-4 py-2.5 text-left font-medium">Cycle</th>
            <th className="px-4 py-2.5 text-left font-medium">Review</th>
            <th className="px-4 py-2.5 text-left font-medium">Rating</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {assignments.map((a) => {
            const key = rowKey(a);
            const isExpanded = expandedKey === key;
            const canExpand = a.review_status === "reviewed" && a.review_detail !== null;
            return (
              <Fragment key={key}>
                <tr
                  className={`transition-colors ${
                    canExpand ? "cursor-pointer" : ""
                  } ${isExpanded ? "bg-brand/5" : canExpand ? "hover:bg-slate-50" : ""}`}
                  onClick={() => {
                    if (!canExpand) return;
                    setExpandedKey(isExpanded ? null : key);
                  }}
                >
                  <td className="px-4 py-2.5 align-top">
                    {canExpand ? (
                      <ChevronDown
                        className={`h-4 w-4 text-text-muted transition-transform ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                        aria-hidden="true"
                      />
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-text-main">{a.project_name}</div>
                    <div className="text-xs text-text-muted">{a.project_code}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-text-main">{a.assignment_role ?? "—"}</div>
                    {a.evaluator_type && (
                      <div className="text-xs text-text-muted">{a.evaluator_type}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-text-muted">{a.cycle ?? "—"}</td>
                  <td className="px-4 py-2.5">{statusBadge(a.review_status)}</td>
                  <td className="px-4 py-2.5">
                    {a.performance_group ? (
                      <span className="font-medium text-text-main">
                        {a.performance_group}
                      </span>
                    ) : (
                      <span className="text-xs text-text-muted italic">—</span>
                    )}
                  </td>
                </tr>
                {isExpanded && a.review_detail && (
                  <ReviewDetailRow review={a.review_detail} />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReviewDetailRow({ review }: { readonly review: ProjectReviewResponse }) {
  return (
    <tr>
      <td colSpan={6} className="bg-slate-50/60 px-5 py-5">
        <div className="flex flex-col gap-4">
          {/* Rating + reviewer strip */}
          {(review.performance_group || review.reviewer_name) && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm">
              {review.performance_group && (
                <span className="flex items-center gap-1.5 text-text-main">
                  <Star className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  Score:{" "}
                  <span className="font-semibold text-emerald-700">
                    {review.performance_group}
                  </span>
                </span>
              )}
              {review.reviewer_name && (
                <span className="ml-auto flex items-center gap-1 text-xs text-emerald-800/80">
                  <UserCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Evaluated by {review.reviewer_name}
                </span>
              )}
            </div>
          )}

          {/* Competency comments */}
          <div className="flex flex-col gap-3">
            {COMPETENCIES.map((c, idx) => {
              const key = `comment_${c.key}` as keyof ProjectReviewResponse;
              const value = review[key] as string | null | undefined;
              if (!value) return null;
              return (
                <div
                  key={c.key}
                  className="rounded-md border border-slate-100 bg-white px-3 py-2.5"
                >
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-brand">
                    {idx + 1}. {c.label}
                  </h4>
                  <div className="mt-1 flex items-start gap-1.5">
                    <MessageSquare
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand"
                      aria-hidden="true"
                    />
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-main">
                      {value}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Overall impact */}
          {review.impact_statement && (
            <div className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2.5">
              <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-700">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                Overall Impact Statement
              </h4>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-blue-900">
                {review.impact_statement}
              </p>
            </div>
          )}

          {/* Secondary feedback */}
          {review.secondary_evaluations.length > 0 && (
            <div className="rounded-md border border-dashed border-border bg-white px-3 py-2.5">
              <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                <UserCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Secondary Feedback
              </h4>
              <div className="mt-2 flex flex-col gap-2.5">
                {review.secondary_evaluations.map((ev) => (
                  <div
                    key={ev.id}
                    className="border-b border-border/60 pb-2 last:border-0 last:pb-0"
                  >
                    <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-main">
                      <UserCircle className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
                      {ev.evaluator_name}
                      <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                        Secondary
                      </span>
                    </div>
                    <p className="mt-0.5 pl-5 text-[13px] leading-relaxed text-text-muted whitespace-pre-wrap">
                      {ev.impact_statement ?? "—"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending = no review_detail path, but guard in case of stale data */}
          {!review.performance_group && !review.impact_statement && (
            <div className="flex items-center gap-1.5 text-sm text-text-muted">
              <Clock className="h-4 w-4" aria-hidden="true" />
              Evaluation pending — awaiting PM review.
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
