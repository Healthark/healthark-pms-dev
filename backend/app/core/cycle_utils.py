"""
cycle_utils — Calendar / lifecycle helpers shared across goal-routes.

Two review cadences are supported on the same column family:
    - half_yearly orgs use H1 / H2 (two windows per FY).
    - quarterly  orgs use Q1 / Q2 / Q3 / Q4 (four windows per FY).

The cycle code (e.g. "H1", "Q3") is derived from the calendar instant and
the org's cycle_type. The cycle_type is also baked into the code's prefix
("H" → half-yearly, "Q" → quarterly), so a function holding only the
cycle code can recover the cadence without an extra arg — see
`cycle_keys_for`.
"""

from typing import TYPE_CHECKING, Optional

from app.models.system_settings_models import CycleType

if TYPE_CHECKING:
    from sqlalchemy.orm import Session as SqlSession

    from app.models.annual_review_models import AnnualReview
    from app.models.goal_models import Goal
    from app.models.project_review_models import ProjectReview
    from app.models.system_settings_models import SystemSettings
    from app.models.system_settings_year_override_models import (
        SystemSettingsYearOverride,
    )


# ── Cycle label parsing & manual advancement ────────────────────────
#
# The active cycle is a STORED, admin-advanced value (see the cycle
# roll-out endpoints) — NOT derived from the calendar. These helpers parse
# the canonical label ("H1 FY26-27") and compute the next one.

def fy_start_year(fy_token: str) -> int:
    """'FY26-27' / 'FY26' → 2026 (assumes the 2000s, matching _format_fy_span)."""
    digits = fy_token.upper().removeprefix("FY").split("-")[0]
    return 2000 + int(digits)


def parse_cycle(cycle_name: str) -> tuple[Optional[str], int]:
    """Split a canonical cycle label into (cycle_code, fiscal_start_year).

        "H1 FY26-27" → ("H1", 2026)
        "Q3 FY27-28" → ("Q3", 2027)
        "FY26-27"    → (None, 2026)   (annual / bare FY)
        "H1 FY26"    → ("H1", 2026)   (legacy 2-digit form)

    Raises ValueError when no FY token is present.
    """
    code: Optional[str] = None
    fy_token: Optional[str] = None
    for token in cycle_name.upper().split():
        if token.startswith("FY"):
            fy_token = token
        elif token[:1] in ("H", "Q"):
            code = token
    if fy_token is None:
        raise ValueError(f"No fiscal-year token in cycle name: {cycle_name!r}")
    return code, fy_start_year(fy_token)


def next_cycle(cycle_name: str, cycle_type: "CycleType | str") -> str:
    """Return the cycle label that follows `cycle_name` for the org's cadence.

        half_yearly: H1 FY26-27 → H2 FY26-27 → H1 FY27-28
        quarterly:   Q1 → Q2 → Q3 → Q4 → Q1 (next FY)
        annual:      FY26-27 → FY27-28

    The FY increments when the cadence's last code wraps around.
    """
    ct = cycle_type.value if isinstance(cycle_type, CycleType) else cycle_type
    code, fy = parse_cycle(cycle_name)
    if ct == CycleType.ANNUAL.value:
        return _format_fy_span(fy + 1)
    keys = QUARTER_KEYS if ct == CycleType.QUARTERLY.value else HALF_KEYS
    nxt = (keys.index(code) + 1) if code in keys else 0
    if nxt < len(keys):
        return f"{keys[nxt]} {_format_fy_span(fy)}"
    return f"{keys[0]} {_format_fy_span(fy + 1)}"


# ── Cadence helpers ─────────────────────────────────────────────────

#: The full ordered list of cycle codes for each cadence.
HALF_KEYS:    tuple[str, ...] = ("H1", "H2")
QUARTER_KEYS: tuple[str, ...] = ("Q1", "Q2", "Q3", "Q4")


