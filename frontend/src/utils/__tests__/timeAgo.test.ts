import { describe, it, expect } from "vitest";
import { timeAgo } from "../timeAgo";

// Fixed reference point so every case is deterministic.
const NOW = new Date("2026-06-03T12:00:00Z");

function ago(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

describe("timeAgo", () => {
  it("renders 'just now' under 45 seconds", () => {
    expect(timeAgo(ago(0), NOW)).toBe("just now");
    expect(timeAgo(ago(44), NOW)).toBe("just now");
  });

  it("renders minutes", () => {
    expect(timeAgo(ago(60), NOW)).toBe("1 min ago");
    expect(timeAgo(ago(5 * 60), NOW)).toBe("5 mins ago");
  });

  it("renders hours", () => {
    expect(timeAgo(ago(60 * 60), NOW)).toBe("1 hour ago");
    expect(timeAgo(ago(2 * 60 * 60), NOW)).toBe("2 hours ago");
  });

  it("distinguishes 1 day from 2 days", () => {
    expect(timeAgo(ago(24 * 60 * 60), NOW)).toBe("1 day ago");
    expect(timeAgo(ago(2 * 24 * 60 * 60), NOW)).toBe("2 days ago");
  });

  it("renders weeks", () => {
    expect(timeAgo(ago(7 * 24 * 60 * 60), NOW)).toBe("1 week ago");
    expect(timeAgo(ago(3 * 7 * 24 * 60 * 60), NOW)).toBe("3 weeks ago");
  });

  it("falls back to an absolute date past ~30 days", () => {
    const out = timeAgo(ago(45 * 24 * 60 * 60), NOW);
    expect(out).not.toMatch(/ago/);
    expect(out).toMatch(/2026/);
  });

  it("treats future / skewed timestamps as 'just now'", () => {
    expect(timeAgo(ago(-30), NOW)).toBe("just now");
  });

  it("returns empty string for an invalid date", () => {
    expect(timeAgo("not-a-date", NOW)).toBe("");
  });
});
