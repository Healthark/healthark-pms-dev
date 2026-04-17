/**
 * ProjectReviews.tsx — Project Reviews Page (Revised PM-Centric Flow).
 *
 * No self-review. Employee just sees project cards with status:
 * - "Pending" → waiting for PM to evaluate
 * - "Reviewed" → can click to expand and fetch/view the evaluation
 *
 * Tabs:
 * "Evaluate Team"  → PM (Primary evaluator) — evaluation queue
 * "Secondary"      → Secondary evaluators — impact statement queue
 */

import { useState, useEffect, useCallback } from "react";
import {
  Briefcase, CalendarDays, Clock, CheckCircle2,
  ChevronDown, User, Target, MessageSquare,
  CalendarClock, FileText, Star, Loader2, UserCircle
} from "lucide-react";
import {
  projectReviewService,
  type MyProjectCard,
  type ProjectReviewResponse,
} from "../services/project-review.service";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { PMEvaluationTab } from "../components/project-reviews/PMEvaluationTab";
import { SecondaryEvalTab } from "../components/project-reviews/SecondaryEvalTab";

// Make sure you export this interface from your service file
export interface RoleExpectationResponse {
  id: number;
  department_name: string;
  designation_name: string;
  exp_task_execution: string;
  exp_ownership: string;
  exp_project_management: string;
  exp_client_deliverables: string;
  exp_communication: string;
  exp_mentoring: string;
  exp_competency_skills: string;
}

type ActiveTab = "my" | "evaluate" | "secondary";

// List of competencies from the backend schema
const COMPETENCIES = [
  { key: "task_execution", label: "Task Execution & Problem Solving" },
  { key: "ownership", label: "Ownership & Accountability" },
  { key: "project_management", label: "Project Management and Risk Mitigation" },
  { key: "client_deliverables", label: "Building Client-Ready Deliverables" },
  { key: "communication", label: "Communication & Client/Stakeholder Management" },
  { key: "mentoring", label: "Mentoring and Team Development" },
  { key: "competency_skills", label: "Competency and Skills" },
] as const;

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Smart formatter to handle both new 1-5 ratings and legacy text ratings
function formatPerformanceScore(score: string | null | undefined): string {
  if (!score) return "Not Rated";
  // If it's a single digit 1-5 (new scale)
  if (/^[1-5]$/.test(score)) {
    return `${score} / 5`;
  }
  // Otherwise, it's legacy text (e.g., "Exceeding Expectations")
  return score;
}

// ── Redesigned Project Card (Collapsible & Fetching) ────────────────

