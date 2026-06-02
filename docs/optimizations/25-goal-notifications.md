# 25 — Goal notifications (PR 2)

## Context

PR 1 (`24-generic-notifications.md`) shipped the notification *platform* — a
generic `Notification` table, the `notify()` service, the email channel, and a
two-tab bell — but nothing wrote any rows yet. This PR wires the **Annual Goals**
module into it: the first module whose lifecycle now produces stored, per-user
notifications. It's purely additive on top of the platform.

## What changed

### Backend — hooks in `app/api/routes/goal_routes.py`
Each hook calls `create_notification(...)` on the endpoint's existing session
(atomic with the business write; email enqueued via `BackgroundTasks` and gated
by `is_smtp_configured()`):

| Event | Endpoint | Recipient | Channel |
|---|---|---|---|
| Goal approved | `PATCH /{id}/approve` (+ `POST /bulk-approve`) | goal owner | in-app + email |
| Changes requested | `PATCH /{id}/approve` | goal owner | in-app |
| Self-review submitted | `PATCH /{id}/self-review/{half}` | owner's **current** mentor | in-app |
| Mentor review submitted | `PATCH /{id}/mentor-review/{half}` | goal owner | in-app + email |
| **Self-review reminder** (NEW) | `POST /{id}/self-review-reminder` | mentee | in-app + email |

- The reminder is a **new manual endpoint**: mentor-only (caller must be the
  owner's assigned mentor), goal must be in a post-approval state (a self-review
  is only relevant once approved). Returns 204.
- Self-review-submitted notifies the owner's *current* `mentor_id` (not the
  goal's stamped `manager_id`) so a reassigned mentor gets it; skipped when the
  mentor is unassigned / soft-deleted.
- All goal notifications deep-link to `/annual-goals?tab=my` (owner-facing) or
  `?tab=team` (mentor-facing) — riding the deep-link nav from PR 1.

### Frontend
- `goal.service.ts` `remindSelfReview(goalId)` + `useRemindSelfReview()` mutation.
- A **"Remind"** button on approved team goals — both the table actions
  (`TeamGoalsTab`) and the card (`TeamGoalCard`, via an optional `onRemind`
  prop) — fires the reminder with a success toast.

## Tests
- **`backend/tests/test_goal_notifications.py`** (8 cases): calls the route
  functions directly against an in-memory SQLite session + a real
  `BackgroundTasks`, asserting the correct `Notification` rows for approve /
  changes-requested / bulk-approve / self-review-submitted / mentor-review-
  submitted, and the reminder's success + 403 (not the mentor) + 400
  (unapproved goal) paths.
- **`frontend/.../__tests__/TeamGoalCard.test.tsx`**: the Remind button renders
  for an approved goal and calls `onRemind`; absent when `onRemind` is omitted.

## Notes
- Email stays best-effort (gated by `is_smtp_configured()`), so unconfigured
  envs just log a skip — the in-app row is the source of truth.
- No schema/migration change — PR 1's `notifications` table already exists.
