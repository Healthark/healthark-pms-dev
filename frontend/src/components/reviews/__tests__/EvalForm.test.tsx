/**
 * EvalForm re-seed behaviour — the core of the mentor draft-save fix.
 *
 * Saving a draft invalidates ['mentees'], so the freshly-persisted draft
 * flows back into the open form via a new `review` prop (same id, updated
 * draft fields). The form must NOT reset local edits on that — reseeding only
 * happens when the review identity (id) changes (switching mentee / FY).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EvalForm } from "../EvalForm";
import type { MenteeAnnualReview } from "../../../services/annual-review.service";

void React;

const review = (over: Partial<MenteeAnnualReview>): MenteeAnnualReview =>
  ({
    id: 1,
    employee_name: "Mentee One",
    cycle_name: "FY26-27",
    self_overall_review: "Self text",
    mentor_overall_review_draft: null,
    mentor_performance_rating_draft: null,
    ...over,
  }) as unknown as MenteeAnnualReview;

function renderForm(r: MenteeAnnualReview) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <EvalForm
        review={r}
        onSubmit={vi.fn()}
        onSaveDraft={vi.fn()}
        onClose={vi.fn()}
        isSaving={false}
        error=""
      />
    </QueryClientProvider>,
  );
  const rerender = (next: MenteeAnnualReview) =>
    utils.rerender(
      <QueryClientProvider client={qc}>
        <EvalForm
          review={next}
          onSubmit={vi.fn()}
          onSaveDraft={vi.fn()}
          onClose={vi.fn()}
          isSaving={false}
          error=""
        />
      </QueryClientProvider>,
    );
  return { rerender };
}

const textarea = () =>
  screen.getByLabelText(/Your Overall Review/i) as HTMLTextAreaElement;

describe("EvalForm re-seeding", () => {
  beforeEach(() => vi.clearAllMocks());

  it("seeds the textarea from the persisted draft on mount", () => {
    renderForm(review({ id: 1, mentor_overall_review_draft: "Saved draft" }));
    expect(textarea().value).toBe("Saved draft");
  });

  it("does NOT clobber in-progress edits when the SAME review's draft updates in cache", () => {
    const { rerender } = renderForm(
      review({ id: 1, mentor_overall_review_draft: "old" }),
    );
    // Mentor keeps typing past what was last autosaved.
    fireEvent.change(textarea(), { target: { value: "still typing more…" } });
    expect(textarea().value).toBe("still typing more…");

    // A save (autosave of an earlier value) flows back through the cache:
    // SAME review id, but the draft field now holds a *different* server value.
    // The old code keyed the reseed on the draft fields and would clobber the
    // live edit back to "autosaved earlier"; keyed on id, it must not.
    rerender(
      review({ id: 1, mentor_overall_review_draft: "autosaved earlier" }),
    );
    expect(textarea().value).toBe("still typing more…");
  });

  it("reseeds when switching to a DIFFERENT review (id change)", () => {
    const { rerender } = renderForm(
      review({ id: 1, mentor_overall_review_draft: "review one draft" }),
    );
    expect(textarea().value).toBe("review one draft");

    rerender(review({ id: 2, mentor_overall_review_draft: "review two draft" }));
    expect(textarea().value).toBe("review two draft");
  });
});