function CollapsibleProjectCard({ 
  card, 
  expectations,
  defaultExpanded = false 
}: { 
  readonly card: MyProjectCard;
  readonly expectations: RoleExpectationResponse[];
  readonly defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [reviewDetails, setReviewDetails] = useState<ProjectReviewResponse | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState("");

  const { settings } = useSystemSettings();
  const projectRatingsVisible = settings?.project_ratings_visible ?? false;

  const isReviewed = card.review_status === "reviewed";
  const isPending = card.review_status === "pending" || card.review_status === null;

  // Find the matching role expectation for this specific user's project role
  const roleExp = expectations.find(
    (e) => e.department_name === card.department_name && e.designation_name === card.assignment_role
  );

  // Fetch details when expanding
  const handleToggle = async () => {
    if (!isReviewed) return;

    if (!isExpanded) {
      setIsExpanded(true);
      // Fetch only if we haven't already fetched it
      if (!reviewDetails && card.review_id) {
        setIsFetching(true);
        setError("");
        try {
          const data = await projectReviewService.getReview(card.review_id);
          
          // Transform flat response into categorical structure for the UI
          const transformedData = {
            ...data,
            secondary_impact_statement: (data.secondary_evaluations || [])
              .map(ev => `${ev.evaluator_name}: ${ev.impact_statement}`)
              .join('\n\n'),
            categories: [
              {
                title: "Task Execution & Problem Solving",
                expected_behavior: roleExp?.exp_task_execution || "Role expectation not defined",
                score_comment: data.comment_task_execution
              },
              {
                title: "Ownership & Accountability",
                expected_behavior: roleExp?.exp_ownership || "Role expectation not defined",
                score_comment: data.comment_ownership
              },
              {
                title: "Project Management and Risk Mitigation",
                expected_behavior: roleExp?.exp_project_management || "Role expectation not defined",
                score_comment: data.comment_project_management
              },
              {
                title: "Building Client-Ready Deliverables",
                expected_behavior: roleExp?.exp_client_deliverables || "Role expectation not defined",
                score_comment: data.comment_client_deliverables
              },
              {
                title: "Communication & Client Management",
                expected_behavior: roleExp?.exp_communication || "Role expectation not defined",
                score_comment: data.comment_communication
              },
              {
                title: "Mentoring and Team Development",
                expected_behavior: roleExp?.exp_mentoring || "Role expectation not defined",
                score_comment: data.comment_mentoring
              },
              {
                title: "Competency and Skills",
                expected_behavior: roleExp?.exp_competency_skills || "Role expectation not defined",
                score_comment: data.comment_competency_skills
              }
            ]
          } as any;
          
          setReviewDetails(transformedData);
        } catch (err) {
          setError("Failed to fetch evaluation details");
          console.error(err);
        } finally {
          setIsFetching(false);
        }
      }
    } else {
      setIsExpanded(false);
    }
  };

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-surface p-6 shadow-sm transition-all duration-300 hover:shadow-md">
      {/* Project Header (Clickable Toggle) */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={!isReviewed}
        className={`flex w-full items-center justify-between outline-none transition-all ${
          isExpanded ? 'border-b border-border/60 pb-5 mb-5' : ''
        } ${!isReviewed ? 'cursor-default opacity-90' : 'cursor-pointer'}`}
      >
        <div className="flex items-start sm:items-center gap-4 text-left">
          <div className="mt-1 sm:mt-0 flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand shrink-0">
            <Briefcase className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-bold text-text-main">
                {card.project_name}
              </h2>
              <span className="text-xs text-text-muted font-mono bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                {card.project_code}
              </span>
            </div>
            
            <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-text-muted">
              <span className="flex items-center gap-1.5 font-medium text-text-main/80">
                <User className="h-3.5 w-3.5" /> 
                {card.pm_name ? `PM: ${card.pm_name}` : "PM: Pending Assignment"}
              </span>
              <span className="hidden sm:inline opacity-50">•</span>
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" /> 
                {formatDate(card.project_start_date)} — {formatDate(card.project_expected_end_date)}
              </span>
            </div>
          </div>
        </div>

        {/* Status indicator (Right side) */}
        <div className="flex items-center gap-3">
          {isPending && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase text-amber-700">
              <Clock className="h-3.5 w-3.5" /> Pending
            </span>
          )}
          {isReviewed && (
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
              isExpanded 
                ? 'bg-brand/10 border-brand/20 text-brand' 
                : 'bg-background border-border/50 text-text-muted hover:bg-border/50'
            } ml-4`}>
              <ChevronDown className={`h-5 w-5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
            </div>
          )}
        </div>
      </button>

      {/* Collapsible Content */}
      {isExpanded && isReviewed && (
        <div className="flex flex-col gap-6 animate-in slide-in-from-top-2 fade-in duration-300 min-h-[100px]">
          
          {isFetching ? (
            <div className="flex flex-col items-center justify-center py-8 text-text-muted gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
              <span className="text-[13px] font-medium">Fetching evaluation details...</span>
            </div>
          ) : error ? (
            <div className="text-center py-6 text-[13px] text-red-600 bg-red-50 rounded-xl">
              {error}
            </div>
          ) : reviewDetails ? (
            <>
              {/* Performance Rating — hidden until admin enables visibility */}
              {projectRatingsVisible && (
                <div className="flex items-center justify-between gap-4 flex-wrap rounded-lg border border-emerald-100 bg-emerald-50/50 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Star className="h-4 w-4 text-emerald-600" />
                    <span className="text-[13.5px] text-text-main">
                      Project Evaluation Score: <span className="font-bold text-emerald-700">{formatPerformanceScore(reviewDetails.performance_group)}</span>
                    </span>
                  </div>
                  {reviewDetails.reviewer_name && (
                    <div className="flex items-center gap-1.5 text-[12px] text-emerald-800/80 font-medium bg-emerald-100/50 px-2.5 py-1 rounded-md">
                      <UserCircle className="h-3.5 w-3.5" />
                      Evaluated by {reviewDetails.reviewer_name}
                    </div>
                  )}
                </div>
              )}

              {/* Enhanced Categories Section mapped from API Response */}
              <div className="flex flex-col gap-4">
                {COMPETENCIES.map((comp, idx) => {
                  const commentKey = `comment_${comp.key}` as keyof ProjectReviewResponse;
                  const commentValue = reviewDetails[commentKey] as string | null;

                  // Skip rendering this category if the manager left no comment for it
                  if (!commentValue) return null;

                  return (
                    <div key={comp.key} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-5 border border-slate-100">
                      <h3 className="text-[13.5px] font-bold uppercase tracking-widest text-brand">
                        {idx + 1}. {comp.label}
                      </h3>
                      
                      {/* The Expectation Block */}
                      <div className="rounded-lg bg-white p-4 border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Target className="h-3.5 w-3.5 text-text-muted" />
                          <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Role Expectation</span>
                        </div>
                        {/* We use whitespace-pre-wrap to handle the `|` dividers as visual line breaks if needed, or simply render the text */}
                        <p className="text-[13px] leading-relaxed text-text-muted italic whitespace-pre-wrap">
                          {reviewDetails.categories.find((c: any) => c.title === comp.label)?.expected_behavior.replace(/ \| /g, '\n• ')}
                        </p>
                      </div>

                      {/* The Manager Review Block */}
                      <div className="px-1 mt-1">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <MessageSquare className="h-3.5 w-3.5 text-brand" />
                          <span className="text-[11px] font-bold uppercase tracking-wider text-brand">Manager Review</span>
                        </div>
                        <p className="text-[13.5px] leading-relaxed text-text-main whitespace-pre-wrap">
                          {commentValue}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* PM Overall Impact Statement */}
              {reviewDetails.impact_statement && (
                <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50/50 p-5">
                  <h3 className="text-[12px] font-bold uppercase tracking-widest text-blue-700 mb-3 flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5" /> Overall Impact Statement
                  </h3>
                  <p className="text-[13.5px] leading-relaxed text-blue-900 whitespace-pre-wrap">
                    {reviewDetails.impact_statement}
                  </p>
                </div>
              )}

              {/* Secondary Evaluator Impact Statements */}
              {reviewDetails.secondary_evaluations && reviewDetails.secondary_evaluations.length > 0 && (
                <div className="mt-2 rounded-xl border border-dashed border-border p-5 bg-background/50">
                  <h3 className="text-[12px] font-bold uppercase tracking-widest text-text-muted mb-4 flex items-center gap-2">
                    <User className="h-3.5 w-3.5" /> Secondary Feedback
                  </h3>
                  <div className="flex flex-col gap-4">
                    {reviewDetails.secondary_evaluations.map((ev) => (
                      <div key={ev.id} className="flex flex-col gap-2 pb-4 border-b border-border/50 last:border-0 last:pb-0">
                        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-main">
                          <UserCircle className="h-4 w-4 text-text-muted" />
                          {ev.evaluator_name}
                          <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold tracking-wider text-slate-600 uppercase">
                            Secondary Evaluator
                          </span>
                        </div>
                        <p className="text-[13.5px] leading-relaxed text-text-muted pl-5 whitespace-pre-wrap">
                          {ev.impact_statement ?? "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}

        </div>
      )}
    </section>
  );
}

// ── Skeleton Loader ──────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-6 shadow-sm animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-slate-100 shrink-0" />
        <div className="space-y-2.5 w-full">
          <div className="h-4 w-1/3 rounded bg-slate-100" />
          <div className="h-3 w-1/2 rounded bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

// ── Main Page Component ─────────────────────────────────────────────

export function ProjectReviews() {
  // Any user can be assigned as a PM, so evaluation tabs are shown to everyone.
  // If they aren't a PM, the queue will naturally be empty.
  const showEvalTab = true;

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");
  
  const [cards, setCards] = useState<MyProjectCard[]>([]);
  const [expectations, setExpectations] = useState<RoleExpectationResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Design elements
  const [selectedCycle, setSelectedCycle] = useState('H1 FY26');
  const cycleOptions = ['H1 FY26', 'H2 FY25', 'H1 FY25', 'H2 FY24'];

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch both projects and role expectations in parallel
      const [projectsData, expectationsData] = await Promise.all([
        projectReviewService.getMyProjects(),
        // Add this method to your project-review.service.ts
        projectReviewService.getRoleExpectations() 
      ]);
      setCards(projectsData);
      setExpectations(expectationsData);
    } catch {
      // Stays empty on error
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-3 text-[14px] font-semibold border-b-2 transition-all ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 pb-10 animate-in fade-in duration-500">
      
      {/* ── Page Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-[22px] font-semibold tracking-tight text-text-main">
            Project Reviews
          </h1>
          <p className="mt-1 text-[13px] text-text-muted flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Project-specific performance feedback and evaluations.
          </p>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-2 shadow-sm">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted ml-1.5">Cycle</span>
            <div className="relative mt-0.5 flex items-center rounded-md hover:bg-slate-50 transition-colors px-1.5 py-0.5 group cursor-pointer">
              <CalendarClock className="h-3.5 w-3.5 text-brand shrink-0 pointer-events-none" />
              <select
                value={selectedCycle}
                onChange={(e) => setSelectedCycle(e.target.value)}
                className="appearance-none bg-transparent pl-1.5 pr-5 text-[13px] font-semibold text-text-main outline-none cursor-pointer w-full"
              >
                {cycleOptions.map(cycle => (
                  <option key={cycle} value={cycle}>{cycle}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-1.5 h-3.5 w-3.5 text-text-muted pointer-events-none group-hover:text-brand transition-colors" />
            </div>
          </div>
          <div className="h-8 w-[1px] bg-border" />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Status</span>
            <span className="mt-1 text-[13px] font-semibold text-emerald-600 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Completed
            </span>
          </div>
        </div>
      </div>

      {/* ── Main Content Container ── */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        
        <div className="flex border-b border-border px-2">
          <button type="button" className={tabCls("my")} onClick={() => setActiveTab("my")}>
            My Reviews
          </button>
          {showEvalTab && (
            <>
              <button type="button" className={tabCls("evaluate")} onClick={() => setActiveTab("evaluate")}>
                Evaluate Team
              </button>
              <button type="button" className={tabCls("secondary")} onClick={() => setActiveTab("secondary")}>
                Secondary Reviews
              </button>
            </>
          )}
        </div>

        <div className="p-5">
          {/* Employee Default View (Cards) */}
          {activeTab === "my" && (
            <div className="flex flex-col gap-5">
              {isLoading ? (
                <>
                  <CardSkeleton />
                  <CardSkeleton />
                </>
              ) : cards.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
                  <Briefcase className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
                  <p className="font-display text-base font-medium text-text-main">No projects assigned</p>
                  <p className="mt-1 text-sm text-text-muted">You'll see your project evaluations here once HR assigns them.</p>
                </div>
              ) : (
                cards.map((card, index) => (
                  <CollapsibleProjectCard 
                    key={card.project_id} 
                    card={card} 
                    expectations={expectations}
                    defaultExpanded={false} 
                  />
                ))
              )}
            </div>
          )}

          {/* Manager Tabs */}
          {activeTab === "evaluate" && showEvalTab && <PMEvaluationTab />}
          {activeTab === "secondary" && showEvalTab && <SecondaryEvalTab />}
        </div>
      </div>
    </div>
  );
}