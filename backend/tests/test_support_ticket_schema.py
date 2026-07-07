"""
SupportTicketCreate / photo validation (Report an Issue intake).

Pure schema tests — no DB or app. Mirrors the attachment_url suite: the
API boundary must accept a well-formed ticket + inline base64 image and
reject empty required fields, oversized/foreign photos, and over-limit
counts before anything reaches a row.
"""
from __future__ import annotations

import base64

import pytest
from pydantic import ValidationError

from app.schemas.support_schemas import (
    MAX_PHOTO_BYTES,
    MAX_PHOTOS,
    SupportPhotoIn,
    SupportTicketCreate,
    validate_image_data_uri,
)

# A real 1x1 PNG — smallest valid image the browser could produce.
_PNG_1PX = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)
_JPEG_TINY = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xd9").decode()


def _oversized_png() -> str:
    """A data URI whose decoded payload exceeds MAX_PHOTO_BYTES by one byte."""
    blob = b"\x00" * (MAX_PHOTO_BYTES + 1)
    return "data:image/png;base64," + base64.b64encode(blob).decode()


# ── Happy path ────────────────────────────────────────────────────────


def test_valid_ticket_with_photo():
    ticket = SupportTicketCreate(
        pms_page="Annual Goals",
        tab="Team Goals",
        description="The approve button does nothing on the Team Goals tab.",
        remarks="Chrome 126, happens every time.",
        photos=[SupportPhotoIn(data_uri=_PNG_1PX, filename="screenshot.png")],
    )
    assert ticket.pms_page == "Annual Goals"
    assert ticket.tab == "Team Goals"
    assert len(ticket.photos) == 1
    assert ticket.photos[0].filename == "screenshot.png"


def test_minimal_ticket_no_optionals():
    ticket = SupportTicketCreate(
        pms_page="Project Reviews",
        description="Cannot open a review.",
    )
    assert ticket.tab is None
    assert ticket.remarks is None
    assert ticket.photos == []


@pytest.mark.parametrize("blank", [None, "", "   "])
def test_blank_tab_and_remarks_normalise_to_none(blank):
    ticket = SupportTicketCreate(
        pms_page="Dashboard",
        tab=blank,
        remarks=blank,
        description="x",
    )
    assert ticket.tab is None
    assert ticket.remarks is None


def test_fields_are_trimmed():
    ticket = SupportTicketCreate(
        pms_page="  Annual Reviews  ",
        tab="  My Review  ",
        description="  needs trimming  ",
        remarks="  note  ",
    )
    assert ticket.pms_page == "Annual Reviews"
    assert ticket.tab == "My Review"
    assert ticket.description == "needs trimming"
    assert ticket.remarks == "note"


@pytest.mark.parametrize("good", [_PNG_1PX, _JPEG_TINY])
def test_valid_photo_accepted(good):
    assert SupportPhotoIn(data_uri=good).data_uri == good


# ── Required fields ─────────────────────────────────────────────────────


@pytest.mark.parametrize("bad", ["", "   ", "\n\t"])
def test_empty_description_rejected(bad):
    with pytest.raises(ValidationError):
        SupportTicketCreate(pms_page="Dashboard", description=bad)


@pytest.mark.parametrize("bad", ["", "   "])
def test_empty_pms_page_rejected(bad):
    with pytest.raises(ValidationError):
        SupportTicketCreate(pms_page=bad, description="something broke")


# ── Length ceilings ─────────────────────────────────────────────────────


def test_overlong_description_rejected():
    with pytest.raises(ValidationError):
        SupportTicketCreate(pms_page="Dashboard", description="a" * 5001)


def test_overlong_page_rejected():
    with pytest.raises(ValidationError):
        SupportTicketCreate(pms_page="a" * 121, description="x")


def test_overlong_remarks_rejected():
    with pytest.raises(ValidationError):
        SupportTicketCreate(
            pms_page="Dashboard", description="x", remarks="a" * 2001
        )


# ── Photo caps ──────────────────────────────────────────────────────────


def test_too_many_photos_rejected():
    photos = [SupportPhotoIn(data_uri=_PNG_1PX) for _ in range(MAX_PHOTOS + 1)]
    with pytest.raises(ValidationError):
        SupportTicketCreate(
            pms_page="Dashboard", description="x", photos=photos
        )


def test_oversized_photo_rejected():
    with pytest.raises(ValidationError):
        SupportPhotoIn(data_uri=_oversized_png())


@pytest.mark.parametrize(
    "bad",
    [
        "https://example.com/x.png",             # not a data URI
        "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",  # svg — script vector
        "data:text/html;base64,PGgxPmhpPC9oMT4=",       # not an image
        "data:image/png;base64,!!!notbase64!!!",         # malformed base64
        "data:image/png;utf8,notbase64",                 # not base64-encoded
        "javascript:alert(1)",
        "",
    ],
)
def test_bad_photo_rejected(bad):
    with pytest.raises(ValidationError):
        SupportPhotoIn(data_uri=bad)


# ── Pure helper ─────────────────────────────────────────────────────────


def test_validate_image_data_uri_helper():
    assert validate_image_data_uri(_PNG_1PX) == _PNG_1PX
    with pytest.raises(ValueError):
        validate_image_data_uri("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")
    with pytest.raises(ValueError):
        validate_image_data_uri(_oversized_png())
