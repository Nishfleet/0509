import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const appLayout = readFileSync("app/routes/app-layout.tsx", "utf8");
const shellComponent = readFileSync("app/components/dashboard-shell.tsx", "utf8");
const routeConfig = readFileSync("app/routes.ts", "utf8");
const dashboardRoute = readFileSync("app/routes/app.dashboard.tsx", "utf8");
const onboardRoute = readFileSync("app/routes/app.onboard.tsx", "utf8");
const collectionsRoute = readFileSync("app/routes/app.collections.tsx", "utf8");
const clientsRoute = readFileSync("app/routes/app.clients.tsx", "utf8");
const digestsRoute = readFileSync("app/routes/app.digests.tsx", "utf8");
const watchlistsRoute = readFileSync("app/routes/app.watchlists.tsx", "utf8");
const sourcesRoute = readFileSync("app/routes/app.sources.tsx", "utf8");
const reportsRoute = readFileSync("app/routes/app.reports.tsx", "utf8");
const opsRoute = readFileSync("app/routes/app.ops.tsx", "utf8");
const digestIntelligence = readFileSync("app/components/digest-intelligence.tsx", "utf8");
const insightDepthPanel = readFileSync("app/components/insight-depth-panel.tsx", "utf8");
const reportView = readFileSync("app/components/report-view.tsx", "utf8");
const signOutButton = readFileSync("app/components/sign-out-button.tsx", "utf8");
const appCss = readFileSync("app/app.css", "utf8");
const appSurface = `${appLayout}\n${shellComponent}\n${dashboardRoute}\n${onboardRoute}\n${collectionsRoute}\n${clientsRoute}\n${digestsRoute}\n${watchlistsRoute}\n${sourcesRoute}\n${reportsRoute}\n${opsRoute}\n${digestIntelligence}\n${insightDepthPanel}\n${reportView}\n${signOutButton}`;
const appClasses = Array.from(appSurface.matchAll(/className=(?:"([^"]+)"|{`([^`]+)`})/g)).flatMap((match) =>
  (match[1] ?? match[2])
    .split(/\s+/)
    .map((className) => className.replace(/\$\{[^}]+\}/g, "").trim())
    .filter(Boolean),
);

describe("app rebuild", () => {
  it("uses the Dashboard V2 shell and dashboard classes", () => {
    expect(appLayout).toContain("DashboardShell");
    expect(shellComponent).toContain("f9-cursor-shell");
    expect(appSurface).toContain('className="f9-app-stack"');
    expect(appSurface).toContain("f9-dashboard-clean");
    expect(appSurface).toContain('className="f9-dashboard-search"');
    expect(appSurface).toContain('className="f9-onboard-page"');
    expect(appClasses).not.toEqual(
      expect.arrayContaining([
        "auth-shell",
        "container",
        "section-grid",
        "workspace-shell",
        "workspace-sidebar",
        "workspace-main",
        "workspace-topbar",
        "workspace-section-stack",
        "workspace-panels",
        "brand-mark",
        "brand-pill",
        "content-card",
        "metric-card",
        "status-card",
        "list-card",
        "button",
        "button-primary",
        "button-secondary",
        "section-label",
        "eyebrow",
        "muted-text",
        "badge",
        "badge-beta",
      ]),
    );
  });

  it("keeps stale launch labels out of the rebuilt app shell", () => {
    expect(appSurface).not.toMatch(/pilot|fit review|self-serve|not live/i);
  });

  it("uses the Five to Nine wordmark in the app shell", () => {
    expect(appLayout).toContain('accountTitle="Five to Nine"');
  });

  it("matches the advertised competitor-ad dashboard surface", () => {
    expect(appLayout).toContain("Search ads");
    expect(routeConfig).toContain('route("api/v1/workspace-readiness"');
    expect(routeConfig).toContain('route("clients", "routes/app.clients.tsx"');
    expect(dashboardRoute).toContain("getWorkspaceReadiness");
    expect(dashboardRoute).toContain("Add your first competitor");
    expect(dashboardRoute).toContain("Competitor website");
    expect(dashboardRoute).toContain("f9-dashboard-search");
    expect(dashboardRoute).toContain("f9-dashboard-metrics");
    expect(dashboardRoute).toContain("Recent changes");
    expect(dashboardRoute).not.toContain("Retained value loop");
    expect(dashboardRoute).not.toContain("Account setup");
    expect(dashboardRoute).not.toContain("Remembered");
    expect(dashboardRoute).not.toContain("Commercial discovery live");
    expect(dashboardRoute).not.toContain("source state visible");
    expect(dashboardRoute).not.toContain("data.workspaceReadiness.items");
    expect(appSurface).toContain("?format=json");
    expect(appSurface).toContain("?format=slack");
    expect(appSurface).toContain("JSON export");
    expect(appSurface).toContain("Slack copy");
    expect(appSurface).toContain("Insight depth");
    expect(appSurface).toContain("Top hooks");
    expect(appSurface).toContain("Media mix");
    expect(appSurface).toContain("Observed campaign duration");
    expect(appSurface).toContain("Landing-page history");
    expect(appSurface).toContain("Advanced: API keys and external tools");
    expect(appSurface).toContain("Create API key");
    expect(appSurface).toContain("/api/v1");
    expect(collectionsRoute).toContain("External proof");
    expect(collectionsRoute).toContain("Save proof link");
    expect(collectionsRoute).toContain("Google / YouTube");
    expect(collectionsRoute).toContain("LinkedIn");
    expect(clientsRoute).toContain("Report preferences and notes");
    expect(clientsRoute).toContain("upsert-agent-memory");
    expect(digestsRoute).toContain("formatDeliveryChannelLabel");
    expect(digestsRoute).toContain('channel === "slack"');
  });

  it("does not ship the legacy website or workspace selectors", () => {
    for (const selector of [
      ".site-shell",
      ".site-header",
      ".hero-section",
      ".hero-copy",
      ".button-primary",
      ".button-secondary",
      ".content-card",
      ".workspace-shell",
      ".workspace-sidebar",
      ".workspace-main",
      ".workspace-topbar",
      ".workspace-section-stack",
      ".workspace-panels",
      ".auth-shell",
      ".auth-card",
      ".search-panel",
      ".results-panel",
      ".error-shell",
      ".share-shell",
      ".section-label",
      ".eyebrow",
      ".muted-text",
      ".badge-beta",
      ".pilot-tag",
    ]) {
      expect(appCss).not.toContain(selector);
    }
  });
});
