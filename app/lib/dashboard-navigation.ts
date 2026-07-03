/**
 * Dashboard V2 — single customer navigation model.
 * Customer jobs, not backend modules.
 */

export interface DashboardNavItem {
  label: string;
  to: string;
  end?: boolean;
  /** Hide unless condition met (e.g. presence entitlement) */
  requiresPresence?: boolean;
  requiresOps?: boolean;
}

export interface DashboardNavSection {
  title?: string;
  items: DashboardNavItem[];
}

export const DASHBOARD_PRIMARY_NAV: DashboardNavSection[] = [
  {
    items: [
      { label: "Overview", to: "/app", end: true },
      { label: "Search", to: "/search" },
    ],
  },
  {
    title: "Monitor",
    items: [
      { label: "Watchlists", to: "/app/watchlists" },
      { label: "Presence", to: "/app/presence", requiresPresence: true },
    ],
  },
  {
    title: "Library",
    items: [{ label: "Collections", to: "/app/collections" }],
  },
  {
    title: "Review",
    items: [
      { label: "Digests", to: "/app/digests" },
      { label: "Reports", to: "/app/shares" },
    ],
  },
];

export const DASHBOARD_SETTINGS_NAV: DashboardNavSection[] = [
  {
    title: "Workspace",
    items: [
      { label: "Notifications", to: "/app/notifications" },
      { label: "Source access", to: "/app/source-access" },
      { label: "Developer access", to: "/app/developer-access" },
      { label: "Team", to: "/app/team" },
      { label: "Client rooms", to: "/app/clients" },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Billing & usage", to: "/app/billing" },
      { label: "Account & security", to: "/app/account" },
      { label: "Help & support", to: "/app/support" },
    ],
  },
];

export const DASHBOARD_STAFF_NAV: DashboardNavItem[] = [
  { label: "Ops", to: "/app/ops", requiresOps: true },
];

export const PUBLIC_SEARCH_NAV: DashboardNavItem[] = [
  { label: "Home", to: "/" },
  { label: "Search", to: "/search", end: true },
  { label: "Pricing", to: "/#pricing" },
  { label: "Help", to: "/help" },
];

export function filterDashboardNav(
  sections: DashboardNavSection[],
  options: { showPresence: boolean; showOps: boolean },
) {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.requiresPresence && !options.showPresence) return false;
        if (item.requiresOps && !options.showOps) return false;
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);
}

/** Primary routes for the compact mobile navigation. */
export function buildDashboardMobileNav(options: { showPresence: boolean }) {
  const items: DashboardNavItem[] = [
    { label: "Overview", to: "/app", end: true },
    { label: "Search", to: "/search" },
    { label: "Watchlists", to: "/app/watchlists" },
  ];

  if (options.showPresence) {
    items.push({ label: "Presence", to: "/app/presence" });
  }

  items.push(
    { label: "Collections", to: "/app/collections" },
    { label: "Digests", to: "/app/digests" },
    { label: "Notifications", to: "/app/notifications" },
    { label: "Source access", to: "/app/source-access" },
    { label: "Account", to: "/app/account" },
  );

  return items;
}
