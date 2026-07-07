import { useState } from "react";
import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";

/**
 * Collapsible panel that surfaces the role-expectation text for one
 * competency. Used inside the evaluation modal so the PM can cross-check
 * against the department/level's canonical expectations.
 *
 * The parent resolves the text (from the department/level expectations map,
 * keyed by competency id) and passes it in — this component just renders it.
 */
export function ExpectationPanel({
  text,
  deptName,
  desigName,
}: {
  readonly text: string | null;
  readonly deptName?: string | null;
  readonly desigName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!text) return null;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:text-blue-300 transition-colors"
      >
        <BookOpen className="h-3 w-3" />
        {open ? "Hide" : "View"} Role Expectations
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md bg-blue-50 dark:bg-blue-950/40 border border-blue-100 px-3 py-2">
          <p className="text-xs text-blue-800 dark:text-blue-300 whitespace-pre-wrap leading-relaxed">
            {text.replace(/ \| /g, "\n• ")}
          </p>
          {(deptName || desigName) && (
            <p className="mt-1 text-[10px] text-blue-500 dark:text-blue-400">
              {deptName} / {desigName}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
