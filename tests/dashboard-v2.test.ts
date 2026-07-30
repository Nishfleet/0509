import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DashboardShell } from "~/components/dashboard-shell";
import {
  DASHBOARD_PRIMARY_NAV,
  DASHBOARD_SETTINGS_NAV,
  buildDashboardMobileNav,
  filterDashboardNav,
} from "~/lib/dashboard-navigation";
import { mapCustomerRouteError } from "~/lib/customer-route-error";

const appLayout = readFileSync("app/routes/app-layout.tsx", "utf8");
const routeConfig = readFileSync("app/routes.ts", "utf8");
const searchRoute = readFileSync("app/routes/search.tsx", "utf8");
const notificationsUiRoute = readFileSync("app/routes/app.notifications.ui.tsx", "utf8");
const dashboardRoute = readFileSync("app/routes/app.dashboard.tsx", "utf8");
const shellSource = readFileSync("app/components/dashboard-shell.tsx", "utf8");
const appCss = readFileSync("app/app.css", "utf8");

const PRIMARY_APP_ROUTE_FILES = readdirSync("app/routes").filter(
  (name) =>
    name.startsWith("app.") &&
    name.endsWith(".tsx") &&
    name !== "app-layout.tsx" &&
    name !== "app.onboard.tsx",
);

/**
 * BL-030 regrouped the rail: the six mono section labels are gone (six labels
 * over sixteen destinations read as soup), the daily jobs are one ungrouped
 * list, and the seven long-dwell settings routes sit behind one disclosure.
 * The guarantee these cases carry is unchanged — every customer destination
 * still maps to exactly one path, and it is still reachable from the rail.
 */
const CUSTOMER_NAV_CASES = [
  { label: "Competitors", path: "/app/watchlists", group: "primary" },
  { label: "Briefs", path: "/app/digests", group: "primary" },
  { label: "Reports", path: "/app/reports", group: "primary" },
  { label: "Shared links", path: "/app/shares", group: "primary" },
  { label: "Client rooms", path: "/app/clients", group: "primary" },
  { label: "Billing & usage", path: "/app/billing", group: "settings" },
  { label: "Account & security", path: "/app/account", group: "settings" },
] as const;

describe("dashboard v2 navigation", () => {
  it.each(CUSTOMER_NAV_CASES)("maps $label to $path in the $group rail", ({ label, path, group }) => {
    const sections = group === "primary" ? DASHBOARD_PRIMARY_NAV : DASHBOARD_SETTINGS_NAV;
    const items = sections.flatMap((section) => section.items);
    expect(items).toContainEqual(expect.objectContaining({ label, to: path }));
    const other = group === "primary" ? DASHBOARD_SETTINGS_NAV : DASHBOARD_PRIMARY_NAV;
    expect(other.flatMap((section) => section.items).map((item) => item.to)).not.toContain(path);
  });

  it("keeps the rail to nine visible rows: eight daily jobs plus one disclosure", () => {
    const visible = filterDashboardNav(DASHBOARD_PRIMARY_NAV, {
      showPresence: false,
      showOps: false,
    }).flatMap((section) => section.items);
    expect(visible).toHaveLength(8);
    // Every section is ungrouped: no mono label may reappear above a row.
    expect(DASHBOARD_PRIMARY_NAV.every((section) => section.title === undefined)).toBe(true);
    expect(DASHBOARD_SETTINGS_NAV.every((section) => section.title === undefined)).toBe(true);
    // The disclosure holds the seven long-dwell settings routes.
    expect(DASHBOARD_SETTINGS_NAV.flatMap((section) => section.items)).toHaveLength(7);
  });

  it("exposes the unified customer IA", () => {
    const labels = [
      ...DASHBOARD_PRIMARY_NAV.flatMap((section) => section.items.map((item) => item.label)),
      ...DASHBOARD_SETTINGS_NAV.flatMap((section) => section.items.map((item) => item.label)),
    ];

    expect(labels).toContain("Overview");
    expect(labels).toContain("Search");
    expect(labels).toContain("Competitors");
    expect(labels).toContain("Collections");
    expect(labels).toContain("Briefs");
    expect(labels).toContain("Reports");
    expect(labels).toContain("Shared links");
    expect(labels).toContain("Client rooms");
    expect(labels).toContain("Notifications");
    expect(labels).toContain("Source access");
    expect(labels).toContain("Developer access");
    expect(labels).not.toContain("Boards");
    expect(labels).not.toContain("Watchlists");
    expect(labels).not.toContain("Digests");
  });

  it.each([
    { label: "Competitors", path: "/app/watchlists" },
    { label: "Briefs", path: "/app/digests" },
    { label: "Reports", path: "/app/reports" },
    { label: "Shared links", path: "/app/shares" },
  ] as const)("keeps $label reachable on mobile at $path", ({ label, path }) => {
    expect(buildDashboardMobileNav({ showPresence: false })).toContainEqual(
      expect.objectContaining({ label, to: path }),
    );
  });

  it("keeps every entitled desktop destination reachable exactly once on mobile", () => {
    const expected = [
      ...filterDashboardNav(DASHBOARD_PRIMARY_NAV, {
        showPresence: true,
        showOps: true,
      }).flatMap((section) => section.items),
      ...filterDashboardNav(DASHBOARD_SETTINGS_NAV, {
        showPresence: true,
        showOps: true,
      }).flatMap((section) => section.items),
      { label: "Ops", to: "/app/ops", requiresOps: true },
    ];
    const mobile = buildDashboardMobileNav({
      showOps: true,
      showPresence: true,
    });

    expect(mobile.map((item) => item.to)).toEqual(expected.map((item) => item.to));
    expect(new Set(mobile.map((item) => item.to)).size).toBe(mobile.length);
  });

  it("hides presence nav unless entitled", () => {
    const without = filterDashboardNav(DASHBOARD_PRIMARY_NAV, { showPresence: false, showOps: false });
    const withPresence = filterDashboardNav(DASHBOARD_PRIMARY_NAV, { showPresence: true, showOps: false });

    expect(without.flatMap((s) => s.items).some((item) => item.label === "Presence")).toBe(false);
    expect(withPresence.flatMap((s) => s.items).some((item) => item.label === "Presence")).toBe(true);
  });
});

