import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { AGENT_ACTION_GROUPS } from "~/lib/agent-action-catalog";
import { BILLING_SKU_SLUGS } from "~/lib/billing-sku-catalog";
import {
  DASHBOARD_PRIMARY_NAV,
  DASHBOARD_SETTINGS_NAV,
  PUBLIC_SEARCH_NAV,
} from "~/lib/dashboard-navigation";
import {
  isSlackDeliveryCustomerFacing,
  isSlackWebhookDeliveryCustomerFacing,
  isTeamsWebhookDeliveryCustomerFacing,
  isWhatsAppDeliveryCustomerFacing,
} from "~/lib/ga-customer-surface";
import {
  getPlanEntitlements,
  PLAN_FAMILIES,
  PLAN_FEATURES,
} from "~/lib/plan-entitlements";
import { PRESENCE_SOURCE_IDS } from "~/lib/presence-types";
import { PUBLIC_MARKDOWN_PATHS } from "~/lib/public-markdown";
import { SITEMAP_PATHS, NOINDEX_ACTION_SURFACES } from "~/lib/seo";

type RegistryEntry = {
  claimId: string;
  text?: string;
  source: string[];
  status?: string;
  [key: string]: unknown;
};

type ClaimContext = {
  readSource: (path: string) => string;
  planCadence: Record<string, string>;
  planFeatures: readonly string[];
  planFeaturesByPlan: Record<string, readonly string[]>;
  agentActions: readonly string[];
  skuSlugs: readonly string[];
  presenceSources: readonly string[];
  deliveryChannels: { email: boolean; slack: boolean; teams: boolean; whatsapp: boolean };
  agencySeats: number;
};

type ClaimCheck = (entry: RegistryEntry, context: ClaimContext) => boolean;

const registry = JSON.parse(
  readFileSync("docs/customer-claim-surface-registry.json", "utf8"),
) as {
  schemaVersion: number;
  registryStatus: string;
  canonicalReleaseVerdict: string;
  coverage: Array<{ surface: string; status: string }>;
  claims: RegistryEntry[];
  explicitExclusions: RegistryEntry[];
};

const repoRoot = resolve(".");

function resolveRegistrySource(path: string) {
  if (isAbsolute(path)) throw new Error(`unsafe_source:${path}`);
  const resolved = resolve(repoRoot, path);
  const repoRelative = relative(repoRoot, resolved);
  if (repoRelative.startsWith("..") || isAbsolute(repoRelative)) {
    throw new Error(`unsafe_source:${path}`);
  }
  if (!existsSync(resolved)) throw new Error(`missing_source:${path}`);
  return resolved;
}

function readRegistrySource(path: string) {
  return readFileSync(resolveRegistrySource(path), "utf8");
}

function sourceText(entry: RegistryEntry, context: ClaimContext) {
  return entry.source.map((path) => context.readSource(path)).join("\n");
}

function sourcePatternCheck(
  pattern: RegExp,
  extra: (entry: RegistryEntry, context: ClaimContext) => boolean = () => true,
): ClaimCheck {
  return (entry, context) => pattern.test(sourceText(entry, context)) && extra(entry, context);
}

function removedTextCheck(pattern: RegExp): ClaimCheck {
  return (entry, context) =>
    entry.status === "removed_from_product_contract" &&
    !pattern.test(sourceText(entry, context));
}

const CLAIM_CHECKS: Record<string, ClaimCheck> = {
  // 2026-07-20 merge: overnight free-weekly-watch stack wins — free scans weekly now.
  "PLAN-CADENCE": sourcePatternCheck(/scheduledScanCadence|6-hour scans/u, (_entry, context) =>
    context.planCadence.free === "weekly" &&
    context.planCadence.scout === "every_6h" &&
    context.planCadence.starter === "every_3h" &&
    context.planCadence.agency === "every_3h"),
  "PLAN-ALLOWANCE-TOPUPS": sourcePatternCheck(/checks\/month|includedEvidenceChecksPerMonth|purchased packs/iu, (_entry, context) =>
    context.skuSlugs.some((slug) => slug.startsWith("burst_")) &&
    context.skuSlugs.some((slug) => slug.startsWith("campaign_")) &&
    context.skuSlugs.some((slug) => slug.startsWith("scale_"))),
  "PLAN-FEATURE-CATALOG": sourcePatternCheck(/PLAN_FEATURES/u, (_entry, context) =>
    Object.entries(expectedPlanFeaturesByPlan).every(([plan, expected]) =>
      JSON.stringify(uniqueSorted(context.planFeaturesByPlan[plan] ?? [])) ===
        JSON.stringify(uniqueSorted(expected)))),
  "MULTILINGUAL-TRANSLATION": (entry, context) =>
    removedTextCheck(/30\+ languages|auto-translates it into English/iu)(entry, context) &&
    context.planFeatures.includes("english_translation"),
  // 2026-07-20 merge: overnight stack wins — free is a weekly watch, not activation-only.
  "FREE-ACTIVATION-ONLY": sourcePatternCheck(/first scan|activation|weekly/iu, (_entry, context) =>
    context.planCadence.free === "weekly"),
  "FIRST-SCAN-TIMING": removedTextCheck(/couple of minutes/iu),
  "DELIVERY-TIMEZONE": sourcePatternCheck(/IANA|timeZone|timezone/u),
  "SOURCE-STATUS-FRESHNESS": sourcePatternCheck(/setup.?needed|unavailable|source status|freshness/iu),
  "CUSTOMER-ROUTE-CATALOG": sourcePatternCheck(/DASHBOARD_PRIMARY_NAV|PUBLIC_MARKDOWN_PATHS|SITEMAP_PATHS/u),
  "DELIVERY-CHANNEL-GATES": sourcePatternCheck(/not available at general availability|customer-facing GA surface/iu, (_entry, context) =>
    context.deliveryChannels.email &&
    context.deliveryChannels.slack &&
    context.deliveryChannels.teams &&
    !context.deliveryChannels.whatsapp),
  "TEAM-AGENCY-SHARING": sourcePatternCheck(/workspaceSeats|seat/iu, (_entry, context) =>
    context.agencySeats === 3),
  "CLIENT-ROOM-AGENCY": sourcePatternCheck(/client.?room|clientRoom/iu),
  "API-LIVE-CATALOG": sourcePatternCheck(/API|api/u, (_entry, context) =>
    context.agentActions.includes("get_workspace_readiness") &&
    context.agentActions.includes("watchlist.create")),
  "API-MCP-ACCOUNT-SCOPE": sourcePatternCheck(/MCP|mcp/u, (_entry, context) =>
    context.agentActions.includes("delivery_settings.update") &&
    context.agentActions.includes("support_case.list")),
  "ACCOUNT-DELETION-SUPPORT": sourcePatternCheck(/support|delet/iu),
  "BILLING-PORTAL-PLAN-CHANGE": sourcePatternCheck(/Dodo|checkout|portal|cancel/iu, (_entry, context) =>
    context.skuSlugs.some((slug) => slug.startsWith("agency_"))),
  "CHECK-PACK-SEMANTICS": sourcePatternCheck(/check|credit|proof/iu),
  "PRESENCE-SOURCE-COVERAGE": sourcePatternCheck(/website|manual.?only|planned|unsupported/iu, (_entry, context) =>
    context.presenceSources.includes("website") &&
    context.presenceSources.includes("context_dev")),
  "COMPARE-MIGRATION-AFTERNOON": removedTextCheck(/in an afternoon|afternoon with founder-assisted migration/iu),
  "SEO-CANONICAL-INDEXING": sourcePatternCheck(/canonical|robots|sitemap/iu),
  "EMAIL-DELIVERABILITY": sourcePatternCheck(/email|delivery/iu),
  "OP-HEALTH-UPTIME": sourcePatternCheck(/health|five minutes|5 minutes/iu),
  "OP-BACKUP-RESTORE": sourcePatternCheck(/backup|restore|R2/iu),
  "OP-MONITORING-CAPACITY": sourcePatternCheck(/capacity|queue|backpressure|Agency/iu),
  "COMPAT-MOBILE-A11Y": sourcePatternCheck(/Firefox|WebKit|Safari|Android Chrome/iu),
  "GA-AGENCY-STATUS": sourcePatternCheck(/release|readiness|GA/iu),
  "E2E-CANARY-ROUTES": sourcePatternCheck(/api\/e2e|guardE2EHarnessReplayRequest/u),
  "DAILY-MONITORING-ALIAS": sourcePatternCheck(/DAILY_MONITORING_CRON\s*=\s*DAILY_DIGEST_CRON/u),
  "NATIVE-APP-EDITING": sourcePatternCheck(/Native app work is `LATER\/REJECT`|native app.*REJECT/iu),
};

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort();
}

