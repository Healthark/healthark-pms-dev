/**
 * AttachmentLink is the single render-time XSS guard for goal reference links.
 * A safe http(s) URL becomes a clickable anchor; anything else (e.g. a legacy
 * javascript: payload) must NEVER be emitted as an href.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import AttachmentLink from "../AttachmentLink";

void React;

describe("AttachmentLink", () => {
  it("renders a clickable link for a safe https URL", () => {
    render(<AttachmentLink url="https://drive.google.com/drive/folders/abc" />);
    const link = screen.getByRole("link", { name: /attachment/i });
    expect(link).toHaveAttribute("href", "https://drive.google.com/drive/folders/abc");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("does NOT emit an anchor/href for a javascript: URL", () => {
    render(<AttachmentLink url="javascript:alert(document.cookie)" />);
    // No anchor at all — the dangerous scheme can never reach an href.
    expect(screen.queryByRole("link")).toBeNull();
    // The value is shown as inert text, not a live link.
    expect(screen.getByText(/link hidden/i)).toBeInTheDocument();
  });

  it("does NOT emit an anchor for data: / other unsafe schemes", () => {
    render(<AttachmentLink url="data:text/html,<script>alert(1)</script>" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing when url is empty/nullish", () => {
    const { container } = render(<AttachmentLink url={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
