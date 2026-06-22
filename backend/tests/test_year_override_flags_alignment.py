"""Guard: every per-FY override flag must be a field on SystemSettingsResponse.

`get_system_settings` overlays each YEAR_OVERRIDE_FLAGS value onto a
SystemSettingsResponse via setattr. A flag present in the registry but missing
from the schema raised a ValueError in production — but ONLY when an active-FY
override row existed (so local/tests without one didn't catch it). This keeps
the registry and the response schema in lockstep.
"""
from app.core.cycle_utils import YEAR_OVERRIDE_FLAGS
from app.schemas.system_settings_schemas import SystemSettingsResponse


def test_response_has_all_year_override_flags():
    fields = set(SystemSettingsResponse.model_fields)
    missing = [f for f in YEAR_OVERRIDE_FLAGS if f not in fields]
    assert not missing, (
        f"SystemSettingsResponse is missing override flag fields: {missing}. "
        "Add them to the schema — get_system_settings setattrs every "
        "YEAR_OVERRIDE_FLAGS value onto it."
    )
