import { AlertTriangle } from "lucide-react";

interface CoverageGapBannerProps {
  /** Active mentees whose mentor was removed (dangling link). */
  readonly menteeCount: number;
  /** Active projects with no active Primary (PM). */
  readonly projectCount: number;
  /** Jump to the Users tab to reassign mentors. */
  readonly onFixMentees: () => void;
  /** Jump to the Projects tab to assign a PM. */
  readonly onFixProjects: () => void;
}

/**
 * Persistent red "action required" banner shown at the top of the Admin Panel
 * while a removed/reassigned mentor or PM has left mentees orphaned or a
 * project without a PM. Renders nothing when there are no gaps; it clears as
 * soon as the admin reassigns (the driving query is invalidated by the
 * relevant user/project mutations).
 */
export function CoverageGapBanner({
  menteeCount,
  projectCount,
  onFixMentees,
  onFixProjects,
}: CoverageGapBannerProps) {
  if (menteeCount <= 0 && projectCount <= 0) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950/40"
    >
      <AlertTriangle
        className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-300"
        aria-hidden="true"
      />
      <div className="flex-1 text-sm">
        <p className="font-semibold text-red-800 dark:text-red-200">
          Action required: coverage gap
        </p>
        <p className="mt-0.5 text-red-700 dark:text-red-300">
          {menteeCount > 0 && (
            <button
              type="button"
              onClick={onFixMentees}
              className="font-medium underline underline-offset-2 hover:opacity-80"
            >
              {menteeCount} {menteeCount === 1 ? "mentee" : "mentees"} without a
              mentor
            </button>
          )}
          {menteeCount > 0 && projectCount > 0 && " · "}
          {projectCount > 0 && (
            <button
              type="button"
              onClick={onFixProjects}
              className="font-medium underline underline-offset-2 hover:opacity-80"
            >
              {projectCount} {projectCount === 1 ? "project" : "projects"}{" "}
              without a PM
            </button>
          )}
          . Reassign to resolve.
        </p>
      </div>
    </div>
  );
}
