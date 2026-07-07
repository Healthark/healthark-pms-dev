import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, Loader2, Pencil, Save, Send, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import {
  projectReviewService,
  type Competency,
  type PMEvaluationPayload,
  type PMEvaluationDraftPayload,
  type PerformanceGroup,
  type RoleExpectation,
  type SecondaryEvalResponse,
} from "../../services/project-review.service";
import { useCompetencies } from "../../queries/projectReviews";
import { ExpectationPanel } from "./ExpectationPanel";
import { SecondaryFeedback } from "./ImpactBlock";
import { useDebounce } from "../../hooks/useDebounce";

const AUTOSAVE_DEBOUNCE_MS = 1500;

/**
 * Minimal header data the modal needs to render its title + context line,
 * plus the reviewee's department_id + level so it can fetch the applicable
 * competency set. PMEvaluationTab's UnifiedEvalRow satisfies this shape.
 */
export interface EvalModalCard {
  employee_name: string;
  project_name: string;
  project_code: string;
  department_name: string | null;
  review_id: number | null;
  department_id: number | null;
  level: number | null;
}

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
  // The competency set for this reviewee's (department, level). Falls back to
  // the org default set when the card carries no dept/level (or none is
  // defined for that role). Only reviewable competencies get a comment box.
  const {
    data: competencySet,
    isLoading: compLoading,
    isError: compError,
  } = useCompetencies(card.department_id, card.level);
  // For an EXISTING review, render by the competencies it was written against
  // — embedded on the review payload, resolved by its stored comment ids — so a
  // later framework change can't blank or misattribute its comments. A NEW
  // review (or an existing row with no comments yet) uses the current
  // (department, level) set fetched above.
  const [reviewCompetencies, setReviewCompetencies] = useState<Competency[] | null>(
    null,
  );
  const reviewableComps = useMemo<Competency[]>(() => {
    const stored = (reviewCompetencies ?? []).filter((c) => c.is_reviewable);
    if (stored.length > 0) return stored;
    return (competencySet?.competencies ?? []).filter((c) => c.is_reviewable);
  }, [reviewCompetencies, competencySet]);
  const usingStoredSet = (reviewCompetencies ?? []).some((c) => c.is_reviewable);

  // Pre-load whenever a review row already exists. That covers three
  // distinct cases: editing a finalised review (isEditMode=true), the
  // read-only viewer (readOnly=true), AND continuing from a saved draft
  // — drafts share the same row as finalised reviews but keep the row's
  // status="pending", so without this branch a PM who saved a draft would
  // re-open the form to empty fields.
  const shouldPreload = card.review_id != null;
  const [isLoadingReview, setIsLoadingReview] = useState(shouldPreload);
  const [fetchError, setFetchError] = useState("");
  // Comments keyed by competency id (string) — the dynamic, framework-aware
  // shape. Hydrated directly from the review's `comments` map (also id-keyed;
  // the backend fills the legacy-column fallback server-side).
  const [comments, setComments] = useState<Record<string, string>>({});
  const [performanceGroup, setPerformanceGroup] = useState<PerformanceGroup | "">("");
  const [impactStatement, setImpactStatement] = useState("");
  // Submitted secondary-evaluator impact statements — shown to the PM in the
  // read-only view so they can see the secondary's feedback on the review.
  const [secondaryEvals, setSecondaryEvals] = useState<SecondaryEvalResponse[]>([]);

  // Once we know the review brought its own competencies, don't block on (or
  // fail for) the current-set fetch — it's unused in that case.
  const isLoading = isLoadingReview || (!usingStoredSet && compLoading);
  // A failed current-set fetch must NOT silently render an empty form: without
  // a set there are no boxes and the reverse-map would emit all-empty comment_*
  // fields, which a Save Draft / autosave would persist and wipe existing
  // comments. Surface it as a blocking error so the form can't be saved in that
  // state. Irrelevant once we're rendering from the review's own stored set.
  const loadError =
    fetchError ||
    (!usingStoredSet && compError
      ? "Couldn't load the evaluation form. Please close and try again."
      : "");

  // Field-change autosave guard: skip while preload is in flight (would
  // race with the GET) and skip until the user has actually edited a field.
  const skipNextAutosaveRef = useRef(true);

  // Latest onSaveDraft kept in a ref so the autosave effect doesn't re-fire
  // on every parent re-render (which happens whenever a TanStack query
  // invalidation triggers a refetch). Without this ref, the effect's
  // `[onSaveDraft]` dep would feedback-loop.
  const onSaveDraftRef = useRef(onSaveDraft);
  useEffect(() => {
    onSaveDraftRef.current = onSaveDraft;
  });

  // Last successfully saved payload (JSON-serialized) so the effect can bail
  // when field values haven't changed since the last save.
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
        // review.comments is keyed by competency id (the backend builds it
        // from the legacy columns for pre-cutover rows), so hydrate directly.
        const map: Record<string, string> = {};
        for (const [cid, text] of Object.entries(review.comments ?? {})) {
          map[cid] = text ?? "";
        }
        setComments(map);
        // Render this review by the competencies it was written against.
        setReviewCompetencies(review.competencies ?? []);
        setPerformanceGroup((review.performance_group ?? "") as PerformanceGroup | "");
        setImpactStatement(review.impact_statement ?? "");
        setSecondaryEvals(review.secondary_evaluations ?? []);
        skipNextAutosaveRef.current = true;
      })
      .catch(() => setFetchError("Failed to load evaluation data."))
      .finally(() => setIsLoadingReview(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setComment = (id: string, value: string) =>
    setComments((prev) => ({ ...prev, [id]: value }));

  // The dynamic {competency_id: text} write payload, covering every reviewable
  // competency currently rendered — including custom per-department/level ones.
  // The backend stores this as the source of truth and dual-writes the legacy
  // columns for the default competencies.
  const buildCommentsMap = (): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const c of reviewableComps) {
      map[String(c.id)] = comments[String(c.id)] ?? "";
    }
    return map;
  };

  // Resolve the expectation text for a competency: prefer the text seeded on
  // the competency itself (the department/level framework), then the legacy
  // per-designation expectations map, then the fixed exp_<key> field.
  const expectationText = (comp: Competency): string | null => {
    if (comp.expectation) return comp.expectation;
    const byId = expectation?.expectations?.[String(comp.id)];
    if (byId != null) return byId;
    const legacy = expectation
      ? (expectation as unknown as Record<string, string | null>)[`exp_${comp.key}`]
      : null;
    return legacy ?? null;
  };

  const buildDraftPayload = (): PMEvaluationDraftPayload => {
    const payload: PMEvaluationDraftPayload = {
      impact_statement: impactStatement,
      comments: buildCommentsMap(),
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
      const fn = onSaveDraftRef.current;
      if (!fn) return payload;
      await fn(payload, silent);
      return payload;
    },
    onSuccess: (saved) => {
      lastSavedSerializedRef.current = JSON.stringify(saved);
    },
  });

  const [debouncedAutosave, cancelAutosave] = useDebounce(
    (payload: PMEvaluationDraftPayload) => {
      saveDraftMutation.mutate({ payload, silent: true });
    },
    AUTOSAVE_DEBOUNCE_MS,
  );

  // Debounced autosave on field changes. Skipped for the read-only viewer,
  // while anything is still loading, and on the initial hydration pass. The
  // payload is the reverse-mapped fixed shape, so its serialization is stable
  // regardless of the dynamic (id-keyed) state.
  useEffect(() => {
    if (readOnly || !onSaveDraftRef.current || isLoading || loadError) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      lastSavedSerializedRef.current = JSON.stringify(buildDraftPayload());
      return;
    }
    const currentPayload = buildDraftPayload();
    const currentSerialized = JSON.stringify(currentPayload);
    if (currentSerialized === lastSavedSerializedRef.current) {
      return;
    }
    debouncedAutosave(currentPayload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    comments,
    performanceGroup,
    impactStatement,
    readOnly,
    isLoadingReview,
    compLoading,
    compError,
    fetchError,
    debouncedAutosave,
  ]);

  const isDraftSaving = saveDraftMutation.isPending || externalIsDraftSaving;

  const allFilled =
    reviewableComps.length > 0 &&
    reviewableComps.every((c) => (comments[String(c.id)] ?? "").trim().length > 0) &&
    performanceGroup !== "" &&
    impactStatement.trim().length > 0;

  const handleManualSaveDraft = () => {
    cancelAutosave();
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
      comments: buildCommentsMap(),
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

        {isLoading ? (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 animate-pulse">
            {Array.from({ length: reviewableComps.length || 7 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-48 rounded bg-surface-hover" />
                <div className="h-24 rounded-lg bg-surface-hover" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="flex-1 flex items-center justify-center px-6 py-10">
            <p className="rounded-lg bg-red-50 dark:bg-red-950/40 px-5 py-4 text-sm text-red-600 dark:text-red-300 text-center max-w-sm">
              {loadError}
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
            {reviewableComps.map((comp, idx) => (
              <div key={comp.id}>
                <label
                  htmlFor={`eval-${comp.id}`}
                  className="block text-xs font-semibold text-text-main mb-1"
                >
                  {idx + 1}. {comp.label} {!readOnly && "*"}
                </label>
                {!readOnly && (
                  <ExpectationPanel
                    text={expectationText(comp)}
                    deptName={expectation?.department_name}
                    desigName={expectation?.designation_name}
                  />
                )}
                <textarea
                  id={`eval-${comp.id}`}
                  rows={4}
                  className={TEXTAREA_CLS}
                  value={comments[String(comp.id)] ?? ""}
                  onChange={(e) => setComment(String(comp.id), e.target.value)}
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
              disabled={isSaving || isDraftSaving || isLoading || !!loadError}
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
              disabled={isSaving || isDraftSaving || !allFilled || isLoading || !!loadError}
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
