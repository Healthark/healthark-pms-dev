# 34 — Admin Panel minor changes (combined)

Running batch of small Admin-Panel UX fixes collected on one branch
(`fix/admin-panel-minor`) for a single combined PR. New entries are appended as
they land.

## ProjectModal (Add / Edit Project) — team members

### Multiple PM selection with submit-time validation
Previously the form hard-blocked ticking a second PM and refused to remove a PM,
so an admin couldn't set a new PM (the backend rejects a 2nd Primary, and
removing the Primary, on each individual API call). Now:
- The per-member **PM** checkbox no longer disables once a PM exists — multiple
  members can be ticked PM in the form (the only gate is "pick an employee
  first").
- A draft card marked PM can be removed freely (no "PM cannot be removed" block
  on drafts).
- On submit, if more than one PM is selected, saving is blocked and an **inline
  error** shows: *"A Project cannot have more than 1 PM."* Exactly-one and
  at-least-one are both enforced.
- This enables a **PM swap**: tick the new PM, clear the old one (uncheck via the
  pencil-edit of the existing PM row), then save — the existing save path already
  demotes the old Primary (PATCH → null) before promoting the new one, so the
  backend's single-Primary rule is never violated mid-save.

### New member card on top + drag-to-reorder
- "Add Member" now **prepends** a fresh card, and draft cards render **above** the
  existing read-only rows (via flexbox `order`), so the empty card to fill is at
  the top — no scrolling to the bottom.
- Each draft card has a **drag handle** (grip) and is **reorderable by mouse**
  (native HTML5 drag-and-drop). Ordering is a within-session arrangement (the
  backend has no assignment order field).

## Tests
- **`frontend/src/components/admin/__tests__/ProjectModal.test.tsx`** (2): a newly
  added card is prepended to the top; two PMs can be ticked but Create is disabled
  with the inline "more than 1 PM" error, which clears when one is unchecked.

## Verification
- Frontend `tsc` clean; eslint 0; `vitest` ProjectModal 2 passed.