def cycle_keys_for(cycle_code: str) -> tuple[str, ...]:
    """Recover the full cadence list from any single cycle code's prefix.

    "H1" / "H2"      → ("H1", "H2")
    "Q1".."Q4"       → ("Q1", "Q2", "Q3", "Q4")

    Raises ValueError on unknown prefixes so callers don't silently treat
    a typo as half-yearly.
    """
    if cycle_code.startswith("H"):
        return HALF_KEYS
    if cycle_code.startswith("Q"):
        return QUARTER_KEYS
    raise ValueError(f"Unknown cycle code: {cycle_code!r}")


def cycles_before(cycle_code: str) -> tuple[str, ...]:
    """All cycle codes that come before `cycle_code` in the same cadence.

    "H1" → ()             "H2" → ("H1",)
    "Q1" → ()             "Q3" → ("Q1", "Q2")
    """
    keys = cycle_keys_for(cycle_code)
    return keys[: keys.index(cycle_code)]


# ── Active-cycle-derived stamps ─────────────────────────────────────

def goal_cycle_name_for_active(active_cycle_name: str) -> str:
    """Goal stamp ("H1 2026") for the currently active cycle.

    Annual goals always bucket into halves regardless of the org's review
    cadence (Q1-Q2 → H1, Q3-Q4 → H2) — the goal belongs to the whole FY,
    only its review windows differ.
    """
    code, fy = parse_cycle(active_cycle_name)
    if code and code.startswith("Q"):
        half = "H1" if code in ("Q1", "Q2") else "H2"
    elif code and code.startswith("H"):
        half = code
    else:
        half = "H1"
    return f"{half} {fy}"


# ── Time-window gate ────────────────────────────────────────────────

def is_review_window_open(
    target_cycle: str,
    target_fy_year: int,
    active_cycle_name: str,
) -> bool:
    """True iff the (target_cycle, target_fy_year) window is open under the
    manually-set active cycle.

    Rules:
        - Same FY required — no cross-fiscal-year reviews.
        - Backfill kept: any cycle at or before the active cycle (same cadence)
          is open, so earlier cycles can still be filed while the FY is in
          flight.

    The active cycle is the stored `active_cycle_name`. A quarterly active
    cycle still maps to a half (Q1-2 → H1, Q3-4 → H2); an annual active cycle
    opens the whole FY.
    """
    active_code, active_fy = parse_cycle(active_cycle_name)
    if active_fy != target_fy_year:
        return False
    keys = cycle_keys_for(target_cycle)
    if active_code is None:
        return True  # annual cadence — the whole FY is open
    if active_code in keys:
        active_idx = keys.index(active_code)
    elif active_code.startswith("Q") and keys == HALF_KEYS:
        active_idx = 0 if active_code in ("Q1", "Q2") else 1
    else:
        return False
    return keys.index(target_cycle) <= active_idx


def extract_fy_label(cycle_name: str) -> str:
    """
    Extract the bare fiscal-year label from any cycle name.

    The active_cycle_name on SystemSettings follows the cadence of the org's
    review cycle (e.g. "H1 FY26-27", "Q2 FY26-27"), but annual goals belong
    to a full fiscal year, not a half or quarter.  This helper strips the
    period prefix so the goal is stamped with just the year it belongs to.

        "H1 FY26-27"  →  "FY26-27"
        "Q3 FY27-28"  →  "FY27-28"
        "FY26-27"     →  "FY26-27"   (already bare — returned unchanged)
        "H1 FY26"     →  "FY26"      (legacy 2-digit form, still tolerated)
    """
    for token in cycle_name.upper().split():
        if token.startswith("FY"):
            return token
    return cycle_name  # Fallback: return as-is if pattern not found


def _format_fy_span(fiscal_year: int) -> str:
    """Render the FY token as a spanning two-year window: 2026 → 'FY26-27'.

    Wraps year-mod-100 cleanly across century boundaries (FY99 → FY99-00).
    """
    a = fiscal_year % 100
    b = (fiscal_year + 1) % 100
    return f"FY{a:02d}-{b:02d}"


# ── Per-year override row helpers ────────────────────────────────────
#
# The four access-control toggles now live on `system_settings_year_overrides`
# keyed on `(org_id, fy_label)`. These helpers centralise the lookup so
# gating helpers in route modules don't each re-parse cycle strings or
# duplicate the lazy-create logic.

