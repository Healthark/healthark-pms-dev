/**
 * Loading-state placeholder for the My Reviews tab — mimics the sortable
 * table so the page layout doesn't jump when data arrives.
 */

export function TableSkeleton() {
  return (
    <div className="animate-pulse">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex gap-6 px-5 py-3 border-b border-border"
        >
          <div className="h-4 w-1/4 rounded bg-surface-hover" />
          <div className="h-4 w-16 rounded bg-surface-hover" />
          <div className="h-4 w-1/5 rounded bg-surface-hover" />
          <div className="h-4 w-20 rounded-full bg-surface-hover" />
          <div className="h-4 w-12 rounded bg-surface-hover" />
        </div>
      ))}
    </div>
  );
}
