# 32 — Scrollable announcement body + taller notification panel

## Context

Admin announcements can now run to ~100 words, but the notification panel
truncated each stored row's body to two lines (`line-clamp-2`), so longer
announcements were unreadable in the bell. This makes the body a self-contained
scroll area (scrollbar hidden) and gives the panel a little more height.

## What changed

- **`components/layout/NotificationPanel.tsx`**
  - The stored-row body moved **out of the row's nav `<button>`** into a sibling
    `<div>` and became a capped scroll area
    (`max-h-24 overflow-y-auto scrollbar-hide whitespace-pre-wrap`). A long
    announcement (~100 words) scrolls in place instead of inflating the row or
    being clamped. Moving it out of the button also matters because rows with no
    deep-link render a *disabled* button, which can swallow wheel events from a
    nested scroll area.
  - Panel height bumped from `50svh` to `calc(50svh + 3rem)` so roughly one more
    line/row is visible (still capped by the viewport via `maxHeight`).
- **`index.css`**: new opt-in `.scrollbar-hide` utility (Firefox
  `scrollbar-width:none`, WebKit `::-webkit-scrollbar{display:none}`, legacy
  `-ms-overflow-style:none`) — keeps an element scrollable with no visible bar.

## Tests
- **`NotificationPanel.test.tsx`** (8): added a case asserting the announcement
  body renders in an `overflow-y-auto scrollbar-hide` scroll area. Existing cases
  (heading/description/timestamp visible without a click, row-click navigation,
  tab switch, mark-read, mark-all, empty state) still pass.

## Verification
- Frontend `tsc` clean; eslint 0 problems; `vitest` NotificationPanel 8 passed.
