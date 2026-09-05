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
  route("proof", "routes/proof.tsx"),
  route("capture-rules", "routes/capture-rules.tsx"),
  route("bots/presence", "routes/bots.presence.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("terms", "routes/terms.tsx"),
  route("pricing", "routes/pricing.tsx"),
  route("unsubscribe", "routes/unsubscribe.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
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
  route("api/demo-proof", "routes/api.demo-proof.ts"),
  route("api/mcp", "routes/api.mcp.ts"),
  route("api/v1", "routes/api.v1.ts"),
  route("api/v1/actions", "routes/api.v1.actions.ts"),
  route("api/v1/workspace-readiness", "routes/api.v1.workspace-readiness.ts"),
  route("api/v1/:resourceType/:resourceId", "routes/api.v1.$resourceType.$resourceId.ts"),
  route("api/pricing-preview", "routes/api.pricing-preview.ts"),
  route("api/webhooks/dodo", "routes/api.webhooks.dodo.ts"),
  route("api/delivery-status/:provider", "routes/api.delivery-status.$provider.ts"),
  route("api/health", "routes/api.health.ts"),
  route("api/health/deep", "routes/api.health.deep.ts"),
  route("api/release-soak", "routes/api.release-soak.ts"),
  route("api/presence/oauth/linkedin", "routes/api.presence.oauth.linkedin.ts"),
  route("api/presence/oauth/linkedin/callback", "routes/api.presence.oauth.linkedin.callback.ts"),
  route("api/launch-readiness", "routes/api.launch-readiness.ts"),
  route("api/launch-readiness/canary", "routes/api.launch-readiness.canary.ts"),
  route("api/e2e/j3/replay", "routes/api.e2e.j3.replay.ts"),
  route("api/e2e/j4/replay", "routes/api.e2e.j4.replay.ts"),
  route("api/e2e/billing/replay", "routes/api.e2e.billing.replay.ts"),
  route("api/e2e/billing/state", "routes/api.e2e.billing.state.ts"),
  route("api/e2e/support/replay", "routes/api.e2e.j6.support.ts"),
  route("api/e2e/support/state", "routes/api.e2e.j6.support.state.ts"),
  route("api/e2e/auth/replay", "routes/api.e2e.j6.auth.ts"),
  route("api/e2e/retention/replay", "routes/api.e2e.j6.retention.ts"),
  route("api/e2e/retention/state", "routes/api.e2e.j6.retention.state.ts"),
  route("api/e2e/team/replay", "routes/api.e2e.j6.team.ts"),
  route("api/e2e/team/state", "routes/api.e2e.j6.team.state.ts"),
  route("app/onboard", "routes/app.onboard.tsx"),
  route("ops", "routes/ops.tsx"),
  route("ads/:domain", "routes/ads.$domain.tsx"),
  route("timeline/:domain", "routes/timeline.$domain.tsx"),
  // Canonical Ad Aggression Score formula page (issue #1263). Previously lived
  // at /methodology/ad-aggression-score (issue #960); that path now 301s here
  // via the route below so any indexed link keeps its equity.
  route("ad-aggression", "routes/ad-aggression.tsx"),
  // Legacy alias — 301 to the canonical /ad-aggression path so existing
  // /methodology/ad-aggression-score links and sitemap entries keep working.
  route("methodology/ad-aggression-score", "routes/methodology.ad-aggression-score-redirect.ts"),
  route("compare", "routes/compare.tsx"),
  route("compare/magicbrief", "routes/compare.magicbrief.tsx"),
  route("compare/meta-ad-library", "routes/compare.meta-ad-library.tsx"),
  route("compare/visualping", "routes/compare.visualping.tsx"),
  route("compare/visualping-ad-library", "routes/compare.visualping-ad-library.tsx"),
  route("compare/spyland", "routes/compare.spyland.tsx"),
  route("compare/pulzifi", "routes/compare.pulzifi.tsx"),
  route("compare/foreplay", "routes/compare.foreplay.tsx"),
  route("compare/foreplay-spyder", "routes/compare.foreplay-spyder.tsx"),
  route("compare/panoramata", "routes/compare.panoramata.tsx"),
  route("compare/adspyder", "routes/compare.adspyder.tsx"),
  route("switch/magicbrief", "routes/switch.magicbrief.tsx"),
  route("switch/panoramata", "routes/switch.panoramata.tsx"),
  route("switch/visualping", "routes/switch.visualping.tsx"),
  route("competitor-monitoring", "routes/competitor-monitoring.tsx"),
  route("sneaker-resale", "routes/sneaker-resale.tsx"),
  route(":locale/sneaker-resale", "routes/$locale.sneaker-resale.tsx"),
  // Locale-prefixed buyer-surface cluster (issue #1501): /de, /de/pricing,
  // /de/help, etc. Each child re-exports the EN route's loader/meta/links
  // so the cluster stays in lockstep with the EN surface — only the
  // lang attribute and hreflang cluster differ. React Router matches
  // more-specific routes first, so the named `:locale/sneaker-resale`
  // route above wins for `/<locale>/sneaker-resale` and only the new
  // buyer surfaces reach this layout.
  route(":locale", "routes/$locale.tsx", [
    index("routes/$locale._index.tsx"),
    route("pricing", "routes/$locale.pricing.tsx"),
    route("help", "routes/$locale.help.tsx"),
    route("docs", "routes/$locale.docs.tsx"),
    route("api/docs", "routes/$locale.api.docs.tsx"),
    route("status", "routes/$locale.status.tsx"),
    route("changelog", "routes/$locale.changelog.tsx"),
    route("trust", "routes/$locale.trust.tsx"),
    route("compare", "routes/$locale.compare.tsx"),
    // BET 5 compare child routes + BET 8 switch child routes under every
    // locale prefix (issue #1563). Each re-exports the EN sibling's meta and
    // component so the locale cluster stays in lockstep with the EN surface;
    // canonical consolidates on the EN /compare/<vendor> (or /switch/<vendor>)
    // per #1562's canonicalisation rule. Before this the locale hub links 200'd
    // but every locale-prefixed child 404'd, so a non-EN visitor following /
    // de/compare to a vendor fell back to English or hit a dead route.
    route("compare/magicbrief", "routes/$locale.compare.magicbrief.tsx"),
    route("compare/meta-ad-library", "routes/$locale.compare.meta-ad-library.tsx"),
    route("compare/visualping", "routes/$locale.compare.visualping.tsx"),
    route("compare/visualping-ad-library", "routes/$locale.compare.visualping-ad-library.tsx"),
    route("compare/spyland", "routes/$locale.compare.spyland.tsx"),
    route("compare/pulzifi", "routes/$locale.compare.pulzifi.tsx"),
    route("compare/foreplay", "routes/$locale.compare.foreplay.tsx"),
    route("compare/foreplay-spyder", "routes/$locale.compare.foreplay-spyder.tsx"),
    route("compare/panoramata", "routes/$locale.compare.panoramata.tsx"),
    route("compare/adspyder", "routes/$locale.compare.adspyder.tsx"),
    route("switch/magicbrief", "routes/$locale.switch.magicbrief.tsx"),
    route("switch/panoramata", "routes/$locale.switch.panoramata.tsx"),
    route("switch/visualping", "routes/$locale.switch.visualping.tsx"),
    // First-value search funnel + supporting trust/proof surfaces (issue 1578):
    // search is THE first purchase-intent moment, so the localised
    // buyer must not be flung back to EN mid-funnel. Each child re-exports
    // the EN route so the functional surface stays in lockstep; only the
    // canonical (EN) + hreflang cluster differ, and the page's search entry
    // points funnel to the locale-prefixed `/search`.
    route("search", "routes/$locale.search.tsx"),
    route("competitor-monitoring", "routes/$locale.competitor-monitoring.tsx"),
    route("capture-rules", "routes/$locale.capture-rules.tsx"),
    route("ad-aggression", "routes/$locale.ad-aggression.tsx"),
    // Programmatic /ads/:domain under every locale prefix (issue #1562):
    // the #1501 buyer-surface cluster added /de, /de/pricing, ... but not
    // the /ads/:domain Ad Aggression Score pages, so /de/ads/nike.com
    // 404'd for every brand. This child re-exports the EN route's loader +
    // meta + component so the localised surface serves the SAME score page
    // an EN buyer sees; canonical consolidates on the EN /ads/<domain>
    // (accept #2) and the root layout emits `<html lang="<locale>">` via
    // htmlLangForPathname (accept #3).
    route("ads/:domain", "routes/$locale.ads.$domain.tsx"),
  ]),
  route("team/accept", "routes/team.accept.tsx"),
	route("share/:token/pdf", "routes/share.$token.pdf.ts"),
  route("share/:token", "routes/share.$token.tsx"),
  route("export/:resourceType/:resourceId", "routes/export.$resourceType.$resourceId.tsx"),
  route("app", "routes/app-layout.tsx", [
    index("routes/app.dashboard.tsx"),
    route("collections", "routes/app.collections.tsx"),
    route("deliver", "routes/app.deliver.tsx"),
    route("settings", "routes/app.settings.tsx"),
    route("watchlists", "routes/app.watchlists.tsx"),
    route("watchlists/:watchlistId", "routes/app.watchlists.$watchlistId.tsx"),
    route("clients", "routes/app.clients.tsx"),
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
    route("ops", "routes/app.ops-redirect.ts"),
    route("reports", "routes/app.reports.index.ts"),
    route("reports/:id", "routes/app.reports.tsx"),
  ]),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
