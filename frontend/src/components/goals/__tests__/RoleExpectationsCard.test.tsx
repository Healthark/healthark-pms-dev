/**
 * Tests for the shared "Your Role Expectations" card — the single source of
 * truth rendered on the Annual Goals page and inside the Goal Self-Review
 * modal. Covers: null guard, collapse/expand, bullet formatting of the stored
 * " | " separators, the dept · designation footer, custom title, and empty
 * fields being skipped.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  RoleExpectationsCard,
  type RoleExpectationCardData,
} from "../RoleExpectationsCard";

void React;

const data: RoleExpectationCardData = {
  department_name: "Engineering",
  designation_name: "Senior Analyst",
  exp_firm_growth: "Own a workstream | Mentor one junior",
  exp_competency_skills: "Deepen SQL | Learn React",
};

describe("RoleExpectationsCard", () => {
  it("renders nothing when no expectation is provided", () => {
    const { container } = render(<RoleExpectationsCard expectation={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("defaults to the collapsed state with the default title", () => {
    render(<RoleExpectationsCard expectation={data} />);
    expect(
      screen.getByRole("button", { name: /your role expectations/i }),
    ).toBeInTheDocument();
    // Body is collapsed — competency text is not in the DOM yet.
    expect(screen.queryByText("Firm Growth")).not.toBeInTheDocument();
  });

  it("expands to show both competencies, bullet-formatted, with the dept footer", async () => {
    const user = userEvent.setup();
    render(<RoleExpectationsCard expectation={data} />);
    await user.click(screen.getByRole("button", { name: /your role expectations/i }));

    expect(screen.getByText("Firm Growth")).toBeInTheDocument();
    expect(screen.getByText("Competency & Skills")).toBeInTheDocument();
    // " | " becomes a newline + bullet (RTL normalizes the newline to a space).
    expect(
      screen.getByText(/Own a workstream\s*•\s*Mentor one junior/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Engineering · Senior Analyst"),
    ).toBeInTheDocument();
  });

  it("honours a custom title and defaultOpen", () => {
    render(
      <RoleExpectationsCard
        expectation={data}
        title="Asha's Role Expectations"
        defaultOpen
      />,
    );
    expect(
      screen.getByRole("button", { name: /asha's role expectations/i }),
    ).toBeInTheDocument();
    // defaultOpen → body rendered immediately.
    expect(screen.getByText("Firm Growth")).toBeInTheDocument();
  });

  it("skips a competency whose text is empty", async () => {
    const user = userEvent.setup();
    render(
      <RoleExpectationsCard
        expectation={{ ...data, exp_competency_skills: null }}
        defaultOpen
      />,
    );
    expect(screen.getByText("Firm Growth")).toBeInTheDocument();
    expect(screen.queryByText("Competency & Skills")).not.toBeInTheDocument();
    void user;
  });
});
