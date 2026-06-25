import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DashboardShell } from "~/components/dashboard-shell";
import {
  DASHBOARD_PRIMARY_NAV,
  DASHBOARD_SETTINGS_NAV,
  filterDashboardNav,
} from "~/lib/dashboard-navigation";
import { mapCustomerRouteError } from "~/lib/customer-route-error";

const appLayout = readFileSync("app/routes/app-layout.tsx", "utf8");
const searchRoute = readFileSync("app/routes/search.tsx", "utf8");
const sourcesRoute = readFileSync("app/routes/app.sources.tsx", "utf8");
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

describe("dashboard v2 navigation", () => {
  it("exposes the unified customer IA", () => {
    const labels = [
      ...DASHBOARD_PRIMARY_NAV.flatMap((section) => section.items.map((item) => item.label)),
      ...DASHBOARD_SETTINGS_NAV.flatMap((section) => section.items.map((item) => item.label)),
    ];

    expect(labels).toContain("Overview");
    expect(labels).toContain("Search");
    expect(labels).toContain("Collections");
    expect(labels).toContain("Digests");
    expect(labels).toContain("Reports");
    expect(labels).toContain("Notifications");
    expect(labels).not.toContain("Boards");
    expect(labels).not.toContain("Briefs");
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
  });

  it("does not reorder main content above rail on mobile", () => {
    expect(appCss).not.toMatch(/\.f9-cursor-main\s*\{[^}]*order:\s*1/s);
    expect(shellSource).toContain("f9-dash-mobile-nav");
  });

  it("wraps primary app routes in DashboardPage except staff ops", () => {
    const missing = PRIMARY_APP_ROUTE_FILES.filter((file) => {
      if (file === "app.ops.tsx") return false;
      const source = readFileSync(join("app/routes", file), "utf8");
      return !source.includes("DashboardPage");
    });

    expect(missing).toEqual([]);
  });

  it("does not duplicate legacy sidebar markup in layout", () => {
    expect(appLayout).not.toContain("f9-app-sidebar");
    expect(appLayout).not.toContain("BrandWordmark");
  });
});

describe("dashboard v2 leakage guards", () => {
  it("removes agent action catalog from notifications page", () => {
    expect(sourcesRoute).not.toContain("auditedAgentActionGroups");
    expect(sourcesRoute).not.toContain("AGENT_BLOCKED_CAPABILITIES");
    expect(sourcesRoute).toContain("Notifications");
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
});
