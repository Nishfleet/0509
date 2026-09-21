import {
  type RouteConfig,
  index,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/marketing.tsx"),
  route("search", "routes/search.tsx"),
  route("help", "routes/help.tsx"),
  route("docs", "routes/docs.tsx"),
  route("api/docs", "routes/api.docs.tsx"),
  route("mcp/setup", "routes/mcp.setup.tsx"),
  route("status", "routes/status.tsx"),
  route("changelog", "routes/changelog.tsx"),
  route("trust", "routes/trust.tsx"),
  route("capture-rules", "routes/capture-rules.tsx"),
  route("no-phantom-changes", "routes/no-phantom-changes.tsx"),
  route("bots/presence", "routes/bots.presence.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("terms", "routes/terms.tsx"),
  route("pricing", "routes/pricing.tsx"),
  route("unsubscribe", "routes/unsubscribe.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("join", "routes/join.tsx"),
  route("auth/signup", "routes/auth.signup.tsx"),
  route("login", "routes/auth.login-alias.ts"),
  route("signup", "routes/auth.signup-alias.ts"),
  route("auth/logout", "routes/auth.logout.ts"),
  route("auth/better/magic-link", "routes/auth.better.magic-link.tsx"),
  route("auth/better/oauth", "routes/auth.better.oauth.ts"),
  route("auth/forgot-password", "routes/auth.forgot-password.tsx"),
  route("auth/reset-password", "routes/auth.reset-password.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("api/billing/dodo/checkout", "routes/api.billing.dodo.checkout.ts"),
  route("api/billing/dodo/cancel", "routes/api.billing.dodo.cancel.ts"),
  route("api/billing/dodo/canary", "routes/api.billing.dodo.canary.ts"),
  route("api/billing/dodo/portal", "routes/api.billing.dodo.portal.ts"),
  route("api/billing/dodo/plan-change", "routes/api.billing.dodo.plan-change.ts"),
  // Public capture-failure list for the /ads/:domain "What we checked, even
  // when it didn't alert" expander (issue #2249). The page lazy-fetches
  // `/api/ads/capture-failures/:domain` on expand; without this registration
  // the fetch 404s on every /ads/:domain page.
  route("api/ads/capture-failures/:domain", "routes/api.ads.capture-failures.$domain.ts"),
  // Agency customer API: latest run capture-attempt history (issue #1289).
  // Same unmounted-route class as capture-failures — caught by the
  // routes-manifest test.
  route("api/v1/watchlists/:watchlistId/runs/latest", "routes/api.v1.watchlists.$watchlistId.runs.latest.ts"),
  route("api/mcp", "routes/api.mcp.ts"),
  route("api/v1", "routes/api.v1.ts"),
  route("api/v1/actions", "routes/api.v1.actions.ts"),
  route("api/v1/workspace-readiness", "routes/api.v1.workspace-readiness.ts"),
  route("api/v1/:resourceType/:resourceId", "routes/api.v1.$resourceType.$resourceId.ts"),
  route("api/pricing-preview", "routes/api.pricing-preview.ts"),
  route("api/webhooks/dodo", "routes/api.webhooks.dodo.ts"),
  route("api/health", "routes/api.health.ts"),
  route("api/health/deep", "routes/api.health.deep.ts"),
  // Issue #2988: judge-facing roll-up behind the /api/health/deep
  // errorReports count line.
  route("api/observability/error-reports", "routes/api.observability.error-reports.ts"),
  route("api/presence/oauth/linkedin", "routes/api.presence.oauth.linkedin.ts"),
  route("api/presence/oauth/linkedin/callback", "routes/api.presence.oauth.linkedin.callback.ts"),
  route("app/onboard", "routes/app.onboard.tsx"),
  route("ads/:domain", "routes/ads.$domain.tsx"),
  // Public weekly brief of stored offer moves across sitemap-indexable
  // brands (issue #2143). Stored rows only — never triggers live scraping.
  route("briefs/weekly", "routes/briefs.weekly.tsx"),
  // Parent-path fix (issue #2885): /briefs 404'd while /briefs/weekly is the
  // only live brief surface, so the parent 301s to it.
  route("briefs", "routes/briefs-redirect.ts"),
  // Public sample Monday brief (issue #2136): a real stored digest for the
  // newest indexable brand, with a signup CTA. Stored rows only.
  route("sample-brief", "routes/sample-brief.tsx"),
  // Public full-text AEO feed (issue #2043). The body is served by
  // workers/app.ts before the router runs; this registration exists so the
  // sitemap route-registry canary accepts /llms-full.txt as a registered
  // path. See app/routes/llms-full.txt.ts.
  route("llms-full.txt", "routes/llms-full.txt.ts"),
  // Canonical Ad Aggression Score methodology page. Path history: issue #960
  // shipped /methodology/ad-aggression-score; #1263 promoted it to
  // /ad-aggression; #2022 briefly promoted it to /methodology; issue #2871
  // (transformation roadmap Q6) restores /methodology/ad-aggression-score as
  // the citable link-magnet URL. All older paths 301 here so indexed links
  // keep their equity.
  route("methodology/ad-aggression-score", "routes/methodology.tsx"),
  // Legacy alias — 301 to the canonical path so existing /ad-aggression
  // links and sitemap entries keep working (issue #1263 era).
  route("ad-aggression", "routes/ad-aggression-redirect.ts"),
  // Legacy alias — 301 to the canonical path so existing /methodology links
  // and sitemap entries keep working (issue #2022 era).
  route("methodology", "routes/methodology-redirect.ts"),
  route("competitor-monitoring", "routes/competitor-monitoring.tsx"),
  route("for-agencies", "routes/for-agencies.tsx"),
  route("team/accept", "routes/team.accept.tsx"),
  route("app", "routes/app-layout.tsx", [
    index("routes/app.dashboard.tsx"),
    // Route diet phase 1 (#2213) — the 8-screen model. New destinations from
    // renames (briefs / api / help) and the Competitor drill-in (/app/c/:id).
    route("c/:id", "routes/app.c.$id.tsx"),
    route("briefs", "routes/app.briefs.tsx"),
    route("api", "routes/app.api.tsx"),
    route("help", "routes/app.help.tsx"),
    // Folded member routes stay registered (302 → new home, phase 2 #2217
    // deletes the files): their files are now redirect stubs.
    route("collections", "routes/app.collections.tsx"),
    route("deliver", "routes/app.deliver.tsx"),
    route("settings", "routes/app.settings.tsx"),
    route("watchlists", "routes/app.watchlists.tsx"),
    route("watchlists/:watchlistId", "routes/app.watchlists.$watchlistId.tsx"),
    route("clients", "routes/app.clients.tsx"),
    route("competitors", "routes/app.competitors.tsx"),
    route("digests", "routes/app.digests.tsx"),
    route("shares", "routes/app.shares.tsx"),
    route("billing", "routes/app.billing.tsx"),
    route("support", "routes/app.support.tsx"),
    route("account", "routes/app.account.tsx"),
    route("team", "routes/app.team.tsx"),
    route("notifications", "routes/app.notifications.ts"),
    route("source-access", "routes/app.source-access.tsx"),
    route("developer-access", "routes/app.developer-access.tsx"),
    route("sources", "routes/app.sources.tsx"),
    route("presence", "routes/app.presence.tsx"),
    route("presence/:entityId", "routes/app.presence.$entityId.tsx"),
    route("reports", "routes/app.reports.index.ts"),
    route("reports/:id", "routes/app.reports.tsx"),
  ]),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
