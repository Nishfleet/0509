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

/**
 * BL-030 — the rail is regrouped, not reduced.
 *
 * The old model shipped SIX mono section labels over sixteen destinations in
 * one flat list: more label than content, and the labels ate the vertical
 * space that would otherwise give the rail any hierarchy. The concept v4 rail
 * carries the eight daily jobs ungrouped and sentence-cased, then one
 * disclosure row — "Workspace & account" — holding the seven long-dwell
 * settings routes. Nine visible rows instead of sixteen, and every route in
 * `app/routes.ts` is still one click or one disclosure away.
 */
export const DASHBOARD_PRIMARY_NAV: DashboardNavSection[] = [
  {
    items: [
      { label: "Overview", to: "/app", end: true },
      { label: "Competitors", to: "/app/watchlists" },
      { label: "Presence", to: "/app/presence", requiresPresence: true },
      { label: "Search", to: "/search" },
      { label: "Briefs", to: "/app/digests" },
      { label: "Collections", to: "/app/collections" },
      { label: "Reports", to: "/app/reports" },
      { label: "Shared links", to: "/app/shares" },
      { label: "Client rooms", to: "/app/clients" },
    ],
  },
];

/** The seven long-dwell settings routes, behind the one disclosure row. */
export const DASHBOARD_SETTINGS_NAV: DashboardNavSection[] = [
  {
    items: [
      { label: "Notifications", to: "/app/notifications" },
      { label: "Source access", to: "/app/source-access" },
      { label: "Developer access", to: "/app/developer-access" },
      { label: "Team", to: "/app/team" },
      { label: "Billing & usage", to: "/app/billing" },
      { label: "Account & security", to: "/app/account" },
      { label: "Help & support", to: "/app/support" },
    ],
  },
];

/** Pathnames that live inside the "Workspace & account" disclosure. */
export function isSettingsNavPath(pathname: string) {
  return DASHBOARD_SETTINGS_NAV.some((section) =>
    section.items.some(
      (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
    ),
  );
}

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

/**
 * BL-042 — one mobile route row, sourced from the same IA as the desktop rail.
 *
 * The previous helper maintained a second hand-written route list while the
 * shell appended Team, Client rooms, Support and Billing from a third list.
 * That produced duplicate navigation models and made some destinations look
 * like boxed utilities rather than peers. Flattening the canonical groups
 * keeps every entitled destination reachable exactly once.
 */
export function buildDashboardMobileNav(options: {
  showPresence: boolean;
  showOps?: boolean;
}) {
  const visible = {
    showPresence: options.showPresence,
    showOps: options.showOps ?? false,
  };
  const primary = filterDashboardNav(DASHBOARD_PRIMARY_NAV, visible).flatMap(
    (section) => section.items,
  );
  const settings = filterDashboardNav(DASHBOARD_SETTINGS_NAV, visible).flatMap(
    (section) => section.items,
  );
  const staff = DASHBOARD_STAFF_NAV.filter(
    (item) => !item.requiresOps || visible.showOps,
  );

  return [...primary, ...settings, ...staff];
}
