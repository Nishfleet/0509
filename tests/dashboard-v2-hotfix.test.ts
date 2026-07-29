import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  mapCustomerRouteError,
  sanitizeCustomerFacingMessage,
} from "~/lib/customer-route-error";
import { agencyCheckoutHeldCustomerCopy } from "~/lib/customer-billing-copy";
import {
  buildDashboardMobileNav,
  DASHBOARD_PRIMARY_NAV,
  DASHBOARD_SETTINGS_NAV,
} from "~/lib/dashboard-navigation";

const appLayout = readFileSync("app/routes/app-layout.tsx", "utf8");
const appCss = readFileSync("app/app.css", "utf8");
const shellSource = readFileSync("app/components/dashboard-shell.tsx", "utf8");
const readinessSource = readFileSync("app/lib/workspace-readiness.server.ts", "utf8");
const watchlistsSource = readFileSync("app/routes/app.watchlists.tsx", "utf8");
const accountSource = readFileSync("app/routes/app.account.tsx", "utf8");
const billingSource = readFileSync("app/routes/app.billing.tsx", "utf8");
const statusSource = readFileSync("app/routes/status.tsx", "utf8");
const helpCatalog = readFileSync("app/lib/agent-action-catalog.ts", "utf8");

describe("dashboard v2 production hotfix", () => {
  it("keeps compact mobile navigation in page flow without burying the page action", () => {
    expect(shellSource).toContain("f9-dash-mobile-nav");
    expect(shellSource).toContain("f9-dash-mobile-utility");
    expect(appCss).not.toMatch(/\.f9-cursor-main\s*\{[^}]*order:\s*1/s);
    expect(appCss).toContain("f9-cursor-rail-desktop");
    expect(appCss).toMatch(
      /\.f9-dash-page-app \.f9-dash-mobile-nav\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto/s,
    );
    expect(appCss).toMatch(
      /\.f9-dash-page-app \.f9-dash-mobile-utility\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/s,
    );
    expect(buildDashboardMobileNav({ showPresence: true }).map((item) => item.label)).toEqual([
      "Overview",
      "Search",
      "Competitors",
      "Presence",
      "Collections",
      "Briefs",
      "Reports",
      "Shared links",
      "Notifications",
      "Source access",
      "Developer access",
      "Account",
    ]);
  });

  it.each([
    { label: "Competitors", path: "/app/watchlists" },
    { label: "Briefs", path: "/app/digests" },
    { label: "Reports", path: "/app/reports" },
    { label: "Shared links", path: "/app/shares" },
  ] as const)("keeps $label reachable from the mobile nav at $path", ({ label, path }) => {
    expect(buildDashboardMobileNav({ showPresence: false })).toContainEqual(
      expect.objectContaining({ label, to: path }),
    );
  });

  it("does not duplicate Support in the mobile navigation helper", () => {
    expect(buildDashboardMobileNav({ showPresence: true }).some((item) => item.label === "Support")).toBe(false);
    const supportItems = DASHBOARD_SETTINGS_NAV.flatMap((section) => section.items).filter(
      (item) => item.to === "/app/support",
    );
    expect(supportItems).toEqual([{ label: "Help & support", to: "/app/support" }]);
  });

  it("provides route-change focus and polite announcements without initial focus stealing", () => {
    expect(shellSource).toContain("useLocation");
    expect(shellSource).toContain('aria-live="polite"');
    expect(shellSource).toContain("f9-sr-only");
    // The initial mount must not announce or focus. The guard is a pathname
    // comparison (not a "have I mounted yet?" flag) so a StrictMode double
    // mount cannot flip it and announce on the first render.
    expect(shellSource).toContain(
      "if (previousPathnameRef.current === location.pathname) return;",
    );
  });

  it("removes duplicate search topbar CTAs", () => {
    // Workflow-friction pass: the topbar CTA is now the quick-add palette
    // button rather than a /search link, so no search links remain here.
    const searchLinks = appLayout.match(/to="\/search"/g) ?? [];
    expect(searchLinks).toHaveLength(0);
    expect(appLayout).toContain("QuickAddPalette");
    expect(appLayout).toContain("Add competitor");
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
    expect(helpCatalog).not.toContain("Better Auth");
  });

  it("exposes Team and Client rooms in the mobile utility strip", () => {
    // BL-030 moved Client rooms into the rail's daily jobs (it is delivery
    // work, not a settings screen); Team stayed behind the disclosure. Both
    // are still in the mobile utility strip, which is what this guards.
    const settingsItems = DASHBOARD_SETTINGS_NAV.flatMap((section) => section.items);
    expect(settingsItems).toEqual(
      expect.arrayContaining([{ label: "Team", to: "/app/team" }]),
    );
    expect(
      DASHBOARD_PRIMARY_NAV.flatMap((section) => section.items),
    ).toEqual(expect.arrayContaining([{ label: "Client rooms", to: "/app/clients" }]));
    expect(shellSource).toContain("f9-dash-mobile-utility");
    expect(shellSource).toContain("MOBILE_UTILITY_NAV.map");
    expect(appCss).toMatch(/\.f9-dash-mobile-utility\s*\{[^}]*display:\s*none/s);
  });

  it("keeps customer terminology out of primary app surfaces", () => {
    const searchRoute = readFileSync("app/routes/search.tsx", "utf8");
    const pricingSource = readFileSync("app/lib/pricing.ts", "utf8");

    expect(searchRoute).not.toMatch(/\bboard(s)?\b/i);
    expect(pricingSource).not.toContain("saved boards");
    expect(pricingSource).not.toContain("boards, and briefs");
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
