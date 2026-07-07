/**
 * AutoGrowTextarea — a controlled <textarea> that resizes to fit its content
 * so long reviews never sit behind an inner scrollbar or spill past their
 * container.
 *
 * How it grows:
 *   - `minRows` sets the starting height (mirrors the old `rows={n}` look).
 *   - On every value change (and on mount / window resize) the height is reset
 *     to `auto` then set to `scrollHeight`, so the box tracks the content
 *     exactly — growing as the user types and shrinking when text is removed.
 *   - `maxRows` caps the growth; past it the textarea keeps its height and
 *     scrolls internally, so a pathologically long entry can't blow the
 *     surrounding modal/layout apart.
 *
 * It forwards every native <textarea> prop (value, onChange, id, placeholder,
 * disabled, aria-*, …), so it's a drop-in replacement for a plain textarea.
 * `resize-none` is applied because the height is managed programmatically.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";

type NativeTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "rows" | "style"
>;

export interface AutoGrowTextareaProps extends NativeTextareaProps {
  /** Height floor, in text rows. Defaults to 3. */
  readonly minRows?: number;
  /** Height ceiling, in text rows, past which the box scrolls internally.
   *  Defaults to 24 (~a screenful) so extreme input can't break the layout. */
  readonly maxRows?: number;
  /** Extra classes merged after the shared textarea styling. */
  readonly className?: string;
}

// Fallback line height (px) used only until the element is measured — the
// real per-element line height is read from computed styles on resize.
const FALLBACK_LINE_HEIGHT = 20;

export const AutoGrowTextarea = forwardRef<
  HTMLTextAreaElement,
  AutoGrowTextareaProps
>(function AutoGrowTextarea(
  { minRows = 3, maxRows = 24, className = "", value, onChange, ...rest },
  forwardedRef,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  // Expose the DOM node to a forwarded ref while keeping our own handle.
  useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement);

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;

    const styles = window.getComputedStyle(el);
    // getComputedStyle can return "" (jsdom) or "normal" (lineHeight) — coerce
    // any non-finite parse to 0 so the height math never yields NaN.
    const px = (v: string): number => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const lineHeight = px(styles.lineHeight) || FALLBACK_LINE_HEIGHT;
    const paddingY = px(styles.paddingTop) + px(styles.paddingBottom);
    const borderY = px(styles.borderTopWidth) + px(styles.borderBottomWidth);
    const verticalChrome = paddingY + borderY;

    const minHeight = minRows * lineHeight + verticalChrome;
    const maxHeight = maxRows * lineHeight + verticalChrome;

    // Reset to auto first so scrollHeight reflects the true content height
    // (not the previously-set larger height) when text is deleted.
    el.style.height = "auto";
    const next = Math.max(minHeight, Math.min(el.scrollHeight, maxHeight));
    el.style.height = `${next}px`;
    // Only show the inner scrollbar once we've hit the cap.
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [minRows, maxRows]);

  // Resize synchronously after each render that changes the value, so the box
  // is correctly sized before paint (no visible one-frame jump).
  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  // Re-measure on viewport width changes — wrapping changes the line count.
  useEffect(() => {
    const handler = () => resize();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [resize]);

  return (
    <textarea
      ref={innerRef}
      value={value}
      onChange={(e) => {
        onChange?.(e);
        resize();
      }}
      rows={minRows}
      className={`resize-none ${className}`}
      {...rest}
    />
  );
});
