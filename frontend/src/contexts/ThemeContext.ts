/**
 * ThemeContext.ts — Raw Context Object & TypeScript Interface.
 *
 * Three-File Rule (Step 1 of 3):
 *   No JSX here. Provider lives in ThemeProvider.tsx, consumer hook in
 *   ../hooks/useTheme.ts. The .ts (not .tsx) extension keeps Vite Fast
 *   Refresh's one-component-per-file rule happy.
 */

import { createContext } from "react";

export type Theme = "light" | "dark";

export interface ThemeContextType {
  /** Current resolved theme. Drives the `.dark` class on `<html>`. */
  theme: Theme;
  /** Explicit setter — persists to localStorage. */
  setTheme: (next: Theme) => void;
  /** Convenience flipper for the topbar toggle button. */
  toggleTheme: () => void;
}

/**
 * Default sentinel is `undefined` so the useTheme hook can throw a clear
 * dev-time error if consumed outside `<ThemeProvider>`.
 */
export const ThemeContext = createContext<ThemeContextType | undefined>(
  undefined,
);
