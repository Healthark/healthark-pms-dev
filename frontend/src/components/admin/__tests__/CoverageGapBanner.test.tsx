/**
 * Tests for the Admin-Panel coverage-gap warning banner: it renders only when
 * there are gaps, pluralizes counts, and its "Fix" links route to the right tab.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CoverageGapBanner } from "../CoverageGapBanner";

void React;

describe("CoverageGapBanner", () => {
  it("renders nothing when there are no gaps", () => {
    const { container } = render(
      <CoverageGapBanner
        menteeCount={0}
        projectCount={0}
        onFixMentees={vi.fn()}
        onFixProjects={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows both gap kinds with correct pluralization", () => {
    render(
      <CoverageGapBanner
        menteeCount={2}
        projectCount={1}
        onFixMentees={vi.fn()}
        onFixProjects={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2 mentees without a mentor/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 project without a PM/i })).toBeInTheDocument();
  });

  it("singularizes a single mentee", () => {
    render(
      <CoverageGapBanner
        menteeCount={1}
        projectCount={0}
        onFixMentees={vi.fn()}
        onFixProjects={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /1 mentee without a mentor/i })).toBeInTheDocument();
    expect(screen.queryByText(/without a PM/i)).not.toBeInTheDocument();
  });

  it("routes each fix link to its tab", async () => {
    const onFixMentees = vi.fn();
    const onFixProjects = vi.fn();
    const user = userEvent.setup();
    render(
      <CoverageGapBanner
        menteeCount={3}
        projectCount={2}
        onFixMentees={onFixMentees}
        onFixProjects={onFixProjects}
      />,
    );
    await user.click(screen.getByRole("button", { name: /mentees without a mentor/i }));
    await user.click(screen.getByRole("button", { name: /projects without a PM/i }));
    expect(onFixMentees).toHaveBeenCalledTimes(1);
    expect(onFixProjects).toHaveBeenCalledTimes(1);
  });
});