const expectedPlanFeaturesByPlan: Record<string, readonly string[]> = {
  // 2026-07-20 merge: overnight free-weekly-watch stack wins — free gets the
  // weekly brief plus the email lane it rides on, nothing else.
  free: ["weekly_digest", "email_delivery"],
  scout: [
    "competitor_research", "weekly_digest", "email_delivery",
    "presence_competitor_tracking", "presence_website_sources", "presence_digest_alerts",
  ],
  starter: [
    "competitor_research", "weekly_digest", "email_delivery",
    "presence_competitor_tracking", "presence_website_sources", "presence_digest_alerts",
    "daily_digest", "high_priority_alerts", "landing_page_evidence", "slack_delivery",
    "teams_delivery", "ad_text_multilingual", "english_translation", "export_csv",
    "export_json", "export_slack_ready", "share_links", "presence_self_tracking",
    "presence_social_connect",
  ],
  agency: [
    "competitor_research", "weekly_digest", "email_delivery",
    "presence_competitor_tracking", "presence_website_sources", "presence_digest_alerts",
    "daily_digest", "high_priority_alerts", "landing_page_evidence", "slack_delivery",
    "teams_delivery", "ad_text_multilingual", "english_translation", "export_csv",
    "export_json", "export_slack_ready", "presence_self_tracking",
    "presence_social_connect", "client_reports", "share_links", "pdf_reports",
    "agency_branding", "api_access",
    "mcp_access", "mcp_account_actions", "team_workspace",
  ],
};

const expectedClaimIds = [
  "PLAN-CADENCE", "PLAN-ALLOWANCE-TOPUPS", "PLAN-FEATURE-CATALOG",
  "MULTILINGUAL-TRANSLATION", "FREE-ACTIVATION-ONLY", "FIRST-SCAN-TIMING",
  "DELIVERY-TIMEZONE", "SOURCE-STATUS-FRESHNESS", "CUSTOMER-ROUTE-CATALOG",
  "DELIVERY-CHANNEL-GATES", "TEAM-AGENCY-SHARING", "CLIENT-ROOM-AGENCY",
  "API-LIVE-CATALOG", "API-MCP-ACCOUNT-SCOPE", "ACCOUNT-DELETION-SUPPORT",
  "BILLING-PORTAL-PLAN-CHANGE", "CHECK-PACK-SEMANTICS", "PRESENCE-SOURCE-COVERAGE",
  "COMPARE-MIGRATION-AFTERNOON", "SEO-CANONICAL-INDEXING", "EMAIL-DELIVERABILITY",
  "OP-HEALTH-UPTIME", "OP-BACKUP-RESTORE", "OP-MONITORING-CAPACITY",
  "COMPAT-MOBILE-A11Y", "GA-AGENCY-STATUS",
] as const;

const expectedExclusionIds = [
  "E2E-CANARY-ROUTES",
  "DAILY-MONITORING-ALIAS",
  "NATIVE-APP-EDITING",
] as const;

const allowedClaimStatuses = new Set([
  "assessed_gate_c_pending",
  "assessed_pending_reproof",
  "removed_from_product_contract",
  "assessed_open_missing_external_email_proof",
  "assessed_open_missing_lifecycle_proof",
  "assessed_open_missing_failure_notification",
  "assessed_open_missing_r2_lifecycle",
  "assessed_open_missing_cross_browser_at",
  "assessed_release_pending",
]);

function registryContractSha256() {
  const contract = {
    claims: registry.claims.map((claim) => ({
      claimId: claim.claimId,
      text: claim.text,
      surface: claim.surface,
      audience: claim.audience,
      owner: claim.owner,
      source: claim.source,
      requiredGate: claim.requiredGate,
      requiredEvidence: claim.requiredEvidence,
      status: claim.status,
      assessment: claim.assessment,
      classification: claim.classification,
      expiry: claim.expiry,
    })),
    explicitExclusions: registry.explicitExclusions.map((exclusion) => ({
      claimId: exclusion.claimId,
      source: exclusion.source,
      classification: exclusion.classification,
      reason: exclusion.reason,
    })),
  };
  return createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}

