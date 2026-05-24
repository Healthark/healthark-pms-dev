import { Sun, Moon } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";

/**
 * Icon button that flips light ↔ dark. Mounted in the Topbar.
 *
 * Icon convention — **show current mode**:
 *   - Light mode active → Sun icon (it's bright). Click → switches to dark.
 *   - Dark mode active  → Moon icon (it's night). Click → switches to light.
 *
 * Match the bell button's sizing/padding so they read as a single
 * "topbar action" row visually.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="p-2 text-text-muted hover:text-brand transition-colors rounded-full hover:bg-surface-muted"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <Moon className="w-5 h-5" aria-hidden="true" />
      ) : (
        <Sun className="w-5 h-5" aria-hidden="true" />
      )}
    </button>
  );
}
