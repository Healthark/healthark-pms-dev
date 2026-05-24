/**
 * ThemeProvider.tsx — Theme state + side effects.
 *
 * Behaviour:
 *   - First-mount default is the user's OS preference
 *     (`window.matchMedia('(prefers-color-scheme: dark)')`).
 *   - Any explicit toggle persists to `localStorage['ui_theme']` and that
 *     persisted value wins on subsequent loads.
 *   - When the user has NOT explicitly chosen a theme (no localStorage
 *     entry), live OS-preference changes still propagate. Once they've
 *     toggled at least once, the local choice sticks.
 *   - Side effect: toggles the `dark` class on `document.documentElement`,
 *     which both flips the CSS-variable values (see src/index.css `.dark
 *     {...}`) AND enables Tailwind v4's `dark:` utility variants.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ThemeContext, type Theme, type ThemeContextType } from "./ThemeContext";

const STORAGE_KEY = "ui_theme";

/** Read the stored override, if any. Defensive against bad localStorage. */
function readStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    /* localStorage disabled / blocked — fall through */
  }
  return null;
}

/** Read the current OS preference. */
function readSystemTheme(): Theme {
  if (typeof globalThis.matchMedia === "function") {
    return globalThis.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "light";
}

interface ThemeProviderProps {
  readonly children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // Track whether the user has made an explicit choice (separate from the
  // theme value itself). When false, OS-preference changes still propagate.
  const userOverrodeRef = useRef<boolean>(readStoredTheme() !== null);

  const [theme, setThemeState] = useState<Theme>(
    () => readStoredTheme() ?? readSystemTheme(),
  );

  // Apply the theme to the DOM whenever it changes.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  // Listen for OS-level changes — but only honor them if the user hasn't
  // explicitly chosen yet.
  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const mq = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      if (userOverrodeRef.current) return;
      setThemeState(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    userOverrodeRef.current = true;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* best-effort */
    }
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const value = useMemo<ThemeContextType>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
