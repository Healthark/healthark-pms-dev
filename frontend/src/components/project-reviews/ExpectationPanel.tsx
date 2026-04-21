import { useState } from "react";
import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import type { RoleExpectation } from "../../services/project-review.service";

/**
 * Collapsible panel that surfaces the role-expectation text for one
 * competency. Used inside evaluation modals so the PM can cross-check
 * against the department/designation's canonical expectations.
 */
export function ExpectationPanel({
  expectation,
  expKey,
}: {
  readonly expectation: RoleExpectation | null;
  readonly expKey: string;
}) {
  const [open, setOpen] = useState(false);
  if (!expectation) return null;
  const text = (expectation as Record<string, unknown>)[expKey] as string | null;
  if (!text) return null;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors"
      >
        <BookOpen className="h-3 w-3" />
        {open ? "Hide" : "View"} Role Expectations
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
          <p className="text-xs text-blue-800 whitespace-pre-wrap leading-relaxed">
            {text.replace(/ \| /g, "\n• ")}
          </p>
          <p className="mt-1 text-[10px] text-blue-500">
            {expectation.department_name} / {expectation.designation_name}
          </p>
        </div>
      )}
    </div>
  );
}
