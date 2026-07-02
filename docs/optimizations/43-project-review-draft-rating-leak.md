# 43 — Project review draft rating no longer leaks to the team member

## Context

On the **Project Reviews** page the PM (Primary evaluator) drafts a project
evaluation on the **Evaluate Team** tab before submitting it. The rated team
member sees their own reviews on the **My Reviews** tab, whose **Rating** column
should show a rating only once the PM has *completed* the evaluation.

The rule the product wants: a team member sees their project rating only when
**both** hold —

1. the PM has submitted the evaluation (`status == reviewed`), and
2. the admin has published ratings for the cycle (`project_ratings_visible`).

A PM's saved-but-unsubmitted **draft** rating was surfacing to the team member
as soon as an admin had "View ratings" enabled — before Evaluate was completed.

## Root cause

Two layers each checked only condition (2), never (1):

- **Backend** — `_visible_performance_group` (project_review_routes.py), the
  shared rating-visibility gate used by `GET /project-reviews/mine`, gated on FY
  + the per-half `project_ratings_visible` toggle but **never on review status**.
  So a `draft` row with a `performance_group` set was returned to the reviewee
  whenever the toggle was on. (`get_review` was already safe — it 403s the owner
  on a non-`reviewed` row — but the `/mine` list card path was not.)
- **Frontend** — `ProjectReviews.tsx`'s `renderRatingCell` rendered the badge
  whenever `projectRatingsVisible` was true, ignoring `card.review_status`.

The mentor's view (`get_mentee_projects`) already pre-gated on
`status == reviewed` (see `test_mentee_project_rating_visibility.py`); the
employee's own view had no equivalent guard.

## Fix

- **Backend (authoritative):** `_visible_performance_group` now returns `None`
  for any non-`reviewed` review unless the viewer is the rating's **author**
  (the PM writing it) or an **Admin**. A draft rating therefore never surfaces
  to the reviewee or their mentor — not even with the visibility toggle on —
  and this also closes a latent draft leak through `get_review` for a mentor.
  Behaviour for `reviewed` rows is unchanged.
- **Frontend (defense-in-depth + UX):** extracted the cell into
  `components/project-reviews/MyReviewRatingCell.tsx` with three
  mutually-exclusive states — not reviewed → em dash (regardless of toggle);
  reviewed + toggle off → **Hidden** (lock); reviewed + toggle on → the rating
  badge. A pending row now reads "—" instead of a misleading "Hidden".

## Tests

- `backend/tests/test_my_projects_rating_visibility.py` (5): draft rating hidden
  even when published (the leak); pending rating hidden; reviewed + published →
  visible; reviewed + not published → hidden; end-to-end draft→submit with the
  publish toggle on the whole time.
- `frontend/.../__tests__/MyReviewRatingCell.test.tsx` (4): draft hidden while
  published (the regression); pending → em dash regardless of toggle; reviewed +
  published → badge; reviewed + not published → "Hidden".

## Verification
- Backend: `pytest tests/` → **334 passed**.
- Frontend: `vitest run` → **152 passed** (32 files); `tsc -b --noEmit` clean;
  `eslint` clean on changed files.
