/**
 * Tests for the optional remarks field on the Give Feedback form:
 * submit mode shows an editable textarea + live counter and threads the
 * trimmed remark into the submit payload; read-only mode shows the
 * previously-submitted note as static text.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
const navigate = vi.fn();

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "42" }),
  useNavigate: () => navigate,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const useFeedbackQuestions = vi.fn();
const useFeedbackMyReview = vi.fn();
vi.mock("../queries/feedback360", () => ({
  useFeedbackQuestions: () => useFeedbackQuestions(),
  useFeedbackMyReview: () => useFeedbackMyReview(),
  useSubmitFeedback: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { FeedbackGive } from "./FeedbackGive";

void React;

const QUESTIONS = [
  { key: "collab", bucket: "Collaboration", text: "Works well with others", order: 1 },
];

const targetInfo = {
  user_id: 42,
  full_name: "Jordan Lee",
  designation_name: "Engineer",
  department_name: "Platform",
  worked_with: true,
};

beforeEach(() => {
  mutateAsync.mockClear();
  navigate.mockClear();
  useFeedbackQuestions.mockReturnValue({ data: QUESTIONS, isPending: false, error: null });
});

describe("FeedbackGive — remarks", () => {
  it("submits the trimmed remark alongside ratings", async () => {
    useFeedbackMyReview.mockReturnValue({
      data: { target: targetInfo, fy_year: 2026, ratings: null, remarks: null },
      isPending: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<FeedbackGive />);

    // Rate the one question so submit is enabled.
    await user.click(screen.getByRole("button", { name: "Rate 4" }));

    const textarea = screen.getByPlaceholderText(/optional note/i);
    await user.type(textarea, "  Strong mentor  ");

    await user.click(screen.getByRole("button", { name: /Submit Feedback/i }));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload.target_user_id).toBe(42);
    expect(payload.remarks).toBe("Strong mentor");
  });

  it("sends null remarks when the field is left blank", async () => {
    useFeedbackMyReview.mockReturnValue({
      data: { target: targetInfo, fy_year: 2026, ratings: null, remarks: null },
      isPending: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<FeedbackGive />);

    await user.click(screen.getByRole("button", { name: "Rate 4" }));

    await user.click(screen.getByRole("button", { name: /Submit Feedback/i }));

    expect(mutateAsync.mock.calls[0][0].remarks).toBeNull();
  });

  it("shows the submitted remark as read-only text once a review exists", () => {
    useFeedbackMyReview.mockReturnValue({
      data: {
        target: targetInfo,
        fy_year: 2026,
        ratings: { collab: 4 },
        remarks: "Already submitted note.",
      },
      isPending: false,
      error: null,
    });
    render(<FeedbackGive />);

    expect(screen.getByText("Your remarks")).toBeInTheDocument();
    expect(screen.getByText("Already submitted note.")).toBeInTheDocument();
    // No editable textarea in read-only mode.
    expect(screen.queryByPlaceholderText(/optional note/i)).not.toBeInTheDocument();
  });
});
