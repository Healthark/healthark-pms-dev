import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, Loader2, Pencil, Save, Send, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import {
  projectReviewService,
  type PMEvaluationPayload,
  type PMEvaluationDraftPayload,
  type PerformanceGroup,
  type RoleExpectation,
  type SecondaryEvalResponse,
} from "../../services/project-review.service";
import { ExpectationPanel } from "./ExpectationPanel";
import { SecondaryFeedback } from "./ImpactBlock";
import { useDebounce } from "../../hooks/useDebounce";

const AUTOSAVE_DEBOUNCE_MS = 1500;

/**
 * Minimal header data the modal needs to render its title + context line.
 * Both PMEvaluationTab's UnifiedEvalRow and MenteeProjectsTab's row-builder
 * satisfy this shape without any adapter code.
 */
export interface EvalModalCard {
  employee_name: string;
  project_name: string;
  project_code: string;
  department_name: string | null;
  review_id: number | null;
}

export const COMPETENCIES = [
  { key: "task_execution",      label: "Task Execution & Problem Solving",             expKey: "exp_task_execution" },
  { key: "ownership",           label: "Ownership & Accountability",                    expKey: "exp_ownership" },
  { key: "project_management",  label: "Project Management and Risk Mitigation",        expKey: "exp_project_management" },
  { key: "client_deliverables", label: "Building Client-Ready Deliverables",            expKey: "exp_client_deliverables" },
  { key: "communication",       label: "Communication & Client/Stakeholder Management", expKey: "exp_communication" },
  { key: "mentoring",           label: "Mentoring and Team Development",                expKey: "exp_mentoring" },
  { key: "competency_skills",   label: "Competency and Skills",                         expKey: "exp_competency_skills" },
] as const;

export type CompKey = (typeof COMPETENCIES)[number]["key"];

const EMPTY_COMMENTS: Record<CompKey, string> = {
  task_execution: "",
  ownership: "",
  project_management: "",
  client_deliverables: "",
  communication: "",
  mentoring: "",
  competency_skills: "",
};

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none disabled:bg-surface-muted disabled:text-text-muted disabled:cursor-not-allowed";

interface EvalModalProps {
  readonly card: EvalModalCard;
  readonly expectation: RoleExpectation | null;
  /** True when opening against an existing review (edit or readOnly). */
  readonly isEditMode: boolean;
  /** When true, all inputs are disabled and the submit button is hidden. */
  readonly readOnly?: boolean;
  readonly onSubmit: (payload: PMEvaluationPayload) => Promise<void>;
  readonly onSaveDraft?: (payload: PMEvaluationDraftPayload, silent?: boolean) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly isDraftSaving?: boolean;
  readonly error: string;
}

