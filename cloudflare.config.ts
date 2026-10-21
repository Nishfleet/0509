import { bindings, defineConfig, exports, triggers } from "cf/config";

const STAGING_ACCESS_AUD = "4d713d09a17fe8acfcbee861f29b743a0158892737e95ec52c0b659f7362dd7f";

export default defineConfig(({ mode }) => {
  const staging = mode === "staging";
  const name = staging ? "0509-staging" : "0509";
  const own = (resource: string) => (staging ? `${resource}-staging` : resource);
  const workflow = (workflowName: string, exportName: string) =>
    bindings.workflow({ name: own(workflowName), worker: name, exportName });
  const rateLimit = (namespace: number, limit: number) =>
    bindings.rateLimit({ namespace: String(namespace + (staging ? 1000 : 0)), simple: { limit, period: 60 } });

  return {
    worker: {
      name,
      compatibilityDate: "2026-09-16",
      compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
      entrypoint: "./workers/app.ts",
      placement: { mode: "smart" },
      limits: { cpuMs: 5000, subrequests: 10000 },
      observability: {
        enabled: true,
        headSamplingRate: 1,
        logs: { headSamplingRate: 1, invocationLogs: true, persist: true },
      },
      assets: { runWorkerFirst: ["/mcp"] },
      domains: staging ? ["staging.0509.io"] : ["0509.io", "www.0509.io", "api.0509.io"],
      triggers: [
        triggers.scheduled({ schedule: "*/5 * * * *" }),
        triggers.scheduled({ schedule: "0 * * * *" }),
        triggers.scheduled({ schedule: "0 19 * * *" }),
        triggers.scheduled({ schedule: "0 21 * * *" }),
        triggers.scheduled({ schedule: "30 23 * * *" }),
        triggers.scheduled({ schedule: "0 1 * * *" }),
        triggers.scheduled({ schedule: "0 3 * * *" }),
        triggers.scheduled({ schedule: "0 4 * * MON" }),
        triggers.scheduled({ schedule: "0 5 * * *" }),
        triggers.queue({
          deadLetterQueue: own("send-email-dlq"),
          maxBatchSize: 1,
          maxBatchTimeout: 30,
          maxConcurrency: 2,
          maxRetries: 5,
          name: own("send-email"),
          retryDelay: 60,
        }),
        triggers.queue({ maxBatchSize: 1, maxBatchTimeout: 30, maxRetries: 3, name: own("send-email-dlq") }),
        triggers.queue({
          deadLetterQueue: own("fetch-sweep-dlq"),
          maxBatchSize: 5,
          maxBatchTimeout: 30,
          maxConcurrency: 20,
          maxRetries: 3,
          name: own("fetch-sweep"),
          retryDelay: 60,
        }),
        triggers.queue({ maxBatchSize: 5, maxBatchTimeout: 30, maxRetries: 3, name: own("fetch-sweep-dlq") }),
      ],
      env: {
        BETTER_AUTH_URL: bindings.text(staging ? "https://staging.0509.io" : "https://0509.io"),
        LANDING_WORKSPACE_ID: bindings.text(""),
        GIT_SHA: bindings.text(""),
        DODO_ENVIRONMENT: bindings.text(staging ? "test_mode" : "live_mode"),
        DODO_PRODUCT_SCOUT: bindings.text(staging ? "" : "pdt_0NoeiCehl28XydokfKsmk"),
        DODO_PRODUCT_STARTER: bindings.text(staging ? "" : "pdt_0NoeiCjBmCJTfOHquf26O"),
        DODO_PRODUCT_AGENCY: bindings.text(staging ? "" : "pdt_0NoeiCmf66xTM4sWXDrAj"),
        DODO_PRODUCT_SCOUT_YEARLY: bindings.text(""),
        DODO_PRODUCT_STARTER_YEARLY: bindings.text(""),
        DODO_PRODUCT_AGENCY_YEARLY: bindings.text(""),
        DODO_PRODUCT_TESTER: bindings.text(""),
        TESTER_EMAIL_HASHES: bindings.text(""),
        AI_SPEND: bindings.text("on"),
        RIVAL_REACH_CHECK: bindings.text("on"),
        AI_GATEWAY_ID: bindings.text("default"),
        SHARED_RIVAL_CHECKS: bindings.text("off"),
        ACCESS_TEAM_DOMAIN: bindings.text("https://nish345.cloudflareaccess.com"),
        ACCESS_AUD: bindings.text(
          staging ? STAGING_ACCESS_AUD : "5dcfc6477175c13fa2dbdbdbc91242e7458da2ae9028131ab776995cbda2bd7f",
        ),
        ...(staging ? { AI_DAILY_CAP_SCALE: bindings.text("0.05"), FIXTURE_REAPER: bindings.text("dry-run") } : {}),
        BETTER_AUTH_SECRET: bindings.secret(),
        TURNSTILE_SECRET_KEY: bindings.secret(),
        TURNSTILE_SITE_KEY: bindings.secret(),
        DODO_PAYMENTS_API_KEY: bindings.secret(),
        DODO_WEBHOOK_SECRET: bindings.secret(),
        SLACK_TARGET_SECRET: bindings.secret(),
        MENTIONS_SOURCES: bindings.analyticsEngineDataset({
          name: staging ? "mentions_sources_staging" : "mentions_sources",
        }),
        DB: bindings.d1(
          staging
            ? { name: "0509-staging", id: "627cffe8-675b-47f9-a20e-c73a0907b4c3" }
            : { name: "0509", id: "746c6e3d-782e-443a-82d6-28ca93a16294" },
        ),
        IDENTITY_CACHE: bindings.kv({
          id: staging ? "b67443be2cc44dd5b388d32eb8d96c86" : "583a3ce85fac4da0b811902674481663",
        }),
        OAUTH_KV: bindings.kv({
          id: staging ? "19653fed500a45609b7af16484c1d291" : "c74722e9898d4ea5948e50110d2b9f20",
        }),
        SNAPSHOTS: bindings.r2({ name: staging ? "0509-staging-snapshots" : "0509-snapshots" }),
        SNAPSHOTS_BACKUP: bindings.r2({ name: staging ? "0509-staging-snapshots-backup" : "0509-snapshots-backup" }),
        EMAIL: bindings.sendEmail({}),
        SEND_EMAIL: bindings.queue({ name: own("send-email") }),
        FETCH_SWEEP: bindings.queue({ name: own("fetch-sweep") }),
        BROWSER_BUDGET: bindings.durableObject({ worker: name, exportName: "BrowserBudget" }),
        BILLING_RECONCILE: workflow("billing-reconcile", "BillingReconcileWorkflow"),
        STANDING_ROLLOVER: workflow("standing-rollover", "StandingRolloverWorkflow"),
        DISCOVERY: workflow("competitor-discovery", "DiscoveryWorkflow"),
        SITE_SWEEP: workflow("site-sweep", "SiteSweepWorkflow"),
        HIRING_SWEEP: workflow("hiring-sweep", "HiringSweepWorkflow"),
        FEED_SWEEP: workflow("feed-sweep", "FeedSweepWorkflow"),
        SNAPSHOT_BACKUP: workflow("snapshot-backup", "SnapshotBackupWorkflow"),
        ACCOUNT_DELETE: workflow("account-delete", "AccountDeleteWorkflow"),
        OWN_SITE_CHECK: workflow("own-site-check", "OwnSiteCheckWorkflow"),
        MENTIONS: workflow("mentions-sweep", "MentionsWorkflow"),
        IDENTITY_TAIL: workflow("identity-tail", "IdentityTailWorkflow"),
        AI: bindings.ai({}),
        BROWSER: bindings.browser({}),
        CF_VERSION_METADATA: bindings.versionMetadata(),
        AGENT_LIMIT: rateLimit(5091, 120),
        SIGN_IN_EMAIL_LIMIT: rateLimit(5092, 5),
        SIGN_IN_IP_LIMIT: rateLimit(5093, 20),
        AGENT_REGISTER_LIMIT: rateLimit(5094, 10),
        PROBE_LIMIT: rateLimit(5095, 10),
        CHANGE_EMAIL_LIMIT: rateLimit(5096, 3),
      },
      exports: {
        BillingReconcileWorkflow: exports.workflow({ name: own("billing-reconcile") }),
        StandingRolloverWorkflow: exports.workflow({ name: own("standing-rollover") }),
        DiscoveryWorkflow: exports.workflow({ name: own("competitor-discovery") }),
        SiteSweepWorkflow: exports.workflow({ name: own("site-sweep") }),
        HiringSweepWorkflow: exports.workflow({ name: own("hiring-sweep") }),
        FeedSweepWorkflow: exports.workflow({ name: own("feed-sweep") }),
        SnapshotBackupWorkflow: exports.workflow({ name: own("snapshot-backup") }),
        AccountDeleteWorkflow: exports.workflow({ name: own("account-delete") }),
        OwnSiteCheckWorkflow: exports.workflow({ name: own("own-site-check") }),
        MentionsWorkflow: exports.workflow({ name: own("mentions-sweep") }),
        IdentityTailWorkflow: exports.workflow({ name: own("identity-tail") }),
        BrowserBudget: exports.durableObject({ storage: "sqlite" }),
        SelectionEnrichmentLease: exports.durableObject({ state: "deleted" }),
      },
    },
  };
});
