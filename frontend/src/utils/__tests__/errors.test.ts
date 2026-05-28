import { describe, it, expect } from "vitest";

import { getErrorMessage } from "../errors";

describe("getErrorMessage", () => {
  it("returns the API detail when the shape matches an Axios error", () => {
    const err = {
      response: { data: { detail: "Goal submission window is closed." } },
    };
    expect(getErrorMessage(err)).toBe("Goal submission window is closed.");
  });

  it("returns the generic fallback when response is missing", () => {
    expect(getErrorMessage(new Error("network down"))).toBe(
      "An unexpected error occurred. Please try again.",
    );
  });

  it("returns the fallback when response.data.detail is not a string", () => {
    const err = { response: { data: { detail: { nested: "object" } } } };
    expect(getErrorMessage(err)).toBe(
      "An unexpected error occurred. Please try again.",
    );
  });

  it("returns the fallback for null input without throwing", () => {
    expect(getErrorMessage(null)).toBe(
      "An unexpected error occurred. Please try again.",
    );
  });

  it("returns the fallback for primitive inputs", () => {
    expect(getErrorMessage("oops")).toBe(
      "An unexpected error occurred. Please try again.",
    );
    expect(getErrorMessage(42)).toBe(
      "An unexpected error occurred. Please try again.",
    );
  });
});
