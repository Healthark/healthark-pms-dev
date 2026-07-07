/**
 * Pure-function tests for the Support helpers: the page→tab lookup and the
 * data-URI byte-length used to enforce the photo size cap client-side.
 */
import { describe, it, expect } from "vitest";
import { tabsForPage, PMS_PAGES } from "./supportOptions";
import { dataUriByteLength } from "./imageCompression";

describe("tabsForPage", () => {
  it("returns a page's real sub-tabs", () => {
    expect(tabsForPage("Annual Goals")).toEqual([
      "My Goals",
      "Team Goals",
      "All Goals",
    ]);
  });

  it("returns [] for a page with no sub-tabs", () => {
    expect(tabsForPage("Dashboard")).toEqual([]);
  });

  it("returns [] for an unknown page", () => {
    expect(tabsForPage("Nope")).toEqual([]);
  });

  it("includes an Other / General escape hatch", () => {
    expect(PMS_PAGES.some((p) => p.page === "Other / General")).toBe(true);
  });
});

describe("dataUriByteLength", () => {
  it("computes decoded bytes from base64 payload (with padding)", () => {
    // "hi" → "aGk=" (1 pad char) → 2 bytes.
    expect(dataUriByteLength("data:image/png;base64,aGk=")).toBe(2);
    // "hey" → "aGV5" (no padding) → 3 bytes.
    expect(dataUriByteLength("data:image/png;base64,aGV5")).toBe(3);
  });

  it("handles a bare base64 string without the data: prefix", () => {
    expect(dataUriByteLength("aGk=")).toBe(2);
  });
});
