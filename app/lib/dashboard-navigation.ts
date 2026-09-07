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
  /** Member pages this destination owns — the row stays active on them. */
  activePaths?: readonly string[];
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
/**
 * Design-unification PR-5a — the ratified 5-destination IA (tri-audit,
 * Nish 2026-08-08). Five customer jobs, no disclosure, nothing in the rail
 * a customer's plan cannot use. Search is the ⌘K overlay and one rail
 * button, not a destination. Deliver and Settings are sectioned index
 * pages that own the surfaces the old 16-row rail advertised; the deep
 * per-destination rebuilds land as the follow-on PR-5 packages.
 */
export const DASHBOARD_PRIMARY_NAV: DashboardNavSection[] = [
  {
    items: [
      { label: "Today", to: "/app", end: true },
      {
        label: "Watch",
        to: "/app/watchlists",
        activePaths: ["/app/presence"],
      },
      { label: "Library", to: "/app/collections" },
      {
        label: "Deliver",
        to: "/app/deliver",
        activePaths: ["/app/digests", "/app/reports", "/app/shares", "/app/clients"],
      },
      {
        label: "Settings",
        to: "/app/settings",
        activePaths: [
          "/app/notifications",
          "/app/source-access",
          "/app/developer-access",
          "/app/team",
          "/app/billing",
          "/app/account",
          "/app/support",
        ],
      },
    ],
  },
];

/**
 * Routes that now live INSIDE a destination (Deliver or Settings). Kept as
 * a map so the rail can mark the owning destination active while the
 * customer is on one of its member pages.
 */
export const DASHBOARD_SETTINGS_NAV: DashboardNavSection[] = [
  {
    items: [
      { label: "Delivery", to: "/app/notifications" },
      { label: "Source access", to: "/app/source-access" },
      { label: "Developer access", to: "/app/developer-access" },
      { label: "Team", to: "/app/team" },
      { label: "Billing & usage", to: "/app/billing" },
      { label: "Account & security", to: "/app/account" },
      { label: "Help & support", to: "/app/support" },
    ],
  },
];

/**
 * The ONE member-page ownership resolver — desktop rail and mobile strip
 * both use it, so a destination can never be active on one and idle on the
 * other (Sol, wave-2).
 */
export function isDestinationMemberActive(
  item: DashboardNavItem,
  pathname: string,
): boolean {
  return Boolean(
    item.activePaths?.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    ),
  );
}

/** Member pages of the Deliver destination. */
export const DELIVER_MEMBER_PATHS = [
  "/app/digests",
  "/app/reports",
  "/app/shares",
  "/app/clients",
] as const;

/** Pathnames that live inside the "Workspace & account" disclosure. */
export function isSettingsNavPath(pathname: string) {
  return DASHBOARD_SETTINGS_NAV.some((section) =>
    section.items.some(
      (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
    ),
  );
}

export const PUBLIC_SEARCH_NAV: DashboardNavItem[] = [
  { label: "Home", to: "/" },
  { label: "Search", to: "/search", end: true },
  { label: "Compare", to: "/compare" },
  { label: "Pricing", to: "/pricing" },
  { label: "Help", to: "/help" },
];

export const PUBLIC_SEARCH_FOOTER: DashboardNavItem[] = [
  { label: "Docs", to: "/docs" },
  { label: "Sign in", to: "/auth/login" },
  { label: "Sign up", to: "/auth/signup" },
];

export function filterDashboardNav(
  sections: DashboardNavSection[],
  options: { showPresence: boolean },
) {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.requiresPresence && !options.showPresence) return false;
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
}) {
  const visible = { showPresence: options.showPresence };
  const primary = filterDashboardNav(DASHBOARD_PRIMARY_NAV, visible).flatMap(
    (section) => section.items,
  );

  // Five destinations fit a phone without a scroll of sixteen peers; the
  // member pages live inside Deliver/Settings, not in the strip.
  return [...primary];
}
