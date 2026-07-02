import { describe, it, expect } from "vitest";

import { isSafeHttpUrl } from "../url";

describe("isSafeHttpUrl", () => {
  it("accepts ordinary http(s) reference links", () => {
    expect(isSafeHttpUrl("https://drive.google.com/drive/folders/abc")).toBe(true);
    expect(isSafeHttpUrl("http://example.com/report.pdf")).toBe(true);
    expect(isSafeHttpUrl("https://healthark.sharepoint.com/sites/x")).toBe(true);
    expect(isSafeHttpUrl("  https://drive.google.com/x  ")).toBe(true); // trimmed
  });

  it("rejects javascript: and other XSS-bearing schemes", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("  javascript:alert(document.cookie)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHttpUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeHttpUrl("ftp://example.com/x")).toBe(false);
    expect(isSafeHttpUrl("mailto:a@b.com")).toBe(false);
  });

  it("rejects relative / protocol-relative / malformed input", () => {
    expect(isSafeHttpUrl("//evil.example.com")).toBe(false);
    expect(isSafeHttpUrl("/goals/123")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
  });

  it("rejects empty / nullish values", () => {
    expect(isSafeHttpUrl("")).toBe(false);
    expect(isSafeHttpUrl("   ")).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
  });
});
