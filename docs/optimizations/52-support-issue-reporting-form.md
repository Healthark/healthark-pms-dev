# 52 — Support: in-app "Report an Issue" form + admin Responses queue

The **Support** sidebar item no longer opens a modal that embeds a Google
Sheet. It now navigates to a first-class **`/support`** page: the
*Performance Evaluation System — Report an Issue* form. Every user files
issues in-app; **admins** get two tabs — **Report an Issue** (the same
working form, shown first/by default) and **Responses** (the submitted-ticket
queue). The page follows the app's standard header + card + tab layout
(Project Reviews / 360 Feedback), so it reads as a native page rather than a
bolted-on form.

## What changed for users

Clicking **Support** goes to a page (not a popup). The form captures:

| Field | Control | Notes |
| --- | --- | --- |
| Name | read-only | pre-filled from the signed-in user |
| PMS Page | free-text combobox (required) | type-to-filter over the real app pages (Annual Goals, Project Reviews, …), **but any custom text is accepted** |
| Tab | free-text combobox (always shown) | suggestions follow the chosen page's real sub-tabs; **always available** and accepts custom text (some pages have no predefined tabs) |
| Issue / Query Description | auto-grow textarea (required) | up to 5 000 chars, with a live counter |
| Remarks | auto-grow textarea | optional, up to 2 000 chars |
| Attach Photos | file picker | up to 5 images, thumbnailed with remove buttons |

The **PMS Page → Tab** pairing mirrors the live navigation (e.g. Project
Reviews → *Evaluate Team*), so a report reads back unambiguously. "Other /
General" is the escape hatch for issues not tied to a page.

## Photos — base64, no new infra

The deployment has **no object storage** (Render's filesystem is ephemeral)
and the existing "attachment" convention is a pasted URL, not an upload.
Rather than add S3/multipart, photos are **downscaled + re-encoded to a
size-capped base64 JPEG data URI on the client** (`utils/imageCompression`,
max 1600px, quality steps down until ≤ ~1.9 MB decoded) and stored inline.
This keeps the whole flow on the existing JSON + CSRF path.

Photos live on a **child table** (`support_ticket_photos`), deliberately kept
off the ticket row: the Responses **list** returns only a `photo_count` (one
grouped query, no N+1, no megabytes of base64 dragged per row); the **detail**
endpoint loads the data URIs on demand when an admin expands a row.

## Admin Responses view

`Responses` renders a filterable/searchable table (filter by PMS page,
free-text search over reporter / description / remarks / tab — debounced).
Each row has a **View** button that opens `SupportTicketModal` — a read-only
detail modal (portal + backdrop + Esc/X close, matching
`ProjectReviewDetailModal`) showing every field the user submitted:
name, page, tab, description, remarks, and photo thumbnails. Clicking a
thumbnail opens a full-size lightbox layered above the modal.

The other admin tab, **Report an Issue**, is the *same* `SupportForm` every
user gets — a fully working form (not a disabled preview), so admins can file
issues too. It sits first; Responses is second.

## New-ticket email notifications

On submit, after the row commits, a formatted email is queued (best-effort
via `BackgroundTasks`) to the inboxes in `SUPPORT_NOTIFY_EMAILS` (config;
default `amol@`, `devanshi@`, `trapti@` `healthark.ai`). It reuses the shared
`send_notification_email` snapshot template, so the issue lands in a defined
format: a subject naming the page (`New Support Issue — <page>`), a body with
the free-text **Description**/**Remarks**, and a labelled **Issue details**
table (reporter + email, page, tab, photo count, submitted-at) plus an "Open
in PMS" CTA.

Delivery is decoupled from the submission — a ticket is persisted (and shows
in the Responses queue) regardless of SMTP state; a send failure is logged
per-recipient and never surfaces to the reporter. Content-building
(`build_ticket_notification`) is a pure function so the format is unit-tested
without SMTP.

## Backend

- **Models** (`support_models.py`) — `SupportTicket` (org-scoped;
  `submitter_name` snapshotted at submit time so a later rename/soft-delete
  still shows who filed it) + `SupportTicketPhoto` (cascade child).
- **Schemas** (`support_schemas.py`) — `SupportTicketCreate` validates a
  required page + description, trims/normalises optionals, and caps photo
  **count / MIME / decoded size**. `validate_image_data_uri` is an
  **allowlist** (`image/png|jpeg|gif|webp` only — SVG refused as a script
  vector), mirroring the `url_safety` posture.
- **Routes** (`support_routes.py`, `/api/v1/support`) — `POST /tickets`
  (any authenticated user; queues the notification email), `GET /tickets` +
  `GET /tickets/{id}` (**Admin only**, tenant-fenced). List carries
  `photo_count`; detail carries the blobs.
- **Notifications** (`services/support_notify.py`) — pure content builder +
  a best-effort per-recipient sender over the `SUPPORT_NOTIFY_EMAILS` config
  list. Invoked via `BackgroundTasks` from the create route.
- **Migration** `e4a7c2f19b83` (← `d1f7a2c9e4b6`) — additive; creates both
  tables + indexes.

## Frontend

- `pages/Support.tsx` (lazy route `/support`, no feature gate — like Profile),
  `components/support/SupportForm.tsx`, `components/support/ResponsesTable.tsx`,
  `components/support/SupportTicketModal.tsx`, `services/support.service.ts`,
  `queries/support.ts`, `utils/supportOptions.ts` (the page→tab map + limits,
  single source of truth for both comboboxes and the client-side caps),
  `utils/imageCompression.ts`.
- New `common/FreeTextCombobox` — a type-to-filter picker that also accepts
  custom text (used for both Page and Tab); reuses `common/AutoGrowTextarea`
  for description/remarks. Both match the rest of the app.
- `Sidebar` — Support moved into `BOTTOM_NAV` as a normal route link (active
  highlighting for free); the old `SupportModal.tsx` (and its
  `SUPPORT_FORM_URL` Google-Sheet embed) is **deleted**.

## Tests

- **Backend** `test_support_ticket_schema.py` (26 cases, pure schema) —
  accepts a valid ticket + PNG/JPEG; rejects empty page/description, over-limit
  lengths, too many photos, oversized/foreign/malformed photos (svg, http,
  non-base64); confirms trimming + blank→None. `test_support_notify.py` —
  recipients parse/trim from config; the built email has the right subject,
  body (description + remarks), and labelled details (dash for missing
  tab/email).
- **Frontend** `SupportForm.test.tsx` (name pre-fill, Tab always available,
  submit payload from picked suggestions **and** custom-typed page/tab,
  required-field guards), `Support.test.tsx` (non-admin form vs admin tabs,
  form-first default, view switching), `utils/support.test.ts` (`tabsForPage`,
  `dataUriByteLength`).

## Verification

- Backend `pytest -q` green (448 tests); migration applied to the dev Postgres
  (`alembic upgrade head`) — both tables present with expected columns.
- Frontend `vitest run` green (230 tests); `tsc -b --noEmit` + `eslint` clean.
- **End-to-end** (TestClient, real DB, row cleaned up afterward): staff submit
  with custom free-text page/tab → 201; the notification email fires to all
  three inboxes with the correct subject/body/details (BackgroundTasks run,
  SMTP stubbed); admin detail → photo data URI + custom page/tab; non-admin
  list → **403**; missing CSRF → **403**; empty description → **422**.

## Follow-up (not done here)

- No status/triage workflow (Open/Resolved) on the queue yet — a clean
  follow-up if triage volume warrants it.
- Photos are re-encoded to JPEG (transparency/animation dropped) — fine for bug
  screenshots; revisit if lossless attachments are ever needed.