// 2026-07-20 merge: re-pinned after registry drift updates for the overnight
// stack (free weekly watch, sitemap additions, /ads/:domain) — all reopened
// as assessed_pending_reproof, no proof fabricated.
// 2026-08-09: re-pinned after the SEO-CANONICAL-INDEXING assessment recorded
// the /competitor-monitoring sitemap addition (claim stays reopened).
// 2026-08-12 merge: re-pinned after the Slack/Teams webhook-delivery decision
// reopened DELIVERY-CHANNEL-GATES (claim text/assessment updated to the live
// Slack+Teams/WhatsApp-dormant truth; no proof fabricated).
const EXPECTED_REGISTRY_CONTRACT_SHA256 =
  "ffb062105899cd89ba5610aa4a3c825026770e16dda91685d143dedc061f8151";

type Catalogs = {
  agentActions: string[];
  billingSkus: string[];
  planFamilies: string[];
  planFeatures: string[];
  presenceSources: string[];
  customerNavPaths: string[];
  publicMarkdownPaths: string[];
  sitemapPaths: string[];
  e2eRoutePaths: string[];
};

const actualCatalogs: Catalogs = {
  agentActions: AGENT_ACTION_GROUPS.flatMap((group) => [...group.actions]),
  billingSkus: [...BILLING_SKU_SLUGS],
  planFamilies: [...PLAN_FAMILIES],
  planFeatures: [...PLAN_FEATURES],
  presenceSources: [...PRESENCE_SOURCE_IDS],
  customerNavPaths: uniqueSorted([
    ...DASHBOARD_PRIMARY_NAV.flatMap((section) => section.items.map((item) => item.to)),
    // Member pages a destination owns are customer nav surface too (PR-5a).
    ...DASHBOARD_PRIMARY_NAV.flatMap((section) =>
      section.items.flatMap((item) => [...(item.activePaths ?? [])]),
    ),
    ...DASHBOARD_SETTINGS_NAV.flatMap((section) => section.items.map((item) => item.to)),
    ...PUBLIC_SEARCH_NAV.map((item) => item.to),
  ]),
  publicMarkdownPaths: [...PUBLIC_MARKDOWN_PATHS],
  sitemapPaths: [...SITEMAP_PATHS],
  e2eRoutePaths: [...readRegistrySource("app/routes.ts").matchAll(/route\("(api\/e2e\/[^"*]+)"/gu)]
    .map((match) => match[1] as string),
};

type CatalogName = keyof Catalogs;

const expectedCatalogs: Record<CatalogName, readonly string[]> = {
  agentActions: [
    "get_workspace_readiness", "source.meta.retest", "watchlist.create", "watchlist.update",
    "watchlist.refresh", "watchlist.pause", "watchlist.resume", "collection.create",
    "proof.add_external", "share.create", "report.create", "report.share",
    "counter_move_brief.create", "memory.upsert", "memory.list", "client_room.upsert",
    "client_room.list", "support_case.create", "support_case.list", "delivery_targets.list",
    "delivery_settings.update", "delivery_target.update", "web_mentions.list",
  ],
  billingSkus: [
    "scout_monthly_v1", "scout_annual_v1", "starter_monthly_v1", "starter_annual_v1",
    "agency_monthly_v1", "agency_annual_v1", "burst_500_v1", "campaign_2000_v1",
    "scale_7500_v1", "proof_500_legacy", "proof_2000_legacy", "proof_7500_legacy",
  ],
  planFamilies: ["free", "scout", "starter", "agency"],
  planFeatures: [
    "competitor_research", "weekly_digest", "daily_digest", "high_priority_alerts",
    "landing_page_evidence", "email_delivery", "slack_delivery", "teams_delivery",
    "ad_text_multilingual", "english_translation", "export_csv", "export_json",
    "export_slack_ready", "client_reports", "share_links", "pdf_reports",
    "agency_branding", "api_access",
    "mcp_access", "mcp_account_actions", "team_workspace", "presence_competitor_tracking",
    "presence_self_tracking", "presence_website_sources", "presence_social_connect",
    "presence_digest_alerts",
  ],
  presenceSources: ["website", "x", "reddit", "linkedin", "rss", "youtube", "amazon", "context_dev"],
  // PR-5a: the rail carries five destinations; Deliver and Settings own
  // their member pages. Presence left the nav (it lives inside Watch).
  customerNavPaths: [
    "/", "/#pricing", "/app", "/app/account", "/app/billing", "/app/clients",
    "/app/collections", "/app/deliver", "/app/developer-access", "/app/digests",
    "/app/notifications", "/app/presence", "/app/reports", "/app/settings",
    "/app/shares", "/app/source-access", "/app/support", "/app/team",
    "/app/watchlists", "/help", "/search",
  ],
  publicMarkdownPaths: ["/", "/help", "/docs", "/api/docs", "/status", "/changelog", "/trust", "/proof", "/privacy", "/terms"],
  // 2026-07-20 merge: overnight stack wins — sitemap gained /search, /auth/signup
  // and /compare/meta-ad-library (SEO-CANONICAL-INDEXING reopened for re-proof).
  // 2026-08-09: the proof-backed /competitor-monitoring category page joined the
  // sitemap (same claim stays reopened for re-proof; page claims trace to the
  // existing homepage/docs claims, no new claim text invented).
  // Sitemap entries must be paths the live Worker bundle serves; verify with a
  // Googlebot fetch before re-adding after a deploy.
  // 2026-08-25: /auth/signup left the sitemap — signup/auth surfaces stay out of
  // the sitemap and carry noindex (see NOINDEX_ACTION_SURFACES in app/lib/seo.ts).
  // 2026-08-25: /pricing rejoined the sitemap — the route is registered and the
  // live Worker bundle is ready to serve it (see issue #945).
  // 2026-08-26: four restored compare pages joined the sitemap (issue #1090).
  // 2026-08-26: /proof joined the sitemap — public capture-validity rules page (issue #970).
  // 2026-08-26: BET 8 switch pages joined the sitemap (issue #1117).
  // 2026-08-26: /methodology/ad-aggression-score joined the sitemap (issue #960).
  // 2026-08-27: sneaker-resale locale cluster joined the sitemap (issue #1154).
  // 2026-09: Ad Aggression Score methodology path renamed from
  // /methodology/ad-aggression-score to /ad-aggression (issue #1263). The old
  // path now 301-redirects; the sitemap lists the canonical one only so we
  // never index a redirect target alongside its origin.
  // Product UI stays English; these are indexable marketing surfaces only.
  sitemapPaths: ["/", "/search", "/compare/magicbrief", "/compare/meta-ad-library", "/compare/visualping", "/compare/visualping-ad-library", "/compare/spyland", "/compare/pulzifi", "/compare/foreplay", "/compare/foreplay-spyder", "/compare/panoramata", "/compare/adspyder", "/switch/magicbrief", "/switch/panoramata", "/switch/visualping", "/competitor-monitoring", "/sneaker-resale", "/de/sneaker-resale", "/ja/sneaker-resale", "/pt-br/sneaker-resale", "/proof", "/ad-aggression", "/pricing", "/help", "/docs", "/api/docs", "/status", "/changelog", "/trust", "/privacy", "/terms"],
  e2eRoutePaths: [
    "api/e2e/j3/replay", "api/e2e/j4/replay", "api/e2e/billing/replay",
    "api/e2e/billing/state", "api/e2e/support/replay", "api/e2e/support/state",
    "api/e2e/auth/replay", "api/e2e/retention/replay", "api/e2e/retention/state",
    "api/e2e/team/replay", "api/e2e/team/state",
  ],
};

const catalogClaimOwners: Record<CatalogName, string> = {
  agentActions: "API-LIVE-CATALOG",
  billingSkus: "BILLING-PORTAL-PLAN-CHANGE",
  planFamilies: "PLAN-CADENCE",
  planFeatures: "PLAN-FEATURE-CATALOG",
  presenceSources: "PRESENCE-SOURCE-COVERAGE",
  customerNavPaths: "CUSTOMER-ROUTE-CATALOG",
  publicMarkdownPaths: "CUSTOMER-ROUTE-CATALOG",
  sitemapPaths: "SEO-CANONICAL-INDEXING",
  e2eRoutePaths: "E2E-CANARY-ROUTES",
};

function catalogDriftErrors(catalogs: Catalogs) {
  const errors: string[] = [];
  for (const catalog of Object.keys(expectedCatalogs) as CatalogName[]) {
    const actual = new Set(catalogs[catalog]);
    const expected = new Set(expectedCatalogs[catalog]);
    if (actual.size !== catalogs[catalog].length) {
      errors.push(`duplicate_authority_entry:${catalog}`);
    }
    for (const entry of actual) {
      if (!expected.has(entry)) errors.push(`unmapped_authority_entry:${catalog}:${entry}`);
    }
    for (const entry of expected) {
      if (!actual.has(entry)) errors.push(`missing_authority_entry:${catalog}:${entry}`);
    }
  }
  return errors;
}

const context: ClaimContext = {
  readSource: readRegistrySource,
  planCadence: Object.fromEntries(
    PLAN_FAMILIES.map((plan) => [plan, getPlanEntitlements(plan).scheduledScanCadence]),
  ),
  planFeatures: PLAN_FEATURES,
  planFeaturesByPlan: Object.fromEntries(
    PLAN_FAMILIES.map((plan) => [plan, [...getPlanEntitlements(plan).features]]),
  ),
  agentActions: actualCatalogs.agentActions,
  skuSlugs: BILLING_SKU_SLUGS,
  presenceSources: PRESENCE_SOURCE_IDS,
  deliveryChannels: {
    email: PLAN_FAMILIES.filter((plan) => plan !== "free").every((plan) =>
      getPlanEntitlements(plan).features.has("email_delivery")),
    slack: isSlackWebhookDeliveryCustomerFacing(),
    teams: isTeamsWebhookDeliveryCustomerFacing(),
    whatsapp: isWhatsAppDeliveryCustomerFacing(),
  },
  agencySeats: getPlanEntitlements("agency").workspaceSeats,
};

describe("G11 claim-surface registry", () => {
  it("stays assessed and fail-closed while the closeout candidate is unfrozen", () => {
    expect(registry.schemaVersion).toBe(2);
    expect(registry.registryStatus).toBe("assessed_open");
    expect(registry.canonicalReleaseVerdict).toBe("closeout_candidate_unfrozen");
    const coverageSurfaces = registry.coverage.map((entry) => entry.surface);
    expect(uniqueSorted(coverageSurfaces)).toEqual([
      "api_mcp_and_agent_actions",
      "authenticated_routes_and_navigation",
      "browser_device_geography_locale",
      "cron_workflows_and_operator_recovery",
      "data_lifecycle_and_rights",
      "email_templates_and_delivery",
      "providers_and_integrations",
      "public_routes_and_copy",
      "roles_plans_and_entitlements",
    ]);
    expect(new Set(coverageSurfaces).size).toBe(coverageSurfaces.length);
    expect(Object.fromEntries(registry.coverage.map((entry) => [entry.surface, entry.status])))
      .toEqual({
        public_routes_and_copy: "assessed_pending_reproof",
        authenticated_routes_and_navigation: "assessed_pending_reproof",
        roles_plans_and_entitlements: "assessed_pending_reproof",
        email_templates_and_delivery: "assessed_open_missing_external_email_proof",
        cron_workflows_and_operator_recovery: "assessed_gate_c_pending",
        providers_and_integrations: "assessed_gate_c_pending",
        api_mcp_and_agent_actions: "assessed_pending_reproof",
        browser_device_geography_locale: "assessed_open_missing_cross_browser_at",
        data_lifecycle_and_rights: "assessed_open_missing_lifecycle_proof",
      });
  });

  it("keeps every claim and exclusion uniquely mapped to executable source truth", () => {
    const entries = [...registry.claims, ...registry.explicitExclusions];
    const ids = entries.map((entry) => entry.claimId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(registry.claims.map((entry) => entry.claimId)).toEqual(expectedClaimIds);
    expect(registry.explicitExclusions.map((entry) => entry.claimId)).toEqual(expectedExclusionIds);
    expect(Object.keys(CLAIM_CHECKS).sort()).toEqual([...ids].sort());
    expect(registryContractSha256()).toBe(EXPECTED_REGISTRY_CONTRACT_SHA256);

    for (const entry of entries) {
      expect(entry.source.length, `${entry.claimId} source`).toBeGreaterThan(0);
      for (const source of entry.source) expect(resolveRegistrySource(source)).toBeTruthy();
      expect(CLAIM_CHECKS[entry.claimId]?.(entry, context), entry.claimId).toBe(true);
    }
  });

  it("requires evidence status and drift triggers for customer claims", () => {
    for (const claim of registry.claims) {
      expect(claim).toMatchObject({
        claimId: expect.any(String),
        text: expect.any(String),
        surface: expect.any(String),
        audience: expect.any(String),
        owner: expect.any(String),
        source: expect.any(Array),
        requiredGate: expect.any(String),
        requiredEvidence: expect.any(String),
        status: expect.stringMatching(/^(assessed_|removed_from_product_contract)/u),
        assessment: expect.any(String),
        classification: expect.stringMatching(/^(known|discovered|duplicate|rejected|out_of_scope)$/u),
        expiry: expect.any(String),
      });
      for (const field of [
        "claimId", "text", "surface", "audience", "owner", "requiredGate",
        "requiredEvidence", "status", "assessment", "classification", "expiry",
      ]) {
        expect(String(claim[field] ?? "").trim().length, `${claim.claimId}.${field}`)
          .toBeGreaterThan(0);
      }
      expect(allowedClaimStatuses.has(String(claim.status)), `${claim.claimId}.status`).toBe(true);
    }
  });

  it("fails closed when an authoritative customer catalog changes", () => {
    expect(catalogDriftErrors(actualCatalogs)).toEqual([]);
    const registryIds = new Set([
      ...registry.claims.map((entry) => entry.claimId),
      ...registry.explicitExclusions.map((entry) => entry.claimId),
    ]);
    for (const owner of Object.values(catalogClaimOwners)) expect(registryIds.has(owner)).toBe(true);

    expect(catalogDriftErrors({
      ...actualCatalogs,
      agentActions: [...actualCatalogs.agentActions, "future.uninventoried.action"],
    })).toContain("unmapped_authority_entry:agentActions:future.uninventoried.action");
    expect(catalogDriftErrors({
      ...actualCatalogs,
      planFeatures: actualCatalogs.planFeatures.filter((feature) => feature !== "team_workspace"),
    })).toContain("missing_authority_entry:planFeatures:team_workspace");
    expect(catalogDriftErrors({
      ...actualCatalogs,
      agentActions: [...actualCatalogs.agentActions, actualCatalogs.agentActions[0] as string],
    })).toContain("duplicate_authority_entry:agentActions");
  });

  it("detects claim-source and catalog mutations instead of trusting registry shape", () => {
    const cadenceClaim = registry.claims.find((entry) => entry.claimId === "PLAN-CADENCE");
    expect(cadenceClaim).toBeTruthy();
    expect(CLAIM_CHECKS["PLAN-CADENCE"]?.(cadenceClaim as RegistryEntry, {
      ...context,
      planCadence: { ...context.planCadence, scout: "every_3h" },
    })).toBe(false);
    expect(() => sourceText({
      claimId: "MUTATED-SOURCE",
      source: ["../outside-the-repo"],
    }, context)).toThrow("unsafe_source");
  });

  it("allows N/A only as an explicit evidence-bearing exclusion", () => {
    expect(registry.explicitExclusions.length).toBeGreaterThan(0);
    for (const exclusion of registry.explicitExclusions) {
      expect(exclusion).toMatchObject({
        claimId: expect.any(String),
        source: expect.any(Array),
        classification: expect.stringMatching(/^(duplicate|rejected|out_of_scope)$/u),
        reason: expect.any(String),
      });
    }
    expect(JSON.stringify(registry.claims)).not.toContain("fail_not_assessed");
    expect(JSON.stringify(registry.claims)).not.toContain('"status":"pass"');
  });

  it("keeps noindex action surfaces out of the sitemap and carries the noindex meta", async () => {
    // Rule: signup/auth/action surfaces stay out of the sitemap and carry
    // <meta name="robots" content="noindex">. Every path in SITEMAP_PATHS must
    // be a reading surface (noindex-free) OR a member of the documented
    // NOINDEX_ACTION_SURFACES set — and the two sets must be disjoint, so the
    // documented noindex set never leaks an action surface into the sitemap.
    const sitemapSet = new Set<string>([...SITEMAP_PATHS]);
    const noindexSet = new Set<string>([...NOINDEX_ACTION_SURFACES]);

    for (const path of noindexSet) {
      expect(sitemapSet.has(path), `noindex action surface in sitemap: ${path}`).toBe(false);
    }

    // The signup route is the canonical example: its meta must carry the
    // noindex tag so a future accidental re-add to the sitemap still renders
    // a noindex page.
    const { meta } = await import("~/routes/auth.signup");
    const tags = (meta as unknown as () => Array<Record<string, string>>)();
    expect(tags).toContainEqual({ name: "robots", content: "noindex" });
  });
});