#: Annual-review toggles — keyed per FISCAL YEAR (reviewed once a year).
FY_OVERRIDE_FLAGS: tuple[str, ...] = (
    "annual_reviews_enabled",
    "annual_review_final_rating_visible",
    "annual_review_mentor_rating_visible",
    "management_review_enabled",
)
#: Annual-goal + project-review toggles — keyed per HALF (H1/H2), reviewed
#: twice a year so each half opens/closes independently.
HALF_OVERRIDE_FLAGS: tuple[str, ...] = (
    "annual_goals_edit_enabled",
    "annual_goals_final_rating_visible",
    "project_ratings_visible",
)
#: All override flags (the full column set on a period override row). Used by
#: the get_system_settings overlay + the registry/schema alignment guard.
YEAR_OVERRIDE_FLAGS: tuple[str, ...] = FY_OVERRIDE_FLAGS + HALF_OVERRIDE_FLAGS


def _cycle_to_fy_label(cycle_name: str | None) -> str | None:
    """Convert any goal/cycle string to a bare FY label ("FY26-27"), or None.

    healthark stores cycle strings in two distinct shapes, so this is the
    single converter both the goal gate, the /years union, and the
    preflight reuse:

      - Strings carrying an explicit FY token — "H1 FY26-27", "Q3 FY27-28",
        "FY26-27" — resolve via `extract_fy_label`.
      - healthark annual-goal stamps — "H1 2026" / "H2 2026" — carry a
        4-digit *fiscal year*, NOT an FY token (see `goal_cycle_name_for_active`).
        Those convert through `_format_fy_span(2026)` → "FY26-27".

    Returns None when no FY can be derived (e.g. a regular goal's NULL
    cycle_name), so callers can default-deny rather than guess.
    """
    if not cycle_name:
        return None
    # Prefer an explicit FY token if the string carries one.
    extracted = extract_fy_label(cycle_name)
    if extracted.upper().startswith("FY"):
        return extracted.upper()
    # No FY token — fall back to healthark's "H1 2026" goal shape: pull the
    # 4-digit fiscal year and span it into an FY label.
    for token in cycle_name.split():
        if len(token) == 4 and token.isdigit():
            return _format_fy_span(int(token))
    return None


def _fy_label_of_cycle_string(cycle_text: str | None) -> str | None:
    """Strip any cycle prefix off `cycle_text` and return the bare FY token.

    Wraps `extract_fy_label` but returns None instead of echoing the
    input back when no FY token is present, so callers can distinguish
    "unknown FY — default-deny" from a successful lookup.
    """
    if not cycle_text:
        return None
    extracted = extract_fy_label(cycle_text)
    return extracted if extracted.upper().startswith("FY") else None


def _fy_label_of_review(review: "AnnualReview") -> str | None:
    """FY label for an annual review row.

    `AnnualReview.cycle_name` is already stored as the bare FY token
    ("FY26-27") at creation time (see `_active_fy_label` in
    annual_review_routes), so this is a thin wrapper that guards against
    legacy "H1 FY26-27" stamping that may exist on older rows.
    """
    return _fy_label_of_cycle_string(getattr(review, "cycle_name", None))


def _fy_label_of_goal(goal: "Goal") -> str | None:
    """FY label for a goal row.

    healthark stamps annual `Goal.cycle_name` as "H1 2026"/"H2 2026" (a
    4-digit fiscal *year*, not an FY token — see `goal_cycle_name_for_active`),
    so this routes through `_cycle_to_fy_label`, which handles both that
    shape and an explicit FY token. Regular goals have a NULL `cycle_name`
    and return None (they don't go through the annual-goal gate).
    """
    return _cycle_to_fy_label(getattr(goal, "cycle_name", None))


def _fy_label_of_project_review(review: "ProjectReview") -> str | None:
    """FY label for a project review row.

    `ProjectReview.cycle` carries the full cycle name ("Q1 FY26-27"),
    not the bare FY — we strip the period prefix here.
    """
    return _fy_label_of_cycle_string(getattr(review, "cycle", None))


