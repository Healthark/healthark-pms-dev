import { useContext } from "react";
import { ThemeContext, type ThemeContextType } from "../contexts/ThemeContext";

/**
 * Consumer hook for the theme context. Throws if used outside
 * `<ThemeProvider>` so misuse fails fast at dev time.
 */
export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error("useTheme must be used inside <ThemeProvider>.");
  }
  return ctx;
}
