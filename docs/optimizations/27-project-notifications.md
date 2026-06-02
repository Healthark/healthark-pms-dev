# 27 — Project Review notifications (PR 4)

## Context

Continues the notification rollout (PR 1 platform → PR 2 Goals → PR 3 Annual
Reviews). This PR wires the **Projects** module: members learn when they're
added to a project and when a project they're on is completed. Additive; no
schema/migration change.

## What changed

### Backend — hooks in `app/api/routes/project_routes.py`
Notifications are added on the endpoint's session (atomic with the business
write); email via `BackgroundTasks`, gated by `is_smtp_configured()`.

| Event | Endpoint | → Recipient | Channel |
|---|---|---|---|
| Added to a project | `POST /{id}/assignments` | the assigned member | in-app + email |
| Project created with a team | `POST /` | each initial member | in-app + email |
| Project completed | `POST /{id}/complete` | the whole team | in-app + email |

- **`add_assignment`** notifies the single new member.
- **`create_project`** fans out to every initial `ProjectAssignment` member
  (PM included). Members are resolved from `project_in.assignments`.
- **`complete_project`** broadcasts to the team **only on the active→completed
  transition** (re-completing an already-completed project is a no-op above, so
  no duplicate notice). Team is resolved via the new
  `project_team_users(db, org_id, project_id)` service helper.
- All deep-link to `/project-reviews`.

### Service
- New `project_team_users()` resolver in `app/services/notifications.py`
  (distinct active users with a `ProjectAssignment` on the project).

## Channel note
The plan listed these as "email"; in practice they're **in-app + email** — the
platform always writes the in-app row (the source of truth) and email is the
emphasized secondary channel, gated by `is_smtp_configured()`. So recipients
both see a bell entry and get an email; unconfigured envs just log a skip.

## Tests
- **`backend/tests/test_project_notifications.py`** (3 cases): add-assignment →
  the member; create-project → every initial member; complete-project → the
  team, fired once (re-complete sends nothing).
