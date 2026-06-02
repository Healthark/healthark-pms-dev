# 26 — Annual Review notifications (PR 3)

## Context

PR 1 shipped the notification platform; PR 2 wired the Goals module. This PR
wires the **Annual Reviews** 3-stage appraisal into it, so each handoff in the
`DRAFT → PENDING_MENTOR → PENDING_MANAGEMENT → COMPLETED` lifecycle produces a
stored notification. Additive; no schema/migration change.

## What changed

### Backend — hooks in `app/api/routes/annual_review_routes.py`

Notifications are added on the endpoint's session (atomic with the business
write); email via `BackgroundTasks`, gated by `is_smtp_configured()`.

| Stage transition                             | Endpoint                        | → Recipient     | Channel        |
| -------------------------------------------- | ------------------------------- | --------------- | -------------- |
| Self-review submitted → `PENDING_MENTOR`     | `POST /self`                    | review's mentor | in-app         |
| Mentor eval submitted → `PENDING_MANAGEMENT` | `PATCH /{id}/mentor-eval`       | **employee**    | in-app + email |
| Management rating published → `COMPLETED`    | `PATCH /{id}/management-rating` | employee        | in-app         |

- **Self-review** notifies `review.mentor_id` (the row's mentor, so a draft
  submitted after reassignment still routes correctly); no-op if the review has
  no mentor. Both branches (promote-draft / fresh-row) fire it.
- **Mentor eval** notifies the employee with a **generic body** — the mentor's
  rating/review text is deliberately NOT included (the mentee can't see it yet).
- **Management rating** notifies the employee on **every publish** — including a
  re-publish that adjusts the rating on an already-`COMPLETED` row, so the
  employee always learns of a change. The body carries **no rating value** —
  visibility of the number is still governed by the per-FY
  `annual_review_final_rating_visible` gate.

### Frontend

- `AnnualReviews` now derives its active tab from the URL (`?tab=my|team`),
  mirroring the Annual Goals page — so the mentor's "self-review submitted"
  notification can deep-link straight to the **Team** tab. Team is mentor-only,
  so `tab=team` falls back to My Review for non-mentors.

## Tests

- **`backend/tests/test_annual_review_notifications.py`** (4 cases) — call the
  route functions directly against in-memory SQLite with an open review window:
  self-review → mentor (and a no-mentor → no-notification case); mentor-eval
  → employee (asserts the mentor's review text isn't leaked); management rating
  → employee once (exact generic body; re-publish sends no second notice).

## Notes

- Deep-links: employee-facing notices → `/annual-reviews` (defaults to My
  Review); mentor-facing → `/annual-reviews?tab=team`.
- Email best-effort + gated; unconfigured envs log a skip.
