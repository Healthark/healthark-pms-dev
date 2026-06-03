# 30 — Formal, snapshot-style notification emails (PR B)

## Context

Every module email (welcome/reset aside) rendered through one **generic**
`title + body + CTA` template, so notices like "added to a project" or "goal
approved" read like terse system blips. This PR redesigns **5 emails** into
formal messages with a greeting, a lead paragraph, a labelled **"Snapshot"
key-value block**, a CTA button, and the standard automated-message footer —
without touching the in-app rows (those stay a clean title + short body).
Companion to the UI/retention work in note 29.

## What changed

### Email template — `app/services/send_email.py`
`send_notification_email` (and `_notification_html` / `_notification_text`) gain
optional keyword fields — all back-compatible (omit them → original generic
look):
- `subject` — overrides the Subject header **and** the H1 (defaults to `title`).
- `recipient_name` — renders a "Hi {name}," greeting.
- `intro` — the lead paragraph (falls back to `body`).
- `details: list[tuple[str, str]]` + `snapshot_title` — a labelled key-value
  table rendered between the intro and the CTA.
All interpolations stay `_esc()`-escaped (HTML-injection safe).

### Service threading — `app/services/notifications.py`
`create_notification` and `broadcast_notification` forward the new
`email_subject` / `email_intro` / `email_details` / `snapshot_title` (and the
existing `recipient_name`) to the email layer; the in-app row ignores them. The
batch worker `_send_batch_emails` now takes `(email, name)` pairs so a fan-out
email still greets each recipient by name while sharing one subject/intro/
details block.

### The 5 redesigned emails (one hook each)
| Email | Hook | Snapshot |
|---|---|---|
| You have been added to: {project} | `project_routes.add_assignment` | Project Manager, Timeline |
| Project Completed: {project} | `project_routes.complete_project` | Project Manager, Completed On, Team Members (first 4 + "+N others") |
| Mentor Evaluation Submitted: {submitter} ({cycle}) | `annual_review_routes` mentor-eval | Submitted By, Review Cycle, Submitted On, Status |
| Reminder: Complete your self-review for {review} | `goal_routes.remind_goal_self_review` | Review Name, Reminded By, Status |
| Goal Approved: {goal} | `goal_routes.approve_goal` (approved branch) | Goal Name, Approved By, Approved On, Status |

New `project_routes` helpers `_format_date` / `_format_timeline` / `_format_team`
format the dates and the "first 4 + N others" team line. Dates render as
`%b %d, %Y`. Other emails (mentor-reassign, settings-toggle, admin broadcast,
goal mentor-review, etc.) keep the generic look automatically.

## Tests
- **`backend/tests/test_notification_emails.py`** (7): greeting + intro +
  snapshot + footer render; text fallback mirrors the snapshot; `_esc`
  neutralizes an injected `<img onerror=…>` name; generic back-compat with no
  formal fields; `_format_team` "+N others" truncation; date/timeline `None`
  handling. (Tests the pure builders directly — `send_notification_email` would
  hand a real message to SMTP, which is configured in this env.)
- Existing `test_project_notifications` / `test_admin_notifications` /
  `test_goal_notifications` still green — they assert in-app rows, unaffected.

## Verification
- Backend: `pytest -q` → 71 passed; new test ruff-clean; route imports OK.
