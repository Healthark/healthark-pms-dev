# 39 — Free-form Project Code (drop the 20-char cap)

## Why

Creating a project from the Admin Panel failed with a **422 Unprocessable
Entity** whenever the Project Code ran past 20 characters:

```
POST /api/v1/projects/  → 422
{
  "type": "string_too_long",
  "loc": ["body", "project_code"],
  "msg": "String should have at most 20 characters",
  "input": "Project_ERROR Replication - 1",
  "ctx": { "max_length": 20 }
}
```

The reported symptom was "whitespace and `-` aren't allowed", but that was a
misdiagnosis: **there was never a character/pattern constraint** on the code —
spaces and hyphens already passed (existing codes like `MP-1`, `P-0001` prove
it). The only thing rejecting the input was the length ceiling, and
`"Project_ERROR Replication - 1"` is 29 characters.

The DB column is an **unbounded `String`** (`project_code = Column(String, …)`),
so the cap lived purely in Pydantic — no migration, no data change involved.

## What changed

### `backend/app/schemas/project_schemas.py`

- `ProjectCreate.project_code`: `Field(..., min_length=1, max_length=20)` →
  `Field(..., min_length=1)`.
- `ProjectUpdate.project_code`: `Field(default=None, min_length=1, max_length=20)`
  → `Field(default=None, min_length=1)` (so editing a project's code is uncapped
  too, not just creation).
- `min_length=1` is kept: the code stays **required and non-empty**. No
  character pattern was added or removed — whitespace and hyphens continue to
  pass through unchanged.
- `name` is untouched (still `max_length=200`, which comfortably fits real
  names).

No change to the model, the unique index on `(org_id, project_code)`, the DB,
or the frontend (`ProjectModal` already had no `maxLength` / pattern on the
inputs — only a non-empty `.trim()` check).

## Tests

- `backend/tests/test_project_code_free_form.py` — `ProjectCreate` /
  `ProjectUpdate` accept the exact 29-char `"Project_ERROR Replication - 1"`
  (spaces + hyphen, past the old cap) and a long name; empty code is still
  rejected by `min_length=1`.
- `frontend/.../ProjectModal.test.tsx` — a new case types the long, spaced,
  hyphenated code and asserts the create payload carries it verbatim (no
  client-side truncation or block).

All backend (5) and ProjectModal (16) tests pass.
