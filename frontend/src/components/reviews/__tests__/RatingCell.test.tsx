/**
 * RatingCell resolves a rating to one of three states. The key regression this
 * guards: a rating that is null *because a visibility toggle is off*
 * (`hiddenWhenEmpty`) must read "Hidden", NOT "Not rated yet" — the bug the
 * mentor Team Review tab's Management Rating column had.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { RatingCell } from "../RatingCell";

void React;

describe("RatingCell", () => {
  it("shows the rating badge when a value is present (regardless of hiddenWhenEmpty)", () => {
    render(<RatingCell value={3} hiddenWhenEmpty />);
    expect(screen.getByTitle("Performance rating: 3")).toBeInTheDocument();
    expect(screen.queryByText(/Hidden/)).toBeNull();
    expect(screen.queryByText(/Not rated yet/)).toBeNull();
  });

  it('shows "Hidden" when value is null AND the rating is withheld by a toggle', () => {
    render(<RatingCell value={null} hiddenWhenEmpty />);
    expect(screen.getByText("Hidden")).toBeInTheDocument();
    expect(screen.queryByText(/Not rated yet/)).toBeNull();
  });

  it('shows "Not rated yet" when value is null and NOT withheld (genuinely unrated)', () => {
    render(<RatingCell value={null} hiddenWhenEmpty={false} />);
    expect(screen.getByText("Not rated yet")).toBeInTheDocument();
    expect(screen.queryByText("Hidden")).toBeNull();
  });

  it('defaults to "Not rated yet" (not Hidden) when hiddenWhenEmpty is omitted', () => {
    render(<RatingCell value={null} />);
    expect(screen.getByText("Not rated yet")).toBeInTheDocument();
  });
});
