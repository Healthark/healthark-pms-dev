import { describe, it, expect } from "vitest";

import { generateFyOptions } from "../ManagementTab";

// Project reviews are FY-scoped, so the admin Year filter lists fiscal
// years (newest first) rather than H1/H2/Q* windows.
describe("generateFyOptions", () => {
  it("lists the active FY plus prior years, newest first", () => {
    expect(generateFyOptions("FY26-27", 4)).toEqual([
      "FY26-27",
      "FY25-26",
      "FY24-25",
      "FY23-24",
    ]);
  });

  it("defaults to six years", () => {
    expect(generateFyOptions("FY26-27")).toHaveLength(6);
  });

  it("wraps the two-digit year cleanly across the century boundary", () => {
    // FY00-01 → previous year is FY99-00, not FY-1.
    expect(generateFyOptions("FY00-01", 2)).toEqual(["FY00-01", "FY99-00"]);
  });

  it("tolerates the legacy bare FY form", () => {
    expect(generateFyOptions("FY26", 3)).toEqual(["FY26", "FY25", "FY24"]);
  });

  it("offers the token alone when it is unparseable", () => {
    expect(generateFyOptions("weird")).toEqual(["weird"]);
  });
});
