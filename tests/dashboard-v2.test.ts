import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DashboardShell } from "~/components/dashboard-shell";
import {
  DASHBOARD_PRIMARY_NAV,
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
// app.css split in issue #2392: the /app workspace loads base.css + app.css.
const appCss = ["app/base.css", "app/app.css"]
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");

const PRIMARY_APP_ROUTE_FILES = readdirSync("app/routes").filter(
  (name) =>
    name.startsWith("app.") &&
    name.endsWith(".tsx") &&
    name !== "app-layout.tsx" &&
    name !== "app.onboard.tsx",
);

/**
 * Route diet phase 1 (#2213) — the 8-screen model, 7 static rail rows.
 * The rail shows the seven destinations a logged-in user sees in the nav
 * for the eight screens; `/app/c/:id` is a drill-in, not a rail row. All
 * member routes fold into a destination via redirects, so a folded route
 * keeps its owning destination's rail row active via activePaths.
 */
const CUSTOMER_NAV_CASES = [
  { label: "Competitors", path: "/app" },
  { label: "Briefs", path: "/app/briefs" },
  { label: "Account & Billing", path: "/app/account" },
  { label: "Team", path: "/app/team" },
  { label: "API", path: "/app/api" },
  { label: "Settings", path: "/app/settings" },
  { label: "Help", path: "/app/help" },
] as const;

describe("dashboard navigation (route diet phase 1)", () => {
  it.each(CUSTOMER_NAV_CASES)("maps $label to $path in the rail", ({ label, path }) => {
    const items = DASHBOARD_PRIMARY_NAV.flatMap((section) => section.items);
    expect(items).toContainEqual(expect.objectContaining({ label, to: path }));
  });

  it("keeps the rail to seven destinations — the 8-screen route diet", () => {
    const visible = filterDashboardNav(DASHBOARD_PRIMARY_NAV, {
      showPresence: false,
    }).flatMap((section) => section.items);
    expect(visible).toHaveLength(7);
    // Every section is ungrouped: no mono label may reappear above a row.
    expect(DASHBOARD_PRIMARY_NAV.every((section) => section.title === undefined)).toBe(true);
    // Seven rows in one group — the Settings disclosure constant is gone.
    expect(DASHBOARD_PRIMARY_NAV).toHaveLength(1);
  });

  it("exposes the 8-screen model and retires the row soup", () => {
    const primaryLabels = DASHBOARD_PRIMARY_NAV.flatMap((section) =>
      section.items.map((item) => item.label),
    );
    expect(primaryLabels).toEqual([
      "Competitors", "Briefs", "Account & Billing", "Team", "API", "Settings",
      "Help",
    ]);
    // Old destinations survive as URLs owned by a destination, never as rows.
    for (const retired of [
      "Today", "Watch", "Library", "Deliver", "Presence", "Search",
      "Collections", "Reports", "Shared links", "Client rooms",
    ]) {
      expect(primaryLabels).not.toContain(retired);
    }
    const competitors = DASHBOARD_PRIMARY_NAV[0].items.find(
      (item) => item.label === "Competitors",
    );
    expect(competitors?.activePaths).toContain("/app/c");
    expect(competitors?.activePaths).toContain("/app/watchlists");
    expect(competitors?.activePaths).toContain("/app/presence");
    const briefs = DASHBOARD_PRIMARY_NAV[0].items.find((item) => item.label === "Briefs");
    expect(briefs?.activePaths).toEqual([
      "/app/digests", "/app/clients", "/app/deliver", "/app/shares", "/app/reports",
    ]);
    const settings = DASHBOARD_PRIMARY_NAV[0].items.find((item) => item.label === "Settings");
    expect(settings?.activePaths).toContain("/app/notifications");
    expect(settings?.activePaths).toContain("/app/source-access");
    expect(settings?.activePaths).not.toContain("/app/billing");
    expect(settings?.activePaths).not.toContain("/app/team");
  });

  it.each(CUSTOMER_NAV_CASES)(
    "keeps $label reachable on mobile at $path",
    ({ label, path }) => {
      expect(buildDashboardMobileNav({ showPresence: false })).toContainEqual(
        expect.objectContaining({ label, to: path }),
      );
    },
  );

  it("keeps mobile to the same seven destinations as the rail", () => {
    const mobile = buildDashboardMobileNav({ showPresence: true });
    expect(mobile.map((item) => item.label)).toEqual([
      "Competitors", "Briefs", "Account & Billing", "Team", "API",
      "Settings", "Help",
    ]);
    expect(new Set(mobile.map((item) => item.to)).size).toBe(mobile.length);
  });

  it("the Competitor detail is a drill-in, never a rail row", () => {
    const labels = DASHBOARD_PRIMARY_NAV.flatMap((section) =>
      section.items.map((item) => item.label),
    );
    // `/app/c/:id` is reached by opening a competitor, not from a row.
    expect(labels).not.toContain("Competitor");
    const competitors = DASHBOARD_PRIMARY_NAV[0].items.find(
      (item) => item.label === "Competitors",
    );
    expect(competitors?.activePaths).toContain("/app/c");
  });

  it("presence is never a rail row — the drill-in owns /app/presence", () => {
    const withPresence = filterDashboardNav(DASHBOARD_PRIMARY_NAV, { showPresence: true });
    expect(withPresence.flatMap((s) => s.items).some((item) => item.label === "Presence")).toBe(false);
    const competitors = DASHBOARD_PRIMARY_NAV[0].items.find(
      (item) => item.label === "Competitors",
    );
    expect(competitors?.activePaths).toContain("/app/presence");
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
    // Route diet phase 1 (#2213): folded routes are now redirect stubs that
    // render nothing, so they are excluded the same way ops is. The new
    // destinations (app.c.$id, app.briefs, app.help, app.settings, ...) keep
    // DashboardPage; app.api re-exports the unlocked UI like
    // app.developer-access did.
    const wrapperRoutes = new Set([
      // Pure redirect stubs (route diet phase 1, #2213).
      "app.collections.tsx",
      "app.deliver.tsx",
      "app.clients.tsx",
      "app.shares.tsx",
      "app.billing.tsx",
      "app.support.tsx",
      "app.digests.tsx",
      "app.presence.tsx",
      "app.presence.$entityId.tsx",
      "app.reports.tsx",
      "app.source-access.tsx",
      "app.developer-access.tsx",
      "app.watchlists.$watchlistId.tsx",
      // UI-shell re-exports / pure redirects.
      "app.sources.tsx",
      "app.api.tsx",
      // Re-exports the board's own detail screen (route diet phase 1, #2213).
      "app.c.$id.tsx",
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

  it("keeps signed-in utilities one hop from their owning rail row", () => {
    // Route diet phase 1: billing folds into Account & Billing, support
    // into Help, and notifications/sources into Settings — each one hop from
    // its owning row, never a peer in the strip.
    const account = DASHBOARD_PRIMARY_NAV[0].items.find(
      (item) => item.label === "Account & Billing",
    );
    expect(account?.activePaths).toContain("/app/billing");
    const help = DASHBOARD_PRIMARY_NAV[0].items.find((item) => item.label === "Help");
    expect(help?.activePaths).toContain("/app/support");
    const settings = DASHBOARD_PRIMARY_NAV[0].items.find((item) => item.label === "Settings");
    expect(settings?.activePaths).toContain("/app/notifications");
    expect(settings?.activePaths).toContain("/app/source-access");
    const mobile = buildDashboardMobileNav({ showPresence: false });
    expect(mobile.map((item) => item.label)).toContain("Settings");
    expect(mobile.map((item) => item.label)).toContain("Account & Billing");
    expect(mobile.map((item) => item.label)).toContain("Help");
  });
});
