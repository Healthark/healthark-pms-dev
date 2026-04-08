import { Bell } from "lucide-react";

interface TopbarProps {
  readonly currentPage: string;
}

export function Topbar({ currentPage }: TopbarProps) {
  // Simple helper to format the ID into a readable title (e.g., 'project-reviews' -> 'Project Reviews')
  const title = currentPage
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return (
    <header className="h-16 bg-surface border-b border-border flex items-center justify-between px-8 shrink-0">
      <h2 className="font-display font-medium text-lg text-text-main">
        {title}
      </h2>

      <div className="flex items-center gap-4">
        <button className="p-2 text-text-muted hover:text-brand transition-colors rounded-full hover:bg-slate-50 relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-surface"></span>
        </button>
        <div className="h-8 w-8 rounded-full bg-brand text-white flex items-center justify-center font-semibold text-sm">
          JD
        </div>
      </div>
    </header>
  );
}
