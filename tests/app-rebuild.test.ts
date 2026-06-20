import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const appLayout = readFileSync("app/routes/app-layout.tsx", "utf8");
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
const appSurface = `${appLayout}\n${dashboardRoute}\n${onboardRoute}\n${collectionsRoute}\n${clientsRoute}\n${digestsRoute}\n${watchlistsRoute}\n${sourcesRoute}\n${reportsRoute}\n${opsRoute}\n${digestIntelligence}\n${insightDepthPanel}\n${reportView}\n${signOutButton}`;
const appClasses = Array.from(appSurface.matchAll(/className=(?:"([^"]+)"|{`([^`]+)`})/g)).flatMap((match) =>
  (match[1] ?? match[2])
    .split(/\s+/)
    .map((className) => className.replace(/\$\{[^}]+\}/g, "").trim())
    .filter(Boolean),
);

describe("app rebuild", () => {
  it("uses the fresh app shell and dashboard classes", () => {
    expect(appSurface).toContain('className="f9-app-shell"');
    expect(appSurface).toContain('className="f9-app-stack"');
    expect(appSurface).toContain('className="f9-market-desk"');
    expect(appSurface).toContain('className="f9-market-search"');
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
    expect(appLayout).toContain('<BrandWordmark meta="Account" />');
  });

  it("matches the advertised competitor-ad dashboard surface", () => {
    expect(appLayout).toContain("Search competitor ads");
    expect(routeConfig).toContain('route("api/v1/workspace-readiness"');
    expect(routeConfig).toContain('route("clients", "routes/app.clients.tsx"');
    expect(dashboardRoute).toContain("getWorkspaceReadiness");
    expect(dashboardRoute).toContain("data.workspaceReadiness.items");
    expect(dashboardRoute).toContain("Add your first competitor");
    expect(dashboardRoute).toContain("Revenue brief");
    expect(dashboardRoute).toContain("Competitor website");
    expect(dashboardRoute).toContain("Retained value loop");
    expect(dashboardRoute).toContain("What Five to Nine did for you");
    expect(dashboardRoute).toContain("Production proof");
    expect(dashboardRoute).toContain("Broad launch proof is separate");
    expect(dashboardRoute).toContain('to="/status"');
    expect(dashboardRoute).toContain("Watched");
    expect(dashboardRoute).toContain("Checked");
    expect(dashboardRoute).toContain("Changed");
    expect(dashboardRoute).toContain("Proved");
    expect(dashboardRoute).toContain("Delivered");
    expect(dashboardRoute).toContain("Remembered");
    expect(dashboardRoute).toContain("Save agent memory");
    expect(dashboardRoute).not.toContain("Commercial discovery live");
    expect(dashboardRoute).not.toContain("source state visible");
    expect(appSurface).toContain("?format=json");
    expect(appSurface).toContain("?format=slack");
    expect(appSurface).toContain("API JSON");
    expect(appSurface).toContain("Slack copy");
    expect(appSurface).toContain("Insight depth");
    expect(appSurface).toContain("Top hooks");
    expect(appSurface).toContain("Media mix");
    expect(appSurface).toContain("Observed campaign duration");
    expect(appSurface).toContain("Landing-page history");
    expect(appSurface).toContain("Customer API");
    expect(appSurface).toContain("Create API key");
    expect(appSurface).toContain("/api/v1");
    expect(appSurface).toContain("/api/mcp");
    expect(collectionsRoute).toContain("External proof");
    expect(collectionsRoute).toContain("Save proof link");
    expect(collectionsRoute).toContain("Google / YouTube");
    expect(collectionsRoute).toContain("LinkedIn");
    expect(clientsRoute).toContain("Operating context for agents");
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
