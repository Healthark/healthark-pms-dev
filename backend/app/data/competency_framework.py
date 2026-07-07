"""
Loader for the seeded competency framework.

``competency_framework.json`` is the canonical framework, derived from HR's
"Final Expectations FW" workbook (IDT levels 1-7; RWE + Strategy levels 1-3).
The source workbook stays out of the repo; this committed JSON is what every
environment seeds from. Shape::

    {
      "competencies": [{"key", "label", "is_reviewable"}, ...],  # canonical, ordered
      "default_expectation": "Not defined",
      "departments": {
        "IDT": {"levels": {"1": {"<key>": "<expectation text>", ...}, ...}},
        ...
      }
    }
"""

import json
from pathlib import Path

_PATH = Path(__file__).with_name("competency_framework.json")
_CACHE: dict | None = None


def load_framework() -> dict:
    """The parsed framework JSON (cached)."""
    global _CACHE
    if _CACHE is None:
        _CACHE = json.loads(_PATH.read_text(encoding="utf-8"))
    return _CACHE
