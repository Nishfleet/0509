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
 * PR-5a — the ratified 5-destination IA (design-unification, Nish
 * 2026-08-08). Five customer jobs in the rail, no disclosure, and nothing
 * advertised that the plan cannot use. Member pages stay URL-reachable and
 * keep their owning destination's rail row active via activePaths.
 */
const CUSTOMER_NAV_CASES = [
  { label: "Today", path: "/app", group: "primary" },
  { label: "Watch", path: "/app/watchlists", group: "primary" },
  { label: "Library", path: "/app/collections", group: "primary" },
  { label: "Deliver", path: "/app/deliver", group: "primary" },
  { label: "Settings", path: "/app/settings", group: "primary" },
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

  it("keeps the rail to five destinations — the ratified IA", () => {
    const visible = filterDashboardNav(DASHBOARD_PRIMARY_NAV, {
      showPresence: false,
    }).flatMap((section) => section.items);
    expect(visible).toHaveLength(5);
    // Every section is ungrouped: no mono label may reappear above a row.
    expect(DASHBOARD_PRIMARY_NAV.every((section) => section.title === undefined)).toBe(true);
    expect(DASHBOARD_SETTINGS_NAV.every((section) => section.title === undefined)).toBe(true);
    // The disclosure holds the seven long-dwell settings routes.
    expect(DASHBOARD_SETTINGS_NAV.flatMap((section) => section.items)).toHaveLength(7);
  });

  it("exposes the unified 5-destination IA and retires the old row soup", () => {
    const primaryLabels = DASHBOARD_PRIMARY_NAV.flatMap((section) =>
      section.items.map((item) => item.label),
    );
    expect(primaryLabels).toEqual(["Today", "Watch", "Library", "Deliver", "Settings"]);
    // Old destinations survive as URLs owned by a destination, never as rows.
    for (const retired of [
      "Overview", "Competitors", "Presence", "Search", "Briefs",
      "Collections", "Reports", "Shared links", "Client rooms",
    ]) {
      expect(primaryLabels).not.toContain(retired);
    }
    const deliver = DASHBOARD_PRIMARY_NAV[0].items.find((item) => item.label === "Deliver");
    expect(deliver?.activePaths).toEqual([
      "/app/digests", "/app/reports", "/app/shares", "/app/clients",
    ]);
    const settings = DASHBOARD_PRIMARY_NAV[0].items.find((item) => item.label === "Settings");
    expect(settings?.activePaths).toContain("/app/billing");
    expect(settings?.activePaths).toContain("/app/account");
  });

  it.each([
    { label: "Today", path: "/app" },
    { label: "Watch", path: "/app/watchlists" },
    { label: "Library", path: "/app/collections" },
    { label: "Deliver", path: "/app/deliver" },
    { label: "Settings", path: "/app/settings" },
  ] as const)("keeps $label reachable on mobile at $path", ({ label, path }) => {
    expect(buildDashboardMobileNav({ showPresence: false })).toContainEqual(
      expect.objectContaining({ label, to: path }),
    );
  });

  it("keeps mobile to the five destinations — never a strip of sixteen", () => {
    // Staff ops left the customer app entirely (G4); the strip is the five
    // customer destinations for everyone.
    const mobile = buildDashboardMobileNav({ showPresence: true });
    expect(mobile.map((item) => item.label)).toEqual([
      "Today", "Watch", "Library", "Deliver", "Settings",
    ]);
    expect(new Set(mobile.map((item) => item.to)).size).toBe(mobile.length);
  });

  it("presence is never a rail row — it lives inside Watch", () => {
    // PR-5a: an entity is a tracked thing, not a parallel product. The
    // Watch board carries the doorway when the plan is entitled; the rail
    // stays five rows for everyone.
    const withPresence = filterDashboardNav(DASHBOARD_PRIMARY_NAV, { showPresence: true });
    expect(withPresence.flatMap((s) => s.items).some((item) => item.label === "Presence")).toBe(false);
    const watch = DASHBOARD_PRIMARY_NAV[0].items.find((item) => item.label === "Watch");
    expect(watch?.activePaths).toContain("/app/presence");
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
      // Pure redirect since the subtraction pass (S5) — renders nothing.
      "app.sources.tsx",
    ]);
    const missing = PRIMARY_APP_ROUTE_FILES.filter((file) => {
      if (file === "ops.tsx") return false;
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

  it("keeps signed-in mobile utilities one hop away inside Settings", () => {
    // PR-5a: support and billing are member pages of the Settings
    // destination — reachable from the mobile Settings row, not peers in
    // the strip.
    const settings = DASHBOARD_PRIMARY_NAV[0].items.find((item) => item.label === "Settings");
    expect(settings?.activePaths).toContain("/app/support");
    expect(settings?.activePaths).toContain("/app/billing");
    const mobile = buildDashboardMobileNav({ showPresence: false });
    expect(mobile.map((item) => item.label)).toContain("Settings");
  });
});
