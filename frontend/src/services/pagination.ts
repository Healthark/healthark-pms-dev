/**
 * pagination.ts — Shared offset/limit pagination types.
 *
 * `Page<T>` mirrors the backend `Page[T]` envelope
 * (backend/app/schemas/pagination.py). Reuse it for every paginated
 * list endpoint so the FE has one type + one TanStack pattern.
 */

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

/** Standard query params for a paginated, searchable, sortable list. */
export interface PageQuery {
  page: number;
  per_page: number;
  search?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
}
