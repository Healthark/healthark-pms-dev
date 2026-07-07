/**
 * supportOptions — the option sets + limits for the Support ("Report an
 * Issue") form.
 *
 * `PMS_PAGES` is the source of truth for the two dependent dropdowns: the
 * user picks a top-level PMS page, then the Tab dropdown is filtered to that
 * page's real sub-tabs (mirroring the actual app navigation). Pages with no
 * sub-tabs (Dashboard, Profile, …) leave the Tab dropdown hidden. "Other /
 * General" is the escape hatch for issues that aren't tied to a page.
 *
 * The tab labels below intentionally match the live tab-bar labels in each
 * page component, so a report reads back unambiguously (e.g. Project Reviews
 * → "Evaluate Team"). Keep them in sync if a page renames a tab.
 *
 * The size/count limits mirror the backend caps in
 * app/schemas/support_schemas.py — enforce them client-side so the user gets
 * an instant, friendly error instead of a 422 round-trip.
 */

export interface PmsPageOption {
  /** Page label — matches the sidebar nav + the stored `pms_page`. */
  readonly page: string;
  /** Sub-tab labels for this page, or [] when the page has no tabs. */
  readonly tabs: readonly string[];
}

export const PMS_PAGES: readonly PmsPageOption[] = [
  { page: "Dashboard", tabs: [] },
  { page: "Annual Goals", tabs: ["My Goals", "Team Goals", "All Goals"] },
  {
    page: "Project Reviews",
    tabs: ["My Reviews", "Evaluate Team", "All Reviews"],
  },
  {
    page: "Annual Reviews",
    tabs: ["My Review", "Team Review", "All Reviews"],
  },
  { page: "My Mentees", tabs: [] },
  {
    page: "360 Feedback",
    tabs: ["Give Feedback", "My Feedback", "Mentee Feedback", "All Feedback"],
  },
  { page: "Management Reviews", tabs: [] },
  {
    page: "Admin Panel",
    tabs: [
      "Users",
      "Projects",
      "Notifications",
      "Exports",
      "Settings",
      "Goal Access",
      "Review Eligibility",
    ],
  },
  { page: "Profile", tabs: [] },
  { page: "Other / General", tabs: [] },
];

/** Tabs for a given page label, or [] if unknown / no tabs. */
export function tabsForPage(page: string): readonly string[] {
  return PMS_PAGES.find((p) => p.page === page)?.tabs ?? [];
}

// ── Limits (mirror app/schemas/support_schemas.py) ────────────────────
export const MAX_PHOTOS = 5;
/** Max decoded bytes per attached image after client-side downscaling. */
export const MAX_PHOTO_BYTES = 2_000_000;
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_REMARKS_LENGTH = 2000;

// Client-side downscale target — big enough for a legible screenshot,
// small enough to stay comfortably under MAX_PHOTO_BYTES so uploads rarely
// bounce.
export const PHOTO_MAX_DIMENSION = 1600;
export const PHOTO_JPEG_QUALITY = 0.82;

// ── Ticket status (mirror of SUPPORT_STATUSES in the backend model) ───
export type SupportStatus = "pending" | "in_progress" | "completed";

export interface SupportStatusOption {
  readonly value: SupportStatus;
  readonly label: string;
  /** Tailwind classes for the status badge / select treatment. */
  readonly badgeClass: string;
}

export const SUPPORT_STATUS_OPTIONS: readonly SupportStatusOption[] = [
  {
    value: "pending",
    label: "Pending",
    badgeClass:
      "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  },
  {
    value: "in_progress",
    label: "In Progress",
    badgeClass:
      "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  },
  {
    value: "completed",
    label: "Completed",
    badgeClass:
      "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300 border-green-200 dark:border-green-800",
  },
];

/** New tickets land here, and it's the default filter on the Responses view. */
export const DEFAULT_STATUS_FILTER: SupportStatus = "pending";

export function statusMeta(value: string): SupportStatusOption {
  return (
    SUPPORT_STATUS_OPTIONS.find((s) => s.value === value) ??
    SUPPORT_STATUS_OPTIONS[0]
  );
}