describe("dashboard v2 shell", () => {
  it("uses DashboardShell in layout and search", () => {
    expect(appLayout).toContain("DashboardShell");
    expect(searchRoute).toContain("DashboardShell");
    expect(appLayout).not.toContain("f9-app-shell");
    expect(shellSource).toContain("f9-cursor-shell");
    expect(shellSource).toContain("f9-dash-page");
    expect(shellSource).toContain("f9-dash-page-app");
    expect(shellSource).toContain("f9-dash-page-public");
    expect(shellSource).toContain("f9-dash-nav-group");
  });

  it("keeps narrow authenticated navigation in page flow", () => {
    expect(appCss).not.toMatch(/\.f9-cursor-main\s*\{[^}]*order:\s*1/s);
    expect(shellSource).toContain("f9-dash-mobile-nav");
    expect(shellSource).not.toContain("f9-dash-mobile-context");
    expect(shellSource).not.toContain("f9-dash-mobile-utility");
    expect(shellSource).not.toContain("Swipe for more");
    expect(shellSource).toContain('aria-label="Workspace sections"');
    expect(shellSource).toContain('a[aria-current="page"]');
    expect(appCss).toContain(".f9-dash-page-app .f9-dash-mobile-nav");
    expect(appCss).toContain(".f9-dash-page-app .f9-dash-nav-group");
    expect(appCss).not.toContain(".f9-cursor-rail > div:not(");
    expect(appCss).not.toMatch(/\.f9-dash(?:-page-app)?\s+\.f9-dash-mobile-nav\s*\{[^}]*position:\s*fixed/s);
    expect(shellSource.indexOf('className="f9-dash-mobile-nav"')).toBeLessThan(
      shellSource.indexOf('className="f9-cursor-main"'),
    );
  });

  it("wraps primary app routes in DashboardPage except staff ops", () => {
    const wrapperRoutes = new Set([
      "app.developer-access.tsx",
      "app.source-access.tsx",
    ]);
    const missing = PRIMARY_APP_ROUTE_FILES.filter((file) => {
      if (file === "app.ops.tsx") return false;
      if (wrapperRoutes.has(file)) return false;
      const source = readFileSync(join("app/routes", file), "utf8");
      return !source.includes("DashboardPage");
    });

    expect(missing).toEqual([]);
  });

  it("does not duplicate legacy sidebar markup in layout", () => {
    expect(appLayout).not.toContain("f9-app-sidebar");
    expect(appLayout).not.toContain("BrandWordmark");
  });

  it("keeps intuitive app aliases away from the 404 route", () => {
    expect(routeConfig).toContain('route("notifications", "routes/app.notifications.ts")');
    expect(routeConfig).toContain('route("source-access", "routes/app.source-access.tsx")');
    expect(routeConfig).toContain('route("developer-access", "routes/app.developer-access.tsx")');
    expect(routeConfig).toContain('route("reports", "routes/app.reports.index.ts")');
  });
});

describe("dashboard v2 leakage guards", () => {
  it("removes agent action catalog from notifications page", () => {
    expect(notificationsUiRoute).not.toContain("auditedAgentActionGroups");
    expect(notificationsUiRoute).not.toContain("AGENT_BLOCKED_CAPABILITIES");
    expect(notificationsUiRoute).toContain("Notifications");
  });

  it("keeps overview customer-oriented", () => {
    expect(dashboardRoute).not.toContain("listAgentMemory");
    expect(dashboardRoute).not.toContain("agentMemories");
    expect(dashboardRoute).toContain("Responses waiting on you");
    expect(dashboardRoute).not.toContain("counter-move brief");
  });
});

describe("customer route errors", () => {
  it("maps 404 responses for customers", () => {
    expect(mapCustomerRouteError(new Response(null, { status: 404 }))).toMatchObject({
      title: "Not found",
      retryable: false,
    });
  });

  it("maps generic failures as retryable", () => {
    expect(mapCustomerRouteError(new Error("timeout"))).toMatchObject({
      retryable: true,
    });
  });
});

describe("dashboard shell render", () => {
  it("exports a shell component with rail and main regions", () => {
    expect(DashboardShell).toBeTypeOf("function");
    expect(shellSource).toContain('aria-label="Application"');
    expect(shellSource).toContain("f9-cursor-main");
  });

  it("keeps signed-in mobile utility support in-app", () => {
    const mobile = buildDashboardMobileNav({ showPresence: false });
    expect(mobile).toContainEqual(
      expect.objectContaining({ label: "Help & support", to: "/app/support" }),
    );
    expect(mobile).toContainEqual(
      expect.objectContaining({ label: "Billing & usage", to: "/app/billing" }),
    );
  });
});
