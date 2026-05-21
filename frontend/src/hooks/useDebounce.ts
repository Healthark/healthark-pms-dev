import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a stable, debounced wrapper around `callback`.
 *
 * The wrapper identity never changes across re-renders, so it can be put
 * in effect dependency arrays without re-debouncing on every keystroke.
 * The latest `callback` is captured via a ref, so closures are never stale.
 *
 * Also returns a `cancel` for explicit dismiss flows (Cancel button,
 * submit-replacing-draft, route change, etc.) and auto-cancels on unmount.
 */
export function useDebounce<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  delayMs: number,
) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const debounced = useCallback(
    (...args: TArgs) => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        callbackRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );

  return [debounced, cancel] as const;
}
