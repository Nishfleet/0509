import {
  LEGACY_VENDOR_COMPARE_PATH,
} from "./routes/legacy-vendor-redirect";
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
  route("no-phantom-changes", "routes/no-phantom-changes.tsx"),
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
  // Parent-path fix (issue #2885): /ads 404'd while ~75 /ads/:domain children
  // sit in the sitemap. /brands is the live browse index, so the parent 301s
  // to it.
  route("ads", "routes/ads-redirect.ts"),
  route("brands", "routes/brands.tsx"),
  // Indexable per-category brand landing pages (issue #2067). Each curated
  // category gets its own /brands/:slug page listing exactly the brands that
  // fall into it, linked from the /brands hub and listed in the sitemap.
  route("brands/:category", "routes/brands.$category.tsx"),
  // Public weekly brief of stored offer moves across sitemap-indexable
  // brands (issue #2143). Stored rows only — never triggers live scraping.
  route("briefs/weekly", "routes/briefs.weekly.tsx"),
  // Parent-path fix (issue #2885): /briefs 404'd while /briefs/weekly is the
  // only live brief surface, so the parent 301s to it.
  route("briefs", "routes/briefs-redirect.ts"),
  // Public sample Monday brief (issue #2136): a real stored digest for the
  // newest indexable brand, with a signup CTA. Stored rows only.
  route("sample-brief", "routes/sample-brief.tsx"),
  route("timeline/:domain", "routes/timeline.$domain.tsx"),
  // Parent-path fix (issue #2885): /timeline 404'd while ~77 /timeline/:domain
  // children sit in the sitemap. The index lists the SAME capture-qualified,
  // non-empty set `loadIndexableTimelineEntries` feeds the sitemap (#2881's
  // non-empty gating), so the hub can never list a domain the sitemap drops.
  route("timeline", "routes/timeline.tsx"),
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
  route("compare", "routes/compare.tsx"),
  // Issue #2127 wiped a vendor's compare/switch pages. The legacy compare URL
  // (and its locale twin below) 301s to the /compare hub through one loader
  // file with an explicit id; the path is exported by that file so the route
  // config, the loader, and its test share one source of truth. The switch
  // twin is live again (issue #2887) and registered below.
  route(LEGACY_VENDOR_COMPARE_PATH, "routes/legacy-vendor-redirect.ts", { id: "compare-legacy-vendor-redirect" }),
  route("compare/meta-ad-library", "routes/compare.meta-ad-library.tsx"),
  route("compare/visualping", "routes/compare.visualping.tsx"),
  // Singular visualping-ad-library is a canonicalized loser (issue #1548):
  // the page the issue names is the plural /compare/visualping-ad-libraries,
  // so the winner moves there and this URL stays HTTP 200 canonicalizing to
  // it (the #1481 loser pattern) so no existing link 404s.
  route("compare/visualping-ad-library", "routes/compare.visualping-ad-library.tsx"),
  route("compare/visualping-ad-libraries", "routes/compare.visualping-ad-libraries.tsx"),
  route("compare/spyland", "routes/compare.spyland.tsx"),
  route("compare/pulzifi", "routes/compare.pulzifi.tsx"),
  route("compare/foreplay", "routes/compare.foreplay.tsx"),
  route("compare/foreplay-spyder", "routes/compare.foreplay-spyder.tsx"),
  route("compare/panoramata", "routes/compare.panoramata.tsx"),
  route("compare/adspyder", "routes/compare.adspyder.tsx"),
  route("compare/adspy", "routes/compare.adspy.tsx"),
  // Issue #2866: two verified competitors that had no compare page.
  route("compare/keeptabz", "routes/compare.keeptabz.tsx"),
  route("compare/gethookd", "routes/compare.gethookd.tsx"),
  // Issue #3092: the remaining verified ad-spy incumbents (each source-checked
  // against a live product + pricing page before shipping).
  route("compare/bigspy", "routes/compare.bigspy.tsx"),
  route("compare/minea", "routes/compare.minea.tsx"),
  route("compare/poweradspy", "routes/compare.poweradspy.tsx"),
  // Issue #2887: the MagicBrief wind-down page — the one vendor shutdown
  // creating real switching demand (BET 8). It replaces the legacy
  // switch-URL 301: the path serves 200 again, only /compare/magicbrief
  // keeps redirecting to the hub.
  route("switch/magicbrief", "routes/switch.magicbrief.tsx"),
  route("switch/panoramata", "routes/switch.panoramata.tsx"),
  route("switch/visualping", "routes/switch.visualping.tsx"),
  // Issue #3091: the AdSpy switch page — the documented declining incumbent
  // (BET 8), anchored on its cited public complaints.
  route("switch/adspy", "routes/switch.adspy.tsx"),
  route("competitor-monitoring", "routes/competitor-monitoring.tsx"),
  // Issue #2152: /guides/* how-to cluster — the honest manual/DIY/automated
  // guide for the "how to track competitor ads" query class, ending in the
  // no-account /search preview (source=guide_track_ads).
  route("guides/how-to-track-competitor-ads", "routes/guides.how-to-track-competitor-ads.tsx"),
  // Issue #2867: the second /guides/* page — the "monitor a competitor's Meta
  // Ad Library" watch-over-time intent, distinct from the one-shot tracking
  // guide above. Ends in the no-account /search preview
  // (source=guide-monitor-ad-library).
  route("guides/how-to-monitor-meta-ad-library", "routes/guides.how-to-monitor-meta-ad-library.tsx"),
  // Parent-path fix (issue #2885): /guides 404'd while /guides/* children sit
  // in the sitemap. A thin index of the live guides closes the dead end.
  route("guides", "routes/guides.tsx"),
  // Issue #2888: the third /guides/* page — the "monitor a competitor's
  // website/landing page changes" intent (offer/price/CTA watch), distinct
  // from the two ad-library guides above. Ends in the no-account /search
  // preview (source=guide-landing-page-changes).
  route("guides/how-to-monitor-competitor-landing-page-changes", "routes/guides.how-to-monitor-competitor-landing-page-changes.tsx"),
  // Issue #3093: three more /guides/* pages, one per uncovered differentiator
  // query — the offer-change alert intent, the prove-what-changed evidence
  // intent, and the one-off → standing-watch cadence intent. Each ends in the
  // no-account /search preview (source=guide-offer-change-alert /
  // guide-prove-what-changed / guide-standing-watch).
  route("guides/how-to-get-alerted-when-a-competitor-changes-their-offer", "routes/guides.how-to-get-alerted-when-a-competitor-changes-their-offer.tsx"),
  route("guides/how-to-prove-what-changed-on-a-competitor-website", "routes/guides.how-to-prove-what-changed-on-a-competitor-website.tsx"),
  route("guides/how-to-turn-a-one-off-competitor-check-into-a-standing-watch", "routes/guides.how-to-turn-a-one-off-competitor-check-into-a-standing-watch.tsx"),
  // Issue #3127: the seventh /guides/* page — the Meta Ad Library API
  // coverage explainer. The category's structural factual question (what the
  // official API returns and where); every claim cites Meta's own docs.
  // Ends in the no-account /search preview (source=guide-api-limitations).
  route("guides/meta-ad-library-api-limitations", "routes/guides.meta-ad-library-api-limitations.tsx"),
  route("for-agencies", "routes/for-agencies.tsx"),
  route("sneaker-resale", "routes/sneaker-resale.tsx"),
  route(":locale/sneaker-resale", "routes/$locale.sneaker-resale.tsx"),
  // Issue #3087: per-brand below-retail cluster pages for the four brands
  // whose /ads/:domain pages the hub already links. EN-only (canonical to
  // the English page, no hreflang). Unknown slugs 404 in the loader.
  route("sneaker-resale/:brand", "routes/sneaker-resale.$brand.tsx"),
  // Retired untranslated buyer-surface locale cluster (issue #2962, Branch
  // B per the orchestrator decision): every buyer-surface locale route was
  // deleted because those pages served byte-identical English copy with
  // lang="en" and canonical→EN yet declared hreflang variants — the audit
  // defect the issue closes. One splat route now 301s every buyer-surface
  // locale path to its EN pathname (query preserved), so already-indexed
  // URLs never dead-end on a 404 and no duplicate page remains for Google
  // to consolidate. The genuinely translated `/:locale/sneaker-resale`
  // route above still matches first (more-specific beats the splat), and
  // workers/app.ts serves /<locale>/sitemap.xml before this router runs.
  route(":locale/*", "routes/$locale.tsx"),
  route("team/accept", "routes/team.accept.tsx"),
	route("share/:token/pdf", "routes/share.$token.pdf.ts"),
  route("share/:token", "routes/share.$token.tsx"),
  route("export/:resourceType/:resourceId", "routes/export.$resourceType.$resourceId.tsx"),
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
