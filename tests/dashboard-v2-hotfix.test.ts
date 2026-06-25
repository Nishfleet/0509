import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  mapCustomerRouteError,
  sanitizeCustomerFacingMessage,
} from "~/lib/customer-route-error";
import { agencyCheckoutHeldCustomerCopy } from "~/lib/customer-billing-copy";
import { buildDashboardMobileNav } from "~/lib/dashboard-navigation";

const appLayout = readFileSync("app/routes/app-layout.tsx", "utf8");
const appCss = readFileSync("app/app.css", "utf8");
const shellSource = readFileSync("app/components/dashboard-shell.tsx", "utf8");
const readinessSource = readFileSync("app/lib/workspace-readiness.server.ts", "utf8");
const watchlistsSource = readFileSync("app/routes/app.watchlists.tsx", "utf8");
const accountSource = readFileSync("app/routes/app.account.tsx", "utf8");
const billingSource = readFileSync("app/routes/app.billing.tsx", "utf8");
const statusSource = readFileSync("app/routes/status.tsx", "utf8");

describe("dashboard v2 production hotfix", () => {
  it("uses fixed bottom mobile navigation instead of reordering main above rail", () => {
    expect(shellSource).toContain("f9-dash-mobile-nav");
    expect(shellSource).toContain("f9-dash-mobile-utility");
    expect(appCss).not.toMatch(/\.f9-cursor-main\s*\{[^}]*order:\s*1/s);
    expect(appCss).toContain("f9-cursor-rail-desktop");
    expect(buildDashboardMobileNav({ showPresence: true }).map((item) => item.label)).toEqual([
      "Overview",
      "Search",
      "Watchlists",
      "Presence",
      "Collections",
      "Digests",
      "Notifications",
      "Account",
    ]);
  });

  it("removes duplicate search topbar CTAs", () => {
    const searchLinks = appLayout.match(/to="\/search"/g) ?? [];
    expect(searchLinks).toHaveLength(1);
    expect(appLayout).toContain('to="/app"');
    expect(appLayout).toContain("Overview");
  });

  it("removes internal and MCP leakage from customer surfaces", () => {
    expect(readinessSource).not.toContain("MCP agent context");
    expect(accountSource).not.toContain("Better Auth");
    expect(billingSource).not.toContain("internal workspace");
    expect(statusSource).not.toContain("internal workspace");
    expect(agencyCheckoutHeldCustomerCopy()).not.toContain("internal workspace");
    expect(watchlistsSource).not.toContain("Web mentions");
  });

  it("restores scoped public brand styling without legacy shell", () => {
    expect(appCss).toContain(".f9-app-brand");
    expect(appCss).not.toContain(".f9-app-shell");
  });
});

describe("customer route error hotfix sanitization", () => {
  it.each([
    '{"code":"D1_ERROR","message":"SQLITE_BUSY"}',
    "Error: at Object.loader (/app/routes/app.tsx:12:3)",
    "user_id=8f3b2f1a-1111-4222-8333-abcdef012345 failed",
    "BROWSER binding unavailable",
  ])("redacts %s", (message) => {
    expect(sanitizeCustomerFacingMessage(message)).not.toContain("D1");
    expect(sanitizeCustomerFacingMessage(message)).not.toContain("SQLITE");
    expect(sanitizeCustomerFacingMessage(message)).not.toContain("binding");
    expect(sanitizeCustomerFacingMessage(message)).not.toMatch(/8f3b2f1a-1111-4222-8333-abcdef012345/);
  });

  it("maps plan limits distinctly from permission errors", () => {
    expect(mapCustomerRouteError(new Response(null, { status: 403 }))).toMatchObject({
      category: "permission",
    });
    expect(mapCustomerRouteError(new Response(null, { status: 402 }))).toMatchObject({
      category: "plan_limit",
    });
  });
});
