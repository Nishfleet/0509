/**
 * Dashboard — single customer navigation model (route diet phase 1, #2213).
 * Customer jobs, not backend modules.
 */

import { MARKETING_PRIMARY_LINKS } from "~/components/marketing-nav";

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
 * Route diet phase 1 (#2213) — the 8-screen model, 7 static rail rows.
 *
 * The old IA shipped five destinations (Today / Watch / Library / Deliver /
 * Settings) with every member route living inside Deliver or Settings. The
 * ratified route diet collapses the workspace to eight screens and folds the
 * member pages into them via redirects:
 *
 *   /app            Competitors (today's dashboard)
 *   /app/c/:id      Competitor (drill-in — evidence, source status, share)
 *   /app/briefs     Briefs
 *   /app/account    Account & Billing
 *   /app/team       Team
 *   /app/api        API
 *   /app/settings   Settings (notifications/sources fold in via #hash)
 *   /app/help       Help
 *
 * The rail shows the SEVEN static destinations a logged-in user sees in the
 * nav for those eight screens. `/app/c/:id` is a drill-in (opened from the
 * Competitors list row), NOT a rail row, so it never appears in the rail. All
 * seven rows live in one ungrouped list — no section titles, no disclosure.
 * old folded member pages (watchlists, digests, shares, reports, billing,
 * support, source-access, developer-access, notifications, sources,
 * presence...) 302 to their new home, so the rail only needs the rows above
 * and every fold is still one click from its owning destination.
 */
export const DASHBOARD_PRIMARY_NAV: DashboardNavSection[] = [
  {
    items: [
      {
        label: "Competitors",
        to: "/app",
        end: true,
        // /app/c/:id (the drill-in), the old /app/watchlists* board/fold
        // routes, collections (its "Pinned" section lives here) and presence:
        // the row stays lit while a competitor is open.
        activePaths: ["/app/c", "/app/watchlists", "/app/presence", "/app/collections"],
      },
      {
        label: "Briefs",
        to: "/app/briefs",
        // The whole delivery family folded here.
        activePaths: [
          "/app/digests",
          "/app/clients",
          "/app/deliver",
          "/app/shares",
          "/app/reports",
        ],
      },
      {
        label: "Account & Billing",
        to: "/app/account",
        activePaths: ["/app/billing"],
      },
      { label: "Team", to: "/app/team" },
      {
        label: "API",
        to: "/app/api",
        activePaths: ["/app/developer-access"],
      },
      {
        label: "Settings",
        to: "/app/settings",
        // Folded settings homes land on /app/settings via #hash redirects.
        activePaths: ["/app/notifications", "/app/source-access", "/app/sources"],
      },
      { label: "Help", to: "/app/help", activePaths: ["/app/support"] },
    ],
  },
];

/**
 * The ONE member-page ownership resolver — desktop rail and mobile strip
 * both use it, so a destination can never be active on one and idle on the
 * other.
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

/**
 * The one shared public destination list, consumed from MarketingNav so the
 * /search rail and the landing header can never drift (issue #2324). Home is
 * intentionally absent: the brand wordmark/account block is Home.
 */
export const PUBLIC_SEARCH_NAV: DashboardNavItem[] = MARKETING_PRIMARY_LINKS.map(
  (link) => ({
    label: link.label,
    to: link.to,
    end: link.to === "/search",
  }),
);
export const PUBLIC_SEARCH_FOOTER: DashboardNavItem[] = [
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
 * One mobile route row, sourced from the same IA as the desktop rail.
 * Route diet phase 1: the strip returns the same 7 destinations as the rail,
 * so a destination is never active on the rail but idle in the strip.
 */
export function buildDashboardMobileNav(options: {
  showPresence: boolean;
}) {
  const visible = { showPresence: options.showPresence };
  const primary = filterDashboardNav(DASHBOARD_PRIMARY_NAV, visible).flatMap(
    (section) => section.items,
  );
  return [...primary];
}