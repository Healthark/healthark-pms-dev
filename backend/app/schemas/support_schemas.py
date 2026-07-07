"""
Pydantic shapes for the Support ("Report an Issue") API.

Submit path (any authenticated user):
    SupportTicketCreate  → one ticket + 0..N inline photos.

Read path (Admin only):
    SupportTicketRow     → one row in the Responses queue (no photo blob;
                           just a count, so the list stays lean).
    SupportTicketDetail  → a single ticket expanded, photos included.

Photos are base64 image data URIs stored inline (no object storage in this
deployment). The caps below are the guardrails that stop a runaway upload
from bloating the DB — enforced here so a bad payload never reaches a row.
"""

from __future__ import annotations

import base64
import re
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

# ── Limits (mirrored by the frontend in src/utils/supportOptions.ts) ──
MAX_PHOTOS = 5
# Decoded bytes per image. ~1.9 MB — comfortably fits a client-downscaled
# screenshot while refusing an un-resized multi-megapixel original.
MAX_PHOTO_BYTES = 2_000_000
MAX_DESCRIPTION_LENGTH = 5000
MAX_REMARKS_LENGTH = 2000
MAX_PAGE_LENGTH = 120
MAX_TAB_LENGTH = 120
MAX_FILENAME_LENGTH = 255

# Ticket lifecycle. Mirrors SUPPORT_STATUSES in app/models/support_models.py.
# Free progression — any state can be set at any time.
SupportStatus = Literal["pending", "in_progress", "completed"]

# Only raster image data URIs the browser actually produces. An allowlist,
# not a blocklist — anything else (svg with scripts, arbitrary data:, http
# links) is refused.
_DATA_URI_RE = re.compile(
    r"^data:image/(png|jpe?g|gif|webp);base64,(?P<payload>[A-Za-z0-9+/]+={0,2})$"
)


def validate_image_data_uri(value: str) -> str:
    """Validate a single attached photo.

    Accepts only a base64 ``data:image/<png|jpeg|gif|webp>;base64,…`` URI
    whose decoded size is within MAX_PHOTO_BYTES. Raises ValueError otherwise
    — inside a Pydantic validator this surfaces to the client as a 422.

    We deliberately don't accept ``image/svg+xml``: an SVG can carry script
    and is later rendered/opened in an authenticated session.
    """
    if not isinstance(value, str):
        raise ValueError("Photo must be a base64 image data URI.")

    trimmed = value.strip()
    match = _DATA_URI_RE.match(trimmed)
    if not match:
        raise ValueError(
            "Photo must be a base64 PNG, JPEG, GIF, or WEBP data URI."
        )

    payload = match.group("payload")
    try:
        decoded = base64.b64decode(payload, validate=True)
    except (ValueError, base64.binascii.Error) as exc:  # type: ignore[attr-defined]
        raise ValueError("Photo is not valid base64.") from exc

    if len(decoded) == 0:
        raise ValueError("Photo is empty.")
    if len(decoded) > MAX_PHOTO_BYTES:
        mb = MAX_PHOTO_BYTES / 1_000_000
        raise ValueError(f"Each photo must be under {mb:.1f} MB.")

    return trimmed


def _clean_optional_text(value: Optional[str]) -> Optional[str]:
    """Trim; treat blank as absent (None)."""
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


# ── Submit ──────────────────────────────────────────────────────────


class SupportPhotoIn(BaseModel):
    data_uri: str
    filename: Optional[str] = Field(default=None, max_length=MAX_FILENAME_LENGTH)

    @field_validator("data_uri")
    @classmethod
    def _check_data_uri(cls, v: str) -> str:
        return validate_image_data_uri(v)

    @field_validator("filename")
    @classmethod
    def _clean_filename(cls, v: Optional[str]) -> Optional[str]:
        return _clean_optional_text(v)


class SupportTicketCreate(BaseModel):
    pms_page: str = Field(..., max_length=MAX_PAGE_LENGTH)
    tab: Optional[str] = Field(default=None, max_length=MAX_TAB_LENGTH)
    description: str = Field(..., max_length=MAX_DESCRIPTION_LENGTH)
    remarks: Optional[str] = Field(default=None, max_length=MAX_REMARKS_LENGTH)
    photos: List[SupportPhotoIn] = Field(default_factory=list, max_length=MAX_PHOTOS)

    @field_validator("pms_page")
    @classmethod
    def _require_page(cls, v: str) -> str:
        trimmed = (v or "").strip()
        if not trimmed:
            raise ValueError("Please select the PMS page where the issue occurred.")
        return trimmed

    @field_validator("description")
    @classmethod
    def _require_description(cls, v: str) -> str:
        trimmed = (v or "").strip()
        if not trimmed:
            raise ValueError("Please describe the issue.")
        return trimmed

    @field_validator("tab", "remarks")
    @classmethod
    def _clean_optionals(cls, v: Optional[str]) -> Optional[str]:
        return _clean_optional_text(v)


# ── Read (Admin) ──────────────────────────────────────────────────────


class SupportPhotoOut(BaseModel):
    id: int
    data_uri: str
    filename: Optional[str] = None


class SupportTicketRow(BaseModel):
    """One row in the Responses queue. Carries `photo_count` (cheap grouped
    count) instead of the photo blobs — the detail endpoint loads those."""
    id: int
    submitter_name: str
    pms_page: str
    tab: Optional[str] = None
    description: str
    remarks: Optional[str] = None
    status: SupportStatus = "pending"
    photo_count: int = 0
    created_at: datetime


class SupportTicketDetail(BaseModel):
    id: int
    submitter_name: str
    pms_page: str
    tab: Optional[str] = None
    description: str
    remarks: Optional[str] = None
    status: SupportStatus = "pending"
    created_at: datetime
    photos: List[SupportPhotoOut] = Field(default_factory=list)


class SupportTicketStatusUpdate(BaseModel):
    status: SupportStatus


class SupportTicketStatusResponse(BaseModel):
    id: int
    status: SupportStatus
