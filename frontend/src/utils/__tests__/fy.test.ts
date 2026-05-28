import { describe, it, expect } from "vitest";

import {
  extractFyToken,
  formatFyLabel,
  formatFyYearSpan,
  fyTokenToStartYear,
} from "../fy";

describe("extractFyToken", () => {
  it("returns the bare FY token from a composite cycle name", () => {
    expect(extractFyToken("H1 FY26-27")).toBe("FY26-27");
    expect(extractFyToken("Q3 FY27-28")).toBe("FY27-28");
  });

  it("returns the input unchanged when already a bare FY token", () => {
    expect(extractFyToken("FY26-27")).toBe("FY26-27");
  });

  it("falls back to the input when no FY token is parseable", () => {
    expect(extractFyToken("Annual Goals 2026")).toBe("Annual Goals 2026");
  });
});

describe("formatFyLabel", () => {
  it("renders the spanning two-year form", () => {
    expect(formatFyLabel("FY26-27")).toBe("FY 2026-27");
    expect(formatFyLabel("H1 FY26-27")).toBe("FY 2026-27");
  });

  it("renders the legacy bare two-digit form", () => {
    expect(formatFyLabel("FY26")).toBe("FY 2026");
  });

  it("renders the legacy four-digit form", () => {
    expect(formatFyLabel("FY2026")).toBe("FY 2026");
  });

  it("returns the input when no FY token is parseable", () => {
    expect(formatFyLabel("Some weird label")).toBe("Some weird label");
  });
});

describe("formatFyYearSpan", () => {
  it("renders a start year as the spanning label", () => {
    expect(formatFyYearSpan(2026)).toBe("FY 2026-27");
  });

  it("wraps century boundary cleanly", () => {
    expect(formatFyYearSpan(1999)).toBe("FY 1999-00");
  });
});

describe("fyTokenToStartYear", () => {
  it("resolves the spanning form", () => {
    expect(fyTokenToStartYear("FY26-27")).toBe(2026);
    expect(fyTokenToStartYear("H1 FY26-27")).toBe(2026);
  });

  it("resolves legacy single-year forms", () => {
    expect(fyTokenToStartYear("FY26")).toBe(2026);
    expect(fyTokenToStartYear("FY2026")).toBe(2026);
  });

  it("returns null on unparseable input", () => {
    expect(fyTokenToStartYear("not a fiscal year")).toBeNull();
  });
});
