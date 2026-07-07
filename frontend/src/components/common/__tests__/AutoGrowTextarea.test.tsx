/**
 * AutoGrowTextarea — sizes to content and caps growth.
 *
 * jsdom does no layout, so `scrollHeight` is 0 by default; we stub it on the
 * prototype to simulate tall content and assert the height/overflow response.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AutoGrowTextarea } from "../AutoGrowTextarea";

void React;

/** Stub scrollHeight on the textarea prototype for the duration of a test. */
function stubScrollHeight(px: number) {
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => px,
  });
}

afterEach(() => {
  // Remove the stub so a default (0) is restored between tests.
  // @ts-expect-error — deleting an own accessor added above.
  delete HTMLTextAreaElement.prototype.scrollHeight;
});

describe("AutoGrowTextarea", () => {
  it("forwards native props and starts at minRows with no inner scrollbar", () => {
    render(
      <AutoGrowTextarea
        id="grow"
        minRows={4}
        value="hi"
        onChange={() => {}}
        placeholder="type here"
      />,
    );
    const el = screen.getByPlaceholderText("type here") as HTMLTextAreaElement;
    expect(el.tagName).toBe("TEXTAREA");
    expect(el).toHaveAttribute("id", "grow");
    expect(el).toHaveAttribute("rows", "4");
    // Height is programmatically set (px), and short content does not scroll.
    expect(el.style.height).toMatch(/px$/);
    expect(el.style.overflowY).toBe("hidden");
  });

  it("caps at maxRows and scrolls internally when content exceeds the ceiling", () => {
    // 1000px of content, ceiling maxRows=5 × ~20px fallback line height = 100px.
    stubScrollHeight(1000);
    render(
      <AutoGrowTextarea
        minRows={2}
        maxRows={5}
        value="lots of text"
        onChange={() => {}}
        placeholder="capped"
      />,
    );
    const el = screen.getByPlaceholderText("capped") as HTMLTextAreaElement;
    const height = parseFloat(el.style.height);
    // Capped well below the 1000px content height.
    expect(height).toBeLessThan(1000);
    expect(height).toBeGreaterThan(0);
    // Past the cap → inner scrollbar appears.
    expect(el.style.overflowY).toBe("auto");
  });

  it("fires onChange with the typed value", async () => {
    const onChange = vi.fn();
    render(
      <AutoGrowTextarea value="" onChange={onChange} placeholder="editable" />,
    );
    const el = screen.getByPlaceholderText("editable");
    await userEvent.type(el, "x");
    expect(onChange).toHaveBeenCalled();
  });

  it("re-measures height when the value prop grows", () => {
    const { rerender } = render(
      <AutoGrowTextarea
        minRows={2}
        maxRows={40}
        value="short"
        onChange={() => {}}
        placeholder="reflow"
      />,
    );
    const el = screen.getByPlaceholderText("reflow") as HTMLTextAreaElement;

    // Simulate the content getting taller, then push a new value prop.
    stubScrollHeight(600);
    rerender(
      <AutoGrowTextarea
        minRows={2}
        maxRows={40}
        value={"a\n".repeat(30)}
        onChange={() => {}}
        placeholder="reflow"
      />,
    );
    fireEvent(window, new Event("resize"));
    expect(parseFloat(el.style.height)).toBeGreaterThan(100);
  });
});
