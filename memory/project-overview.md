---
name: project-overview
description: What Healthark PMS is, its stack, and deployment topology
metadata:
  type: project
---

Healthark PMS = multi-tenant SaaS Performance Management System. Architected multi-tenant (every table has `org_id`, every query filters on it, tenant fence in `get_current_user`) but deployed single-tenant today: org "Healthark", `org_id=1`.

**Stack:** Backend = FastAPI + SQLAlchemy (sync) + Alembic + Postgres, Python 3.12. Frontend = React 19 + Vite 8 + TS 6 + TanStack Query v5 + React Router 7 + Tailwind 4 + axios.

**Deployment:** Frontend on Vercel, backend on Render (cross-origin). Because of cross-origin, CSRF token is also returned in the login body and stored in `localStorage` (JS can't read the onrender.com cookie). Only frontend env var is `VITE_API_URL`. Backend requires `FEEDBACK_HASH_SECRET` or it won't boot.

**Feature areas** (gated per-org via `enabled_features` + per-route role checks): annual goals (OKR engine), annual reviews (3-stage: self→mentor→management), project reviews (PM-centric), competency framework, cryptographically-anonymous 360 feedback, mentoring hierarchy, notifications, Excel exports, support tickets, admin panel.

**Non-obvious architecture facts:**
- Two-tier gating: base `SystemSettings` columns are fallback; the real enforcement surface is `SystemSettingsYearOverride` rows (per-FY for annual-review flags, per-half for goal/project flags), default-deny. `GoalAccessOverride` layers per-employee exceptions.
- Cycle system is admin-advanced (stored `active_cycle_name`), NOT calendar-derived. Cadences: annual / half_yearly (H1/H2) / quarterly (Q1-Q4) share the same status columns. See [[fiscal-year-cycle-system]].
- Dynamic competency framework (Competency table + JSON maps on ProjectReview/RoleExpectation) is built + backfilled but NOT yet the live read/write path — fixed `exp_*`/`comment_*` columns still drive current flows.
- Roles: Admin / Manager / Practitioner / Staff, plus `is_management` sub-flag (always implies Admin) gating Management Review. Mentor relationship via self-referencing `User.mentor_id`.
