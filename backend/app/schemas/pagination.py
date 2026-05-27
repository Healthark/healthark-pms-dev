"""
pagination.py — Shared offset/limit pagination primitives.

`Page[T]` is the standard response envelope for every paginated list
endpoint. Reuse it across domains so the frontend can share one
`Page<T>` TypeScript type and one TanStack pattern.

Contract:
    GET /endpoint?page=1&per_page=25  →  Page[ItemSchema]

`PaginationParams` is a FastAPI dependency that parses + validates the
`page` / `per_page` query params with sane bounds. Inject it into any
route that returns a `Page[...]`.
"""

from typing import Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """Standard paginated response envelope.

    `total` is the count across ALL pages after filtering (so the UI can
    render "Page X of N"). `page` is 1-based.
    """

    items: list[T]
    total: int
    page: int
    per_page: int


class PaginationParams:
    """Parsed + validated page/per_page query params.

    Bounds:
        page     ≥ 1            (defaults to 1)
        per_page in [1, 100]    (defaults to 25; capped so a caller can't
                                 request the whole table and defeat the
                                 point of pagination)

    Usage:
        @router.get("/x", response_model=Page[XRow])
        def list_x(pg: PaginationParams = Depends()): ...
    """

    def __init__(
        self,
        page: int = Query(1, ge=1, description="1-based page number"),
        per_page: int = Query(
            25, ge=1, le=100, description="Rows per page (max 100)"
        ),
    ):
        self.page = page
        self.per_page = per_page

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.per_page

    @property
    def limit(self) -> int:
        return self.per_page
