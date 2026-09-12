import type { AppEnv } from "~/lib/env.server";

import { FREE_PREVIEW_SEARCH_DOMAIN } from "~/lib/demo-brand-pages";
import { normalizeCompetitorWebsiteInput, applyWebsiteSearchFallback } from "~/lib/competitor-website";
import { parseSearchParams } from "~/lib/normalize";
import { executeSearchWithRelevance, hasWarmSearchCacheEntry } from "~/lib/search-execution.server";
import { searchMetaLibraryByBrowser } from "~/lib/meta-library-browser.server";
import {
  ensureDedicatedBillingCanaryUser,
  getBillingCanaryUser,
  getUserPlanSnapshot,
  planForCanary,
  resolveDedicatedBillingCanaryEmail,
} from "~/lib/billing-canary-identity.server";
import { sendBetterAuthMagicLink } from "~/lib/better-auth.server";
import { consultEmailSuppression } from "~/lib/delivery-email-core.server";
import { isEmailSendingConfigured } from "~/lib/env.server";
import {
  EMAIL_DELIVERY_CANARY_EVERY_TICKS,
  emailCanaryDueThisTick,
  runEmailDeliveryProbe,
} from "~/lib/email-delivery-canary.server";

/**
 * Live synthetic probes for every public surface, run by the 5-minute
 * status-probe cron in workers/app.ts. Every state the /status page reports
 * traces to a row in `status_probe_samples` (migration 0097) — no fake green.
 *
 * Rules (packet 2026-09-12):
 * - each probe has a hard 10s timeout and must never throw out of the cron;
 * - details are one line and public-safe (no tokens, no internal-only
 *   hostnames — the canary identity is named "canary", never by address);
 * - the probes exercise the REAL product paths (internal handlers, not HTTP
 *   self-calls where avoidable) and respect existing rate budgets: no probe
 *   consumes the public search rate limit, starts a browser capture on the
 *   public_search cache family, or sends mail to anything but the dedicated
 *   internal canary identity.
 */

export const STATUS_PROBE_NAMES = [
  "public_search",
  "signin_dispatch",
  "billing_dodo",
  "provider_meta",
  "uptime",
  "email_delivery",
] as const;

export type StatusProbeName = (typeof STATUS_PROBE_NAMES)[number];

export const STATUS_PROBE_TIMEOUT_MS = 10_000;
export const STATUS_PROBE_RETENTION_DAYS = 7;

/**
 * Per-probe cadence, in cron ticks (the cron fires every 5 minutes). The
 * runner runs each probe only on its own budget:
 * - public_search / billing_dodo / uptime: every tick (cheap D1/self reads);
 * - signin_dispatch: every 30 min — it sends real (canary) mail through the
 *   send_email binding, so it must not crowd the customer email budget;
 * - provider_meta: hourly at :25 — it drives one shallow Meta Ad Library
 *   capture through the real browser-provider chain, which costs browser
 *   minutes, so it stays clear of the :00 monitoring rails;
 * - email_delivery: every 15 minutes on the canary module's own budget —
 *   it sends one real canary mail through the send_email binding and reads
 *   the loop rows, so 5-minute sends would crowd the customer email budget.
 */
const PROBE_EVERY_TICKS: Record<StatusProbeName, number> = {
  public_search: 1,
  signin_dispatch: 6,
  billing_dodo: 1,
  provider_meta: 12,
  uptime: 1,
  // Email-delivery canary (#3188): every 3rd tick = every 15 minutes. It
  // sends real mail and must not crowd the customer email budget the way a
  // 5-minute send would; :00/:15/:30/:45 UTC is the same cadence a */15
  // cron would fire, without a second scheduler.
  email_delivery: EMAIL_DELIVERY_CANARY_EVERY_TICKS,
};

const PROVIDER_META_TICK_OFFSET = 5; // UTC minute 25 within the hour

export type StatusProbeResult = {
  probe: StatusProbeName;
  ok: boolean;
  latencyMs: number;
  detail: string;
};

type StatusProbeRow = {
  probe: string;
  ok: number;
  latency_ms: number | null;
  detail: string | null;
  checked_at: string;
};

export type PublicStatusProbe = {
  probe: StatusProbeName;
  latest: {
    ok: boolean;
    latencyMs: number | null;
    detail: string | null;
    checkedAt: string;
  } | null;
  /** Samples recorded in the trailing 24 hours (0 when the rail is fresh). */
  samples24h: number;
  okRate24h: number | null;
  p50LatencyMs24h: number | null;
  lastFailureDetail: string | null;
};

