import { MessageSquare } from "lucide-react";
import type {
  ProjectReviewResponse,
  RoleExpectation,
} from "../../services/project-review.service";
import { ExpectationToggle } from "./ExpectationToggle";
import { resolveReviewBlocks } from "./reviewCompetencies";

/**
 * Renders the PM-evaluation competency blocks for a reviewed project. Each
 * block surfaces:
 *   - the manager's per-competency comment (the only required content)
 *   - a collapsible role-expectation snippet
 *
 * The competencies rendered come from the review's OWN framework (see
 * resolveReviewBlocks), so a review always renders by the framework it was
 * written against — even after the department's framework changes.
 *
 * `compact` shrinks paddings/typography for use inside the table-view
 * expanded row; the grid-view detail panel uses the spacious default.
 */
export function CompetencyBlock({
  review,
  roleExp,
  compact,
}: {
  readonly review: ProjectReviewResponse;
  readonly roleExp: RoleExpectation | undefined;
  readonly compact?: boolean;
}) {
  const blocks = resolveReviewBlocks(review, roleExp);
  return (
    <div className={`flex flex-col ${compact ? "gap-3" : "gap-4"}`}>
      {blocks.map((block, idx) => {
        if (!block.comment) return null;

        return (
          <div
            key={block.key}
            className={`flex flex-col gap-2 ${
              compact
                ? "rounded-lg bg-surface-muted p-3 border border-border"
                : "rounded-xl bg-surface-muted p-5 border border-border"
            }`}
          >
            <h3
              className={`font-bold uppercase tracking-widest text-brand ${
                compact ? "text-[12px]" : "text-[13.5px]"
              }`}
            >
              {idx + 1}. {block.label}
            </h3>

            <ExpectationToggle text={block.expText} />

            <div className={compact ? "px-0.5" : "px-1 mt-1"}>
              <div className="flex items-center gap-1.5 mb-1">
                <MessageSquare className="h-3.5 w-3.5 text-brand" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-brand">
                  Manager Review
                </span>
              </div>
              <p
                className={`leading-relaxed text-text-main whitespace-pre-wrap ${
                  compact ? "text-[13px]" : "text-[13.5px]"
                }`}
              >
                {block.comment}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