def _half_label_of_cycle_string(cycle_text: str | None) -> str | None:
    """Resolve any cycle string to a canonical HALF label ("H1 FY26-27"), or None.

    Goals stamp "H1 2026"/"H2 2026"; project reviews carry "H1 FY26-27" or
    "Q1 FY26-27". Quarterly codes fold into halves (Q1-2 → H1, Q3-4 → H2).
    Returns None when no half can be derived (a bare FY, or a regular goal's
    NULL cycle) so callers default-deny.
    """
    if not cycle_text:
        return None
    fy = _cycle_to_fy_label(cycle_text)
    if fy is None:
        return None
    code = None
    for token in cycle_text.upper().split():
        if token[:1] in ("H", "Q"):
            code = token
            break
    if code is None:
        return None
    half = code if code.startswith("H") else ("H1" if code in ("Q1", "Q2") else "H2")
    return f"{half} {fy}"


def _half_label_of_goal(goal: "Goal") -> str | None:
    """HALF label ("H1 FY26-27") for a goal row, from its "H1 2026" stamp."""
    return _half_label_of_cycle_string(getattr(goal, "cycle_name", None))


def _half_label_of_project_review(review: "ProjectReview") -> str | None:
    """HALF label ("H1 FY26-27") for a project review, from its "H1 FY26-27" cycle."""
    return _half_label_of_cycle_string(getattr(review, "cycle", None))


def canonical_period_label(label: str | None) -> str | None:
    """Canonicalise a period label: a HALF ("H1 FY26-27") when the string
    carries a half/quarter code, else a bare FY ("FY26-27"). Returns None when
    no fiscal year can be derived (invalid input). Used by the admin period
    get/update endpoints to accept either an FY or a half selection.
    """
    if not label:
        return None
    half = _half_label_of_cycle_string(label)
    if half is not None:
        return half
    fy = extract_fy_label(label)
    return fy if fy.upper().startswith("FY") else None


def get_year_override(
    db: "SqlSession",
    org_id: int,
    period_label: str | None,
) -> "SystemSettingsYearOverride | None":
    """Look up the override row for (org_id, period_label). Does NOT create.

    `period_label` is a FISCAL-YEAR label ("FY26-27") for the annual-review
    flags, or a HALF label ("H1 FY26-27") for the goal/project flags — one row
    per period. Returns None when the label is missing or no row exists
    (default-deny). `ensure_year_override_row` is the admin write path.
    """
    if not period_label:
        return None
    # Local import dodges the model-layer circular: cycle_utils is
    # imported by route modules that import the model, and the model
    # itself reaches back into cycle_utils via TYPE_CHECKING.
    from app.models.system_settings_year_override_models import (
        SystemSettingsYearOverride,
    )
    return (
        db.query(SystemSettingsYearOverride)
        .filter(
            SystemSettingsYearOverride.org_id == org_id,
            SystemSettingsYearOverride.period_label == period_label,
        )
        .first()
    )


def ensure_year_override_row(
    db: "SqlSession",
    org_id: int,
    period_label: str,
    *,
    updated_by_id: Optional[int] = None,
) -> "SystemSettingsYearOverride":
    """Lazily create the override row for (org_id, period_label) with every flag
    default-deny (False), and return it. Existing rows are returned unchanged.

    `period_label` is an FY label ("FY26-27") or a half label ("H1 FY26-27").
    Default-deny on creation: a new period starts fully closed; the admin opens
    each toggle explicitly, and the roll-out relies on this for new periods.

    Committed before return so concurrent readers don't see a phantom row.
    """
    existing = get_year_override(db, org_id, period_label)
    if existing is not None:
        return existing

    from app.models.system_settings_year_override_models import (
        SystemSettingsYearOverride,
    )
    row = SystemSettingsYearOverride(
        org_id=org_id,
        period_label=period_label,
        updated_by_id=updated_by_id,
        **{flag: False for flag in YEAR_OVERRIDE_FLAGS},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
