/**
 * useSaveMentorDraft must refresh BOTH cache domains on success:
 *   - ['annual-reviews'] (Team Review tab, calibration, etc.)
 *   - ['mentees']        (the eval form's review prop + Annual Summary pills)
 *
 * The reported bug: only ['annual-reviews'] was invalidated, so the
 * mentee-scoped cache went stale and the drawer showed the pre-save draft
 * until a hard refresh. This guards the regression.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const saveMentorDraft = vi.fn().mockResolvedValue({});
vi.mock("../../services/annual-review.service", () => ({
  annualReviewService: { saveMentorDraft: (...a: unknown[]) => saveMentorDraft(...a) },
}));

import { useSaveMentorDraft } from "../annualReviews";

void React;

function keysInvalidatedBy(spy: ReturnType<typeof vi.spyOn>): string[][] {
  return spy.mock.calls.map(
    ([arg]) => (arg as { queryKey: string[] }).queryKey,
  );
}

describe("useSaveMentorDraft", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invalidates both the annual-reviews and mentees caches on success", async () => {
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSaveMentorDraft(), { wrapper });

    await result.current.mutateAsync({
      reviewId: 7,
      payload: { mentor_overall_review: "draft text" },
    });

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    const keys = keysInvalidatedBy(invalidateSpy);
    expect(keys).toContainEqual(["annual-reviews"]);
    expect(keys).toContainEqual(["mentees"]);
  });
});
