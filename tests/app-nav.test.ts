import { describe, expect, it } from "vitest";

import {
  DASHBOARD_PRIMARY_NAV,
  buildDashboardMobileNav,
  filterDashboardNav,
} from "~/lib/dashboard-navigation";

/**
 * Route diet phase 1 (Nishfleet/0509#2213) — the 8-screen model.
 *
 * A logged-in user sees SEVEN rail rows covering EIGHT screens. The eighth,
 * `/app/c/:id`, is the competitor drill-in opened from the Competitors list,
 * so it is never a rail row. The Settings disclosure is gone: every folded
 * member route either 302s to its owning destination or is still reachable
 * from the destination's own page.
 */
const RAIL_ROWS = [
  { label: "Competitors", to: "/app" },
  { label: "Briefs", to: "/app/briefs" },
  { label: "Account & Billing", to: "/app/account" },
  { label: "Team", to: "/app/team" },
  { label: "API", to: "/app/api" },
  { label: "Settings", to: "/app/settings" },
  { label: "Help", to: "/app/help" },
] as const;

const DESTINATION_PATHS = [
  "/app",
  "/app/c/:id",
  "/app/briefs",
  "/app/account",
  "/app/team",
  "/app/api",
  "/app/settings",
  "/app/help",
] as const;

describe("route diet phase 1 navigation", () => {
  it("renders exactly seven rail rows", () => {
    expect(filterDashboardNav(DASHBOARD_PRIMARY_NAV, { showPresence: false })).toHaveLength(1);
    expect(DASHBOARD_PRIMARY_NAV.flatMap((section) => section.items)).toHaveLength(7);
  });

  it.each(RAIL_ROWS)("maps $label to $to", ({ label, to }) => {
    expect(DASHBOARD_PRIMARY_NAV.flatMap((section) => section.items)).toContainEqual(
      expect.objectContaining({ label, to }),
    );
  });

  it("keeps the seven labels in one ungrouped list", () => {
    expect(
      DASHBOARD_PRIMARY_NAV.flatMap((section) => section.items).map((item) => item.label),
    ).toEqual(RAIL_ROWS.map((row) => row.label));
    expect(DASHBOARD_PRIMARY_NAV.every((section) => section.title === undefined)).toBe(true);
  });

  it("does not put the competitor drill-in in the rail", () => {
    const paths = DASHBOARD_PRIMARY_NAV.flatMap((section) => section.items).map(
      (item) => item.to,
    );
    expect(paths).not.toContain("/app/c/:id");
    expect(paths.filter((path) => path.startsWith("/app/c"))).toEqual([]);
  });

  it("keeps the Competitors row lit on the drill-in and on folded member paths", () => {
    const competitors = DASHBOARD_PRIMARY_NAV.flatMap((section) => section.items).find(
      (item) => item.label === "Competitors",
    );
    expect(competitors?.activePaths).toContain("/app/c");
    expect(competitors?.activePaths).toContain("/app/watchlists");
    expect(competitors?.activePaths).toContain("/app/presence");
  });

  it("keeps every destination reachable from the mobile strip", () => {
    const mobile = buildDashboardMobileNav({ showPresence: false });
    for (const row of RAIL_ROWS) {
      expect(mobile).toContainEqual(expect.objectContaining({ label: row.label, to: row.to }));
    }
    expect(mobile).toHaveLength(7);
  });

  it("covers the eight screens with seven rows", () => {
    const rows = DASHBOARD_PRIMARY_NAV.flatMap((section) => section.items);
    expect(DESTINATION_PATHS).toHaveLength(8);
    expect(rows).toHaveLength(DESTINATION_PATHS.length - 1);
    for (const path of DESTINATION_PATHS) {
      if (path === "/app/c/:id") continue;
      expect(rows.map((row) => row.to)).toContain(path);
    }
  });
});
