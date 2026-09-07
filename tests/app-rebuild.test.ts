import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const appLayout = readFileSync("app/routes/app-layout.tsx", "utf8");
const shellComponent = readFileSync("app/components/dashboard-shell.tsx", "utf8");
const routeConfig = readFileSync("app/routes.ts", "utf8");
const dashboardRoute = readFileSync("app/routes/app.dashboard.tsx", "utf8");
const setupChecklist = readFileSync("app/components/setup-checklist-card.tsx", "utf8");
const collectionsRoute = readFileSync("app/routes/app.collections.tsx", "utf8");
const collectionExternalProof = readFileSync(
  "app/components/collections/collection-external-proof-section.tsx",
  "utf8",
);
const clientsRoute = readFileSync("app/routes/app.clients.tsx", "utf8");
const digestsRoute = readFileSync("app/routes/app.digests.tsx", "utf8");
const watchlistsRoute = readFileSync("app/routes/app.watchlists.tsx", "utf8");
// BL-030 replaced BL-006's competitor band with the ruled list row; the row
// component is where the competitor link now lives.
const ruledList = readFileSync("app/components/workspace/ruled-list.tsx", "utf8");
const notificationsUiRoute = readFileSync("app/routes/app.notifications.ui.tsx", "utf8");
const sourceAccessUiRoute = readFileSync("app/routes/app.source-access.ui.tsx", "utf8");
const developerAccessUiRoute = readFileSync("app/routes/app.developer-access.ui.tsx", "utf8");
const sourcesCompatibilityRoute = readFileSync("app/routes/app.sources.tsx", "utf8");
const reportsRoute = readFileSync("app/routes/app.reports.tsx", "utf8");
const opsRoute = readFileSync("app/routes/ops.tsx", "utf8");
const digestIntelligence = readFileSync("app/components/digest-intelligence.tsx", "utf8");
const reportView = readFileSync("app/components/report-view.tsx", "utf8");
const signOutButton = readFileSync("app/components/sign-out-button.tsx", "utf8");
const appCss = readFileSync("app/app.css", "utf8");
const appSurface = `${appLayout}\n${shellComponent}\n${dashboardRoute}\n${setupChecklist}\n${collectionsRoute}\n${collectionExternalProof}\n${clientsRoute}\n${digestsRoute}\n${watchlistsRoute}\n${notificationsUiRoute}\n${sourceAccessUiRoute}\n${developerAccessUiRoute}\n${sourcesCompatibilityRoute}\n${reportsRoute}\n${opsRoute}\n${digestIntelligence}\n${reportView}\n${signOutButton}`;
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
    expect(appSurface).toContain('className="f9-wk-stack"');
    expect(appSurface).toContain("f9-overview");
    expect(appSurface).toContain('className="f9-overview-search"');
    // BL-030: the two rebuilt surfaces run on the workspace-language layer.
    expect(dashboardRoute).toContain('className="f9-wk-page f9-overview"');
    expect(watchlistsRoute).toContain(
      'className={`f9-wk-page${selectedWatchlist ? " f9-watchdetail-page" : ""}`}',
    );
    expect(appSurface).toContain('id="setup-checklist"');
    expect(appSurface).not.toContain('className="f9-onboard-page"');
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
    // The wordmark lives in the shell itself; the app layout no longer
    // passes decorative account props that only ever rendered as fallbacks
    // for missing user identity (tri-audit S7).
    expect(shellComponent).toContain("f9-wk-wordmark");
    expect(shellComponent).toContain("Five to Nine");
    expect(appLayout).not.toContain("accountTitle=");
  });

  it("keeps internal app navigation on React Router transitions", () => {
    expect(shellComponent).toContain("useNavigation");
    expect(shellComponent).toContain('prefetch="intent"');
    expect(appLayout).toContain("shouldRevalidate");
    expect(appLayout).toContain("currentUrl.pathname === nextUrl.pathname");
    // The competitor row opens through a <Link>, never a raw href, so the
    // peek pane is a client transition and the list keeps its scroll.
    expect(ruledList).toContain("<Link");
    expect(ruledList).toContain('prefetch="intent"');
    expect(ruledList).not.toContain("href=");
    expect(watchlistsRoute).toContain("watchlistDetailTabHref(row.id)");
    expect(digestsRoute).toContain(
      "to={`/app/digests?digest=${digest.id}#first-brief-detail`}",
    );
    expect(digestsRoute).toContain("preventScrollReset");
    expect(digestsRoute).not.toContain("href={`/app/digests?digest=${digest.id}`}");
  });

  it("matches the advertised competitor-ad dashboard surface", () => {
    expect(appLayout).not.toContain("headerActions=");
    expect(shellComponent).toContain('aria-label="Workspace sections"');
    expect(shellComponent).not.toContain("f9-dash-topbar");
    expect(routeConfig).toContain('route("api/v1/workspace-readiness"');
    expect(routeConfig).toContain('route("clients", "routes/app.clients.tsx"');
    expect(dashboardRoute).toContain("getWorkspaceReadiness");
    expect(dashboardRoute).toContain("buildMarketDeskBrief");
    // BL-030 replaced the "Latest stored changes" kicker + stat band with the
    // concept v4 kickers. The Overview still names the same three jobs.
    expect(dashboardRoute).toContain("Overnight");
    expect(dashboardRoute).toContain("What changed");
    expect(dashboardRoute).toContain("Still running");
    // Proof honesty: only a confirmed event may lead the Overnight sentence
    // or carry the green mark, and a What-changed row may only say "Caught"
    // for a confirmed event — provisional events render "Needs review".
    expect(dashboardRoute).toContain("confirmedRecentEvents");
    expect(dashboardRoute).toContain("firstChangeMark(confirmedRecentEvents)");
    expect(dashboardRoute).toContain('"Needs review"');
    expect(dashboardRoute).not.toContain('status="Caught"');
    expect(dashboardRoute).toContain("Competitor website");
    expect(dashboardRoute).toContain("f9-overview-search");
    expect(dashboardRoute).not.toContain("f9-overview-stat-band");
    expect(dashboardRoute).not.toContain("Retained value loop");
    expect(dashboardRoute).not.toContain("Account setup");
    expect(dashboardRoute).not.toContain("Remembered");
    expect(dashboardRoute).not.toContain("Commercial discovery live");
    expect(dashboardRoute).not.toContain("source state visible");
    expect(dashboardRoute).not.toContain("data.workspaceReadiness.items");
    expect(appSurface).toContain("?format=json");
    expect(appSurface).toContain("Export JSON");
    expect(appSurface).not.toContain("?format=slack");
    expect(appSurface).not.toContain("Slack copy");
    expect(appSurface).not.toContain("InsightDepthPanel");
    expect(digestsRoute).not.toContain("Insight depth");
    expect(existsSync("app/components/insight-depth-panel.tsx")).toBe(false);
    expect(existsSync("app/components/digest-strategy-note.tsx")).toBe(false);
    expect(appCss).not.toContain(".f9-insight-grid");
    expect(appSurface).toContain("Developer access");
    expect(appSurface).toContain("approved actions");
    expect(appSurface).toContain("Create API key");
    expect(appSurface).toContain("/api/v1");
    expect(collectionsRoute).toContain(
      'import { CollectionExternalProofSection } from "~/components/collections/collection-external-proof-section";',
    );
    expect(collectionsRoute).toContain("<CollectionExternalProofSection");
    expect(appSurface).toContain("File evidence from another source");
    expect(appSurface).toContain("Save evidence link");
    expect(appSurface).toContain("Google / YouTube");
    expect(appSurface).toContain("LinkedIn");
    // The integrated client-rooms surface renamed the report-preferences
    // heading to a single spoken line. Keep asserting the surface itself, not
    // just the page title, so the rename cannot quietly delete the section.
    expect(clientsRoute).toContain("Client rooms");
    expect(clientsRoute).toContain("Report preferences, tone, and follow-up notes");
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