export function EvalModal({
  card,
  expectation,
  isEditMode,
  readOnly = false,
  onSubmit,
  onSaveDraft,
  onClose,
  isSaving,
  isDraftSaving: externalIsDraftSaving = false,
  error,
}: EvalModalProps) {
  // Pre-load whenever a review row already exists. That covers three
  // distinct cases: editing a finalised review (isEditMode=true), the
  // read-only viewer (readOnly=true), AND continuing from a saved draft
  // — drafts share the same columns as finalised reviews but keep the
  // row's status="pending", so without this branch a PM who saved a
  // draft would re-open the form to empty fields.
  const shouldPreload = card.review_id != null;
  const [isLoadingReview, setIsLoadingReview] = useState(shouldPreload);
  const [fetchError, setFetchError] = useState("");
  const [comments, setComments] = useState<Record<CompKey, string>>(EMPTY_COMMENTS);
  const [performanceGroup, setPerformanceGroup] = useState<PerformanceGroup | "">("");
  const [impactStatement, setImpactStatement] = useState("");
  // Submitted secondary-evaluator impact statements — shown to the PM in the
  // read-only view so they can see the secondary's feedback on the review.
  const [secondaryEvals, setSecondaryEvals] = useState<SecondaryEvalResponse[]>([]);

  // Field-change autosave guard: skip while preload is in flight (would
  // race with the GET) and skip until the user has actually edited a field.
  const skipNextAutosaveRef = useRef(true);

  // Latest onSaveDraft kept in a ref so the autosave effect doesn't
  // re-fire on every parent re-render (which happens whenever a TanStack
  // query invalidation triggers a refetch — the parent rebuilds the
  // callback closure each render). Without this ref, the effect's
  // `[onSaveDraft]` dep would feedback-loop: invalidation → re-render →
  // new callback ref → effect fires → debouncedAutosave → mutation →
  // invalidation → repeat.
  const onSaveDraftRef = useRef(onSaveDraft);
  useEffect(() => {
    onSaveDraftRef.current = onSaveDraft;
  });

  // Last successfully saved payload (JSON-serialized) so the effect can
  // bail when field values haven't changed since the last save. Same
  // pattern as EvalForm's `baselineRef`. Critical safety net against
  // re-render storms from cross-domain invalidation.
  const lastSavedSerializedRef = useRef<string>("");

  useEffect(() => {
    if (!shouldPreload || card.review_id == null) {
      skipNextAutosaveRef.current = true;
      return;
    }
    setIsLoadingReview(true);
    projectReviewService
      .getReview(card.review_id)
      .then((review) => {
        setComments({
          task_execution: review.comment_task_execution ?? "",
          ownership: review.comment_ownership ?? "",
          project_management: review.comment_project_management ?? "",
          client_deliverables: review.comment_client_deliverables ?? "",
          communication: review.comment_communication ?? "",
          mentoring: review.comment_mentoring ?? "",
          competency_skills: review.comment_competency_skills ?? "",
        });
        setPerformanceGroup((review.performance_group ?? "") as PerformanceGroup | "");
        setImpactStatement(review.impact_statement ?? "");
        setSecondaryEvals(review.secondary_evaluations ?? []);
        skipNextAutosaveRef.current = true;
      })
      .catch(() => setFetchError("Failed to load evaluation data."))
      .finally(() => setIsLoadingReview(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setComment = (key: CompKey, value: string) =>
    setComments((prev) => ({ ...prev, [key]: value }));

  const buildDraftPayload = (): PMEvaluationDraftPayload => {
    const payload: PMEvaluationDraftPayload = {
      impact_statement: impactStatement,
      comment_task_execution: comments.task_execution,
      comment_ownership: comments.ownership,
      comment_project_management: comments.project_management,
      comment_client_deliverables: comments.client_deliverables,
      comment_communication: comments.communication,
      comment_mentoring: comments.mentoring,
      comment_competency_skills: comments.competency_skills,
    };
    if (performanceGroup !== "") {
      payload.performance_group = performanceGroup;
    }
    return payload;
  };

  const saveDraftMutation = useMutation({
    mutationFn: async (
      { payload, silent }: { payload: PMEvaluationDraftPayload; silent: boolean },
    ) => {
      // Read the latest onSaveDraft via ref so we always invoke the current
      // callback, regardless of parent re-render timing. `silent` tells the
      // parent this was the debounced autosave (no toast) vs an explicit
      // Save Draft click (toast).
      const fn = onSaveDraftRef.current;
      if (!fn) return payload;
      await fn(payload, silent);
      return payload;
    },
    onSuccess: (saved) => {
      // Snapshot the just-saved payload so the autosave effect can
      // bail when subsequent re-renders fire without the user having
      // changed any field.
      lastSavedSerializedRef.current = JSON.stringify(saved);
    },
  });

  const [debouncedAutosave, cancelAutosave] = useDebounce(
    (payload: PMEvaluationDraftPayload) => {
      // Autosave is silent — no toast on every keystroke.
      saveDraftMutation.mutate({ payload, silent: true });
    },
    AUTOSAVE_DEBOUNCE_MS,
  );

  // Debounced autosave on field changes. Skipped for the read-only viewer,
  // the edit-mode submit-only flow, and the initial hydration pass.
  //
  // Critical: `onSaveDraft` is intentionally NOT in the dep array — it's
  // read via `onSaveDraftRef.current` below. A bare `onSaveDraft` dep
  // would feedback-loop because every mutation invalidates queries →
  // parent refetches → parent re-renders → new onSaveDraft callback ref →
  // effect re-fires → another autosave → another mutation → loop.
  //
  // Belt-and-suspenders: the `lastSavedSerializedRef` baseline check
  // means even if the effect fires post-save (e.g. due to other state
  // bumps), we don't trigger another save when the payload hasn't
  // actually changed since the last successful one.
  useEffect(() => {
    if (readOnly || !onSaveDraftRef.current || isLoadingReview || fetchError) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      // Seed the baseline so a save-on-fresh-mount with no edits is a no-op.
      lastSavedSerializedRef.current = JSON.stringify(buildDraftPayload());
      return;
    }
    const currentPayload = buildDraftPayload();
    const currentSerialized = JSON.stringify(currentPayload);
    if (currentSerialized === lastSavedSerializedRef.current) {
      // Field values match the last-saved snapshot — nothing to do.
      return;
    }
    debouncedAutosave(currentPayload);
    // We intentionally exclude buildDraftPayload + onSaveDraft from deps —
    // the latter is read via ref to avoid the feedback loop described
    // above; the former is a fresh closure each render but only the
    // latest field values matter and `debouncedAutosave`'s identity is
    // stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    comments,
    performanceGroup,
    impactStatement,
    readOnly,
    isLoadingReview,
    fetchError,
    debouncedAutosave,
  ]);

  const isDraftSaving = saveDraftMutation.isPending || externalIsDraftSaving;

  const allFilled =
    COMPETENCIES.every((c) => comments[c.key].trim().length > 0) &&
    performanceGroup !== "" &&
    impactStatement.trim().length > 0;

  const handleManualSaveDraft = () => {
    cancelAutosave();
    // Explicit click — not silent, so the parent shows the "Draft saved" toast.
    saveDraftMutation.mutate({ payload: buildDraftPayload(), silent: false });
  };

  const handleClose = () => {
    cancelAutosave();
    onClose();
  };

  const handleSubmit = () => {
    cancelAutosave(); // submit replaces the draft
    onSubmit({
      performance_group: performanceGroup as PerformanceGroup,
      impact_statement: impactStatement,
      comment_task_execution: comments.task_execution,
      comment_ownership: comments.ownership,
      comment_project_management: comments.project_management,
      comment_client_deliverables: comments.client_deliverables,
      comment_communication: comments.communication,
      comment_mentoring: comments.mentoring,
      comment_competency_skills: comments.competency_skills,
    });
  };

  const title = readOnly
    ? `Evaluation: ${card.employee_name}`
    : isEditMode
    ? `Edit Evaluation: ${card.employee_name}`
    : `Evaluate: ${card.employee_name}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl rounded-xl bg-surface shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              {readOnly ? (
                <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  View Only
                </span>
              ) : isEditMode ? (
                <span className="rounded-full bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  Editing
                </span>
              ) : null}
              <h2 className="font-display text-base font-semibold text-text-main">
                {title}
              </h2>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
              <span>
                {card.project_name} ({card.project_code})
              </span>
              {card.department_name && <span>Dept: {card.department_name}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoadingReview ? (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 animate-pulse">
            {COMPETENCIES.map((c) => (
              <div key={c.key} className="space-y-1.5">
                <div className="h-3 w-48 rounded bg-surface-hover" />
                <div className="h-24 rounded-lg bg-surface-hover" />
              </div>
            ))}
          </div>
        ) : fetchError ? (
          <div className="flex-1 flex items-center justify-center px-6 py-10">
            <p className="rounded-lg bg-red-50 dark:bg-red-950/40 px-5 py-4 text-sm text-red-600 dark:text-red-300 text-center max-w-sm">
              {fetchError}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {error && (
              <p className="rounded-lg bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-sm text-red-600 dark:text-red-300">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <label htmlFor="perf-group" className="text-[13px] font-bold text-text-main">
                  Overall Performance Rating
                </label>
                {!readOnly && (
                  <div className="group relative inline-flex items-center">
                    <Info className="h-3.5 w-3.5 text-text-muted cursor-default" />
                    <div className="invisible group-hover:visible pointer-events-none absolute top-full left-0 z-50 mt-2 w-72 rounded-lg border border-border bg-surface px-3 py-2.5 text-xs text-text-main shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <div className="absolute left-3 bottom-full border-4 border-transparent border-b-border" />
                      <p className="font-semibold mb-1.5">Rating Guide</p>
                      <ul className="space-y-1.5 text-text-muted">
                        <li>
                          <span className="font-semibold text-text-main">1 —</span> Performed beyond expectations
                        </li>
                        <li>
                          <span className="font-semibold text-text-main">2 —</span> Exceeded goals at expected level
                        </li>
                        <li>
                          <span className="font-semibold text-text-main">3 —</span> Achieved goals at expected level
                        </li>
                        <li>
                          <span className="font-semibold text-text-main">4 —</span> Partially achieved goals
                        </li>
                        <li>
                          <span className="font-semibold text-text-main">5 —</span> Did not achieve goals
                        </li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
              <select
                id="perf-group"
                value={performanceGroup}
                onChange={(e) => setPerformanceGroup(e.target.value as PerformanceGroup)}
                disabled={readOnly}
                className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand disabled:bg-surface-muted disabled:text-text-muted disabled:cursor-not-allowed"
              >
                <option value="" disabled>
                  Select
                </option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
            </div>
            {COMPETENCIES.map((comp, idx) => (
              <div key={comp.key}>
                <label
                  htmlFor={`eval-${comp.key}`}
                  className="block text-xs font-semibold text-text-main mb-1"
                >
                  {idx + 1}. {comp.label} {!readOnly && "*"}
                </label>
                {!readOnly && (
                  <ExpectationPanel expectation={expectation} expKey={comp.expKey} />
                )}
                <textarea
                  id={`eval-${comp.key}`}
                  rows={4}
                  className={TEXTAREA_CLS}
                  value={comments[comp.key]}
                  onChange={(e) => setComment(comp.key, e.target.value)}
                  placeholder={`Evaluate ${card.employee_name}'s ${comp.label.toLowerCase()}…`}
                  disabled={readOnly}
                />
              </div>
            ))}
            <div>
              <label
                htmlFor="impact"
                className="block text-xs font-semibold text-text-main mb-1"
              >
                Overall Review {!readOnly && "*"}
              </label>
              <textarea
                id="impact"
                rows={4}
                className={TEXTAREA_CLS}
                value={impactStatement}
                onChange={(e) => setImpactStatement(e.target.value)}
                placeholder="Describe overall impact, key achievements, and areas for growth…"
                disabled={readOnly}
              />
            </div>
            {readOnly && (
              <SecondaryFeedback evaluations={secondaryEvals} compact />
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-muted transition-colors"
          >
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && onSaveDraft && (
            <button
              type="button"
              onClick={handleManualSaveDraft}
              disabled={isSaving || isDraftSaving || isLoadingReview || !!fetchError}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-surface-muted disabled:opacity-50 transition-colors"
            >
              {isDraftSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isDraftSaving ? "Saving…" : "Save Draft"}
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSaving || isDraftSaving || !allFilled || isLoadingReview || !!fetchError}
              className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity ${
                isEditMode ? "bg-amber-500" : "bg-brand"
              }`}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEditMode ? (
                <Pencil className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {isSaving
                ? isEditMode
                  ? "Saving…"
                  : "Submitting…"
                : isEditMode
                ? "Save Changes"
                : "Submit Evaluation"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
