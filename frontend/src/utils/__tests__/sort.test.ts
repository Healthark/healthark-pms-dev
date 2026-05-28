import { describe, it, expect } from "vitest";

import { compareValues, toggleSort } from "../sort";

describe("compareValues — alpha", () => {
  it("sorts case-insensitively ascending", () => {
    expect(compareValues("apple", "Banana", "alpha", "asc")).toBeLessThan(0);
    expect(compareValues("Banana", "apple", "alpha", "asc")).toBeGreaterThan(0);
  });

  it("flips for descending", () => {
    expect(compareValues("apple", "Banana", "alpha", "desc")).toBeGreaterThan(0);
  });
});

describe("compareValues — natural", () => {
  it("sorts PRJ-9 before PRJ-10 (not lexicographic)", () => {
    expect(compareValues("PRJ-9", "PRJ-10", "natural", "asc")).toBeLessThan(0);
  });
});

describe("compareValues — numeric", () => {
  it("sorts numeric strings as numbers", () => {
    expect(compareValues("2", "10", "numeric", "asc")).toBeLessThan(0);
  });

  it("non-numeric values sort to the end ascending", () => {
    expect(compareValues("foo", "1", "numeric", "asc")).toBeGreaterThan(0);
  });
});

describe("compareValues — cycle", () => {
  it("H2 FY25 sorts before H1 FY26 chronologically", () => {
    expect(compareValues("H2 FY25", "H1 FY26", "cycle", "asc")).toBeLessThan(0);
  });

  it("within the same FY, H1 sorts before H2", () => {
    expect(compareValues("H1 FY26", "H2 FY26", "cycle", "asc")).toBeLessThan(0);
  });

  it("quarterly cycles sort by period within FY", () => {
    expect(compareValues("Q4 FY25", "Q1 FY26", "cycle", "asc")).toBeLessThan(0);
  });
});

describe("compareValues — null handling", () => {
  it("nulls sort to the end regardless of direction", () => {
    expect(compareValues(null, "x", "alpha", "asc")).toBeGreaterThan(0);
    expect(compareValues(null, "x", "alpha", "desc")).toBeGreaterThan(0);
    expect(compareValues("x", null, "alpha", "asc")).toBeLessThan(0);
  });

  it("empty strings sort to the end like nulls", () => {
    expect(compareValues("", "x", "alpha", "asc")).toBeGreaterThan(0);
  });

  it("two nulls compare equal", () => {
    expect(compareValues(null, null, "alpha", "asc")).toBe(0);
  });
});

describe("toggleSort", () => {
  it("starts ascending on a fresh column", () => {
    expect(toggleSort(null, "name")).toEqual({ key: "name", direction: "asc" });
  });

  it("flips direction when the same column is re-clicked", () => {
    expect(toggleSort({ key: "name", direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "desc",
    });
    expect(toggleSort({ key: "name", direction: "desc" }, "name")).toEqual({
      key: "name",
      direction: "asc",
    });
  });

  it("switches to a new column ascending, ignoring previous direction", () => {
    expect(toggleSort({ key: "name", direction: "desc" }, "rating")).toEqual({
      key: "rating",
      direction: "asc",
    });
  });
});