function isStatusProbeName(value: string): value is StatusProbeName {
  return (STATUS_PROBE_NAMES as readonly string[]).includes(value);
}

/**
 * Hard wall around one probe. The race leaves the losing promise running, so
 * probes that own cancellable work (browser captures) still need to be cheap
 * to abandon — the cron invocation returns right after and the isolate tears
 * the rest down; discovery leases self-expire by TTL.
 */
async function withProbeTimeout(
  probe: StatusProbeName,
  run: () => Promise<{ ok: boolean; detail: string }>,
): Promise<StatusProbeResult> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${probe}_probe_timeout`)), STATUS_PROBE_TIMEOUT_MS);
      }),
    ]);
    return { probe, latencyMs: Date.now() - startedAt, ...outcome };
  } catch (error) {
    return {
      probe,
      ok: false,
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error && error.message === `${probe}_probe_timeout`
        ? `no result within ${Math.round(STATUS_PROBE_TIMEOUT_MS / 1000)}s budget`
        : "probe failed",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * public_search — the real anonymous search path for the fixed demo brand,
 * through the internal handler the /search loader calls (no HTTP self-call,
 * no rate-limit spend). The probe never starts a capture: on a cold cache it
 * reports honestly that the warming rail is not supplying, because a visitor
 * searching the brand right now would be staring at a warming state.
 * ok = results returned, or the capture pipeline's own verified-zero.
 */
async function runPublicSearchProbe(env: AppEnv): Promise<{ ok: boolean; detail: string }> {
  const competitorWebsite = normalizeCompetitorWebsiteInput(FREE_PREVIEW_SEARCH_DOMAIN);
  const parsedInput = parseSearchParams(new URLSearchParams(`website=${FREE_PREVIEW_SEARCH_DOMAIN}`));
  const parsed = applyWebsiteSearchFallback(parsedInput, competitorWebsite);
  const scope = "exact" as const;
  const cacheOptions = {
    env,
    competitorWebsite,
    parsed,
    scope,
    cursor: null,
    customerMetaAdLibraryToken: null,
  };
  const warm = await hasWarmSearchCacheEntry(cacheOptions);
  if (!warm) {
    return {
      ok: false,
      detail: `no fresh capture for ${FREE_PREVIEW_SEARCH_DOMAIN} — warming rail not supplying`,
    };
  }
  const execution = await executeSearchWithRelevance({
    ...cacheOptions,
    forceLive: false,
    hydratePersisted: false,
    executionContext: null,
  });
  const { result } = execution;
  if (result.discoveryProgress === "warming") {
    return { ok: false, detail: "cache entry still warming — no verified results served" };
  }
  if (result.ads.length > 0) {
    const via = result.cacheStatus ? ` (${result.cacheStatus})` : "";
    return { ok: true, detail: `${result.ads.length} ads returned${via}` };
  }
  if (result.discoveryEmptyReason === "no_results") {
    return { ok: true, detail: "0 verified (capture found no ads)" };
  }
  return { ok: false, detail: "search returned no results without a verified-zero reason" };
}

/**
 * signin_dispatch — the real one-time-link dispatch path in canary mode:
 * mints the link for the dedicated internal canary identity (never a customer
 * address) through sendBetterAuthMagicLink and requires the send_email
 * binding to accept the send. If the canary address ever lands on the
 * suppression ledger the probe reports red — a suppressed canary would
 * otherwise "pass" while sending nothing (fake green).
 */
async function runSigninDispatchProbe(env: AppEnv): Promise<{ ok: boolean; detail: string }> {
  if (!env.DB) {
    return { ok: false, detail: "database unavailable" };
  }
  const canaryEmail = resolveDedicatedBillingCanaryEmail(env);
  await ensureDedicatedBillingCanaryUser(env, canaryEmail);
  const canaryUser = await getBillingCanaryUser(env, canaryEmail);
  if (!canaryUser) {
    return { ok: false, detail: "canary identity missing" };
  }
  if (!isEmailSendingConfigured(env)) {
    return { ok: false, detail: "send_email binding not configured" };
  }
  await sendBetterAuthMagicLink(env, new Request("https://0509.io/auth/login", { method: "POST" }), {
    email: canaryEmail,
    mode: "login",
    redirectTo: "/",
  });
  if (await consultEmailSuppression(env, canaryEmail)) {
    return { ok: false, detail: "canary address suppressed — dispatch not verified" };
  }
  return { ok: true, detail: "link minted, send_email accepted (canary identity)" };
}

/**
 * billing_dodo — reuses the billing canary's own identity helpers
 * (~/lib/billing-canary-identity.server, extracted from
 * api.billing.dodo.canary.ts) to verify the Dodo billing pipeline's live
 * preconditions without running a mutation: the dedicated canary identity is
 * provisioned and billing-stable, the Dodo product catalog resolves for the
 * canary plan, and a webhook payload signs. The full locked webhook round-trip
 * stays Gate C's deploy-time job — a 5-minute mutating canary would collide
 * with the release gate's runs.
 */
async function runBillingDodoProbe(env: AppEnv): Promise<{ ok: boolean; detail: string }> {
  if (!env.DB) {
    return { ok: false, detail: "database unavailable" };
  }
  const canaryEmail = resolveDedicatedBillingCanaryEmail(env);
  await ensureDedicatedBillingCanaryUser(env, canaryEmail);
  const user = await getBillingCanaryUser(env, canaryEmail);
  if (!user) {
    return { ok: false, detail: "canary identity missing" };
  }
  const plan = planForCanary(user.plan);
  if (!plan) {
    return { ok: false, detail: "canary plan drifted" };
  }
  const snapshot = await getUserPlanSnapshot(env, user.id);
  if (
    !snapshot ||
    snapshot.plan !== plan ||
    !["active", "succeeded", "payment.succeeded"].includes(snapshot.dodo_status ?? "") ||
    snapshot.dodo_plan_change_product_id !== null
  ) {
    return { ok: false, detail: "canary billing state not stable" };
  }
  const { dodo0509ProductIds, dodo0509UsageBundleProductIds } = await import("~/lib/dodo-pricing.server");
  const { signDodoWebhookPayload } = await import("~/lib/dodo-billing.server");
  const planProductId = dodo0509ProductIds(env)[plan].monthly;
  const creditProductId = dodo0509UsageBundleProductIds(env).proof_500;
  if (!planProductId || !creditProductId) {
    return { ok: false, detail: "Dodo product catalog unresolved" };
  }
  const nowIso = new Date().toISOString();
  await signDodoWebhookPayload(env, "status-probe-signing-check", String(Math.floor(Date.now() / 1000)), JSON.stringify({
    id: "status-probe-signing-check",
    status: "payment.succeeded",
    created_at: nowIso,
    updated_at: nowIso,
    metadata: { app: "0509", probe: "billing_dodo" },
  }));
  return { ok: true, detail: "canary identity stable, catalog resolved, webhook signing ok" };
}

/**
 * provider_meta — drives the capture pipeline's own entry point
 * (searchMetaLibraryByBrowser, shallow mode, scheduled_warmup attribution) for
 * the fixed demo brand, so "ok" means Meta's Ad Library surface was fetched
 * and its payload parsed into ad cards within the probe budget. A plain fetch
 * of the Ad Library URL from a datacenter IP is 403-blocked, which is exactly
 * why the pipeline runs browser providers — so the probe rides the same rail.
 */
async function runProviderMetaProbe(env: AppEnv): Promise<{ ok: boolean; detail: string }> {
  const competitorWebsite = normalizeCompetitorWebsiteInput(FREE_PREVIEW_SEARCH_DOMAIN);
  const parsedInput = parseSearchParams(new URLSearchParams(`website=${FREE_PREVIEW_SEARCH_DOMAIN}`));
  const parsed = applyWebsiteSearchFallback(parsedInput, competitorWebsite);
  const query = {
    mode: parsed.mode,
    filters: parsed.filters,
  } as const;
  let result;
  try {
    result = await searchMetaLibraryByBrowser(env, query, {
      mode: "shallow",
      routeContext: "scheduled_warmup",
      executionContext: null,
    });
  } catch (error) {
    // Keep the raw error out of `detail` — it is published verbatim on /status
    // and browser-provider messages can carry internal hostnames. The full
    // message stays in worker logs instead.
    console.warn("provider_meta probe capture failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, detail: "ad library capture failed" };
  }
  if (result.ads.length > 0) {
    return { ok: true, detail: `${result.ads.length} ad cards parsed from the ad library surface` };
  }
  return { ok: false, detail: "ad library surface fetched but no cards parsed" };
}

/**
 * uptime — the public site itself: the marketing home page and the edge
 * health endpoint, fetched over the public hostname, status + latency each.
 */
async function runUptimeProbe(env: AppEnv): Promise<{ ok: boolean; detail: string }> {
  const origin = env.APP_ORIGIN?.replace(/\/+$/, "") || "https://0509.io";
  // Parallel inside the probe's shared 10s budget: a slow homepage must not
  // starve the health check of its slice and turn a partial degrade into a
  // false both-red.
  const probeFetch = async (path: string) => {
    const startedAt = Date.now();
    const response = await fetch(`${origin}${path}`, {
      redirect: "follow",
      headers: { "user-agent": "0509-status-probe/1.0" },
      signal: AbortSignal.timeout(STATUS_PROBE_TIMEOUT_MS),
    });
    return { status: response.status, ms: Date.now() - startedAt };
  };
  const [home, health] = await Promise.all([probeFetch("/"), probeFetch("/api/health")]);
  const ok = home.status < 400 && health.status < 400;
  return {
    ok,
    detail: `home ${home.status}/${home.ms}ms, health ${health.status}/${health.ms}ms`,
  };
}

function tickKey(now: Date): { tickIndex: number; utcMinute: number } {
  const utcMinute = now.getUTCMinutes();
  const tickIndex = Math.floor(utcMinute / 5);
  return { tickIndex, utcMinute };
}

export function probeDueThisTick(probe: StatusProbeName, now: Date): boolean {
  const { tickIndex, utcMinute } = tickKey(now);
  const every = PROBE_EVERY_TICKS[probe];
  if (probe === "provider_meta") {
    return utcMinute % 60 === PROVIDER_META_TICK_OFFSET * 5;
  }
  if (probe === "email_delivery") {
    // Owned by the canary module so the budget, the window arithmetic and
    // the canary rows all agree on what "every 15 minutes" means.
    return emailCanaryDueThisTick(now);
  }
  return tickIndex % every === 0;
}

const PROBE_RUNNERS: Record<StatusProbeName, (env: AppEnv) => Promise<{ ok: boolean; detail: string }>> = {
  public_search: runPublicSearchProbe,
  signin_dispatch: runSigninDispatchProbe,
  billing_dodo: runBillingDodoProbe,
  provider_meta: runProviderMetaProbe,
  uptime: runUptimeProbe,
  email_delivery: runEmailDeliveryProbe,
};

/**
 * Cron entry point. Never throws: every probe failure is a sample row, and a
 * sample-write failure is a console warning — a broken probe rail must not
 * turn into a cron failure alert for the wrong reason.
 */
export async function runStatusProbes(
  env: AppEnv,
  options: { now?: Date } = {},
): Promise<StatusProbeResult[]> {
  const now = options.now ?? new Date();
  const due = STATUS_PROBE_NAMES.filter((probe) => probeDueThisTick(probe, now));
  const results: StatusProbeResult[] = [];
  for (const probe of due) {
    results.push(await withProbeTimeout(probe, () => PROBE_RUNNERS[probe](env)));
  }
  if (results.length === 0) {
    return results;
  }
  await recordStatusProbeSamples(env, results, { now });
  await pruneStatusProbeSamples(env, { now });
  return results;
}

async function recordStatusProbeSamples(
  env: AppEnv,
  results: StatusProbeResult[],
  options: { now: Date },
) {
  if (!env.DB) {
    console.warn("status probe samples not recorded: database unavailable");
    return;
  }
  const checkedAt = options.now.toISOString();
  try {
    await env.DB.batch(
      results.map((result) =>
        env.DB!.prepare(
          "INSERT INTO status_probe_samples (probe, ok, latency_ms, detail, checked_at) VALUES (?, ?, ?, ?, ?)",
        ).bind(result.probe, result.ok ? 1 : 0, result.latencyMs, result.detail, checkedAt),
      ),
    );
  } catch (error) {
    console.warn("status probe sample write failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 7-day retention, pruned by the same cron that writes (bounded, index-fed).
 * Also removes expired Better Auth verification rows: magic-link dispatches
 * (including this cron's canary dispatches) mint one token each, and nothing
 * else pruned that table — expired tokens are unusable by definition.
 */
export async function pruneStatusProbeSamples(
  env: AppEnv,
  options: { now?: Date } = {},
): Promise<void> {
  if (!env.DB) return;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - STATUS_PROBE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const verificationCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  try {
    await env.DB.prepare("DELETE FROM status_probe_samples WHERE checked_at < ?").bind(cutoff).run();
  } catch (error) {
    console.warn("status probe retention prune failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  // Better Auth verification rows: magic-link dispatches (including this
  // cron's canary dispatches) mint one token each, and nothing else pruned
  // that table. Expired tokens are unusable by definition. Kept as its own
  // statement so schema drift here can never roll back the probe prune.
  try {
    await env.DB.prepare(
      "DELETE FROM verification WHERE id IN (SELECT id FROM verification WHERE expiresAt < ? LIMIT 500)",
    ).bind(verificationCutoff).run();
  } catch (error) {
    console.warn("verification token prune failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Public /status surface. Per probe: the latest sample, the 24h ok-rate, the
 * 24h p50 latency (ok samples), and the most recent failure detail. Reads
 * only; details are probe-authored and public-safe by construction.
 */
export async function getPublicStatusProbes(
  db: NonNullable<AppEnv["DB"]>,
  options: { now?: Date } = {},
): Promise<PublicStatusProbe[]> {
  const now = options.now ?? new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const placeholders = STATUS_PROBE_NAMES.map(() => "?").join(", ");

  const latestResult = await db.prepare(
    `SELECT probe, ok, latency_ms, detail, checked_at
     FROM status_probe_samples
     WHERE probe IN (${placeholders})
       AND checked_at = (SELECT MAX(checked_at) FROM status_probe_samples s2 WHERE s2.probe = status_probe_samples.probe)
     ORDER BY probe`,
  ).bind(...STATUS_PROBE_NAMES).all<StatusProbeRow>();

  const statsResult = await db.prepare(
    `SELECT probe,
            COUNT(*) AS n,
            AVG(ok) AS ok_rate
     FROM status_probe_samples
     WHERE checked_at >= ?1
     GROUP BY probe`,
  ).bind(since24h).all<{ probe: string; n: number; ok_rate: number | null }>();

  // p50 over successful samples, one row per probe. Window functions keep the
  // median in SQL (a correlated OFFSET subquery is rejected by SQLite inside
  // a grouped outer query).
  const p50Result = await db.prepare(
    `SELECT probe, latency_ms FROM (
       SELECT probe,
              latency_ms,
              ROW_NUMBER() OVER (PARTITION BY probe ORDER BY latency_ms) AS rn,
              COUNT(*) OVER (PARTITION BY probe) AS n
       FROM status_probe_samples
       WHERE ok = 1 AND latency_ms IS NOT NULL AND checked_at >= ?1
     ) ranked
     WHERE rn = n / 2 + 1
     ORDER BY probe`,
  ).bind(since24h).all<{ probe: string; latency_ms: number }>();

  const failureResult = await db.prepare(
    `SELECT probe, detail, checked_at
     FROM status_probe_samples
     WHERE ok = 0
       AND checked_at >= ?1
       AND checked_at = (
         SELECT MAX(checked_at) FROM status_probe_samples s2
         WHERE s2.probe = status_probe_samples.probe AND s2.ok = 0 AND s2.checked_at >= ?1
       )
     ORDER BY probe`,
  ).bind(since24h).all<{ probe: string; detail: string | null; checked_at: string }>();

  const latestByProbe = new Map(
    (latestResult.results ?? [])
      .filter((row): row is StatusProbeRow & { probe: StatusProbeName } => isStatusProbeName(row.probe))
      .map((row) => [row.probe, row]),
  );
  const statsByProbe = new Map(
    (statsResult.results ?? []).map((row) => [row.probe, row]),
  );
  const p50ByProbe = new Map(
    (p50Result.results ?? []).map((row) => [row.probe, Number(row.latency_ms)]),
  );
  const failureByProbe = new Map(
    (failureResult.results ?? [])
      .filter((row): row is { probe: StatusProbeName; detail: string | null; checked_at: string } =>
        isStatusProbeName(row.probe))
      .map((row) => [row.probe, row]),
  );

  return STATUS_PROBE_NAMES.map((probe) => {
    const latest = latestByProbe.get(probe);
    const stats = statsByProbe.get(probe);
    const failure = failureByProbe.get(probe);
    return {
      probe,
      latest: latest
        ? {
            ok: latest.ok === 1,
            latencyMs: latest.latency_ms,
            detail: latest.detail,
            checkedAt: latest.checked_at,
          }
        : null,
      samples24h: stats ? Number(stats.n) : 0,
      okRate24h: stats && Number(stats.n) > 0 ? Number(stats.ok_rate ?? 0) : null,
      p50LatencyMs24h: p50ByProbe.get(probe) ?? null,
      lastFailureDetail: failure?.detail ?? null,
    };
  });
}
