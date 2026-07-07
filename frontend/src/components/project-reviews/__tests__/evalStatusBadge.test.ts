/**
 * getEvalStatusBadge encodes the Evaluate Team status flow:
 *   Pending → Draft → PM Reviewed → Completed
 * with a role-dependent terminal (PM/reports-to → "PM Reviewed", secondary →
 * "Completed") and a secondary-only intermediate "PM Reviewed" (blue/awaiting)
 * once the PM's evaluation lands but the secondary hasn't submitted.
 *
 * `key` is the filter bucket — asserted here so the Status filter and the
 * rendered badge can never drift apart (both PM-Reviewed variants → pm_reviewed).
 */
import { describe, it, expect } from "vitest";
import {
  getEvalStatusBadge,
  type EvalStatusInput,
} from "../evalStatusBadge";

const base: EvalStatusInput = {
  type: "primary",
  review_status: "pending",
  has_draft_content: false,
  pm_submitted: false,
};

describe("getEvalStatusBadge — terminal states", () => {
  it("primary 'reviewed' → PM Reviewed (done)", () => {
    expect(getEvalStatusBadge({ ...base, review_status: "reviewed" })).toEqual({
      label: "PM Reviewed",
      tone: "done",
      key: "pm_reviewed",
    });
  });

  it("reports_to 'reviewed' → PM Reviewed (done)", () => {
    expect(
      getEvalStatusBadge({ ...base, type: "reports_to", review_status: "reviewed" }),
    ).toEqual({ label: "PM Reviewed", tone: "done", key: "pm_reviewed" });
  });

  it("secondary 'submitted' → Completed (done)", () => {
    expect(
      getEvalStatusBadge({ ...base, type: "secondary", review_status: "submitted" }),
    ).toEqual({ label: "Completed", tone: "done", key: "completed" });
  });
});

describe("getEvalStatusBadge — in-progress states", () => {
  it("a saved draft → Draft, for any role", () => {
    for (const type of ["primary", "reports_to", "secondary"] as const) {
      expect(
        getEvalStatusBadge({ ...base, type, has_draft_content: true }),
      ).toEqual({ label: "Draft", tone: "draft", key: "draft" });
    }
  });

  it("secondary pending with the PM's eval in → PM Reviewed (awaiting), never Pending", () => {
    expect(
      getEvalStatusBadge({ ...base, type: "secondary", pm_submitted: true }),
    ).toEqual({ label: "PM Reviewed", tone: "awaiting", key: "pm_reviewed" });
  });

  it("a secondary draft outranks the PM-reviewed intermediate", () => {
    // Draft is the most specific signal of the secondary's own progress.
    expect(
      getEvalStatusBadge({
        ...base,
        type: "secondary",
        has_draft_content: true,
        pm_submitted: true,
      }),
    ).toEqual({ label: "Draft", tone: "draft", key: "draft" });
  });

  it("plain pending (no draft, PM not in) → Pending", () => {
    expect(getEvalStatusBadge(base)).toEqual({
      label: "Pending",
      tone: "pending",
      key: "pending",
    });
    // A secondary whose PM hasn't submitted is still just Pending.
    expect(
      getEvalStatusBadge({ ...base, type: "secondary", pm_submitted: false }),
    ).toEqual({ label: "Pending", tone: "pending", key: "pending" });
  });

  it("pm_submitted only elevates secondary rows, not primary/reports_to", () => {
    // A primary/reports-to row never carries pm_submitted, but guard anyway.
    expect(
      getEvalStatusBadge({ ...base, type: "primary", pm_submitted: true }),
    ).toEqual({ label: "Pending", tone: "pending", key: "pending" });
  });
});

describe("getEvalStatusBadge — filter alignment", () => {
  it("both PM-Reviewed variants share the pm_reviewed filter key", () => {
    const primaryDone = getEvalStatusBadge({ ...base, review_status: "reviewed" });
    const secondaryAwaiting = getEvalStatusBadge({
      ...base,
      type: "secondary",
      pm_submitted: true,
    });
    expect(primaryDone.label).toBe("PM Reviewed");
    expect(secondaryAwaiting.label).toBe("PM Reviewed");
    expect(primaryDone.key).toBe("pm_reviewed");
    expect(secondaryAwaiting.key).toBe("pm_reviewed");
  });
});
