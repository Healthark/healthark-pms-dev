# backend/tests

Pure-function tests. No DB, no FastAPI app, no `.env` required.

```
tests/
├── conftest.py             # placeholder for shared fixtures (currently empty)
├── test_cycle_utils.py     # fiscal year math, review windows
└── test_security.py        # bcrypt hashing, JWT sign/verify
```

## Setup

```pwsh
cd backend
pip install -r requirements-dev.txt
```

## Running

```pwsh
pytest tests/ -v       # all tests
ruff check .           # lint (scoped to tests/ only — see ruff.toml)
```

## Adding tests

Pure-function tests go directly under `tests/`. Anything that needs the DB, the FastAPI app, or real seed data is deferred until after the dev + bug-fix phase wraps up — see [docs/testing/README.md](../../docs/testing/README.md).
