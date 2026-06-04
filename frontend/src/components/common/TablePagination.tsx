import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * TablePagination — client-side pagination bar for admin tables.
 *
 * Frontend-only for now: the parent holds the full filtered list and slices
 * it by `page`/`pageSize`. When the backend grows real pagination, the same
 * props can be fed from server metadata (total from the response, page/size
 * driving the request) without changing this component's API.
 */

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50];

interface TablePaginationProps {
  /** 1-based current page. */
  readonly page: number;
  readonly pageSize: number;
  /** Total number of records across all pages (post-filter). */
  readonly totalItems: number;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (size: number) => void;
  readonly pageSizeOptions?: readonly number[];
}

export function TablePagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const canPrev = page > 1;
  const canNext = page < totalPages;

  const navBtnCls =
    "inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-text-main transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
      <div className="flex items-center gap-2 text-[13px] text-text-muted">
        <label htmlFor="page-size" className="font-medium">
          Rows per page
        </label>
        <select
          id="page-size"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer"
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-[13px] text-text-muted">
          {totalItems} {totalItems === 1 ? "Record" : "Records"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={!canPrev}
            className={navBtnCls}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Prev
          </button>
          <span className="text-[13px] text-text-muted tabular-nums">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={!canNext}
            className={navBtnCls}
          >
            Next
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
