import {
  DEFAULT_COUNTRY,
  DEFAULT_MODE,
  DOGFOOD_QUERIES,
  benchmarkProviders,
  findBlockingFreshLiveCurrent0509Failures,
} from "./provider-bakeoff.lib.mjs";

export const DEFAULT_CANARY_BASE_URL = "https://0509.in";
export const DEFAULT_CANARY_WWW_BASE_URL = "https://www.0509.in";
export const DEFAULT_CANARY_API_BASE_URL = "https://api.0509.in";
export const DEFAULT_CANARY_HEALTH_BASE_URLS = Object.freeze([
  DEFAULT_CANARY_BASE_URL,
  DEFAULT_CANARY_WWW_BASE_URL,
  DEFAULT_CANARY_API_BASE_URL,
]);
export const DEFAULT_CANARY_EXPECTED_APP = "0509";
export const DEFAULT_CANARY_FRESH_LIVE_SEARCH_TIMEOUT_MS = 60_000;

/**
 * @param {string | undefined | null} value
 */
function isConfiguredSecret(value) {
  return Boolean(value?.trim());
}

/**
 * @typedef {{
 *   ok: boolean,
 *   status: number | null,
 *   app: string | null,
 *   expectedApp: string | null,
 *   message: string | null,
 *   url: string
 * }} HealthCheckResult
 */

/**
 * @typedef {{
 *   ok: boolean,
 *   status: number | null,
 *   message: string | null,
 *   url: string,
 *   blockers: string[],
 *   signals: unknown,
 *   metaAdsBeta: unknown
 * }} LaunchReadinessCheckResult
 */

/**
 * @typedef {{
 *   baseUrl?: string,
 *   healthBaseUrls?: string[],
 *   expectedApp?: string | null,
 *   queries?: string[],
 *   country?: string,
 *   mode?: "advertiser" | "keyword",
 *   fetchImpl?: typeof fetch,
 *   benchmarkImpl?: typeof benchmarkProviders,
 *   canaryBypassToken?: string,
 *   searchTimeoutMs?: number,
 *   metaAdsStrict?: boolean
 * }} ProductionCanaryOptions
 */

/**
 * @param {ProductionCanaryOptions} options
 * @param {string} baseUrl
 */
function resolveHealthBaseUrls(options, baseUrl) {
  if (options.healthBaseUrls?.length) {
    return [...new Set(options.healthBaseUrls)];
  }
  if (options.baseUrl) {
    return [baseUrl];
  }
  return [...DEFAULT_CANARY_HEALTH_BASE_URLS];
}

/**
 * @param {{ baseUrl?: string, expectedApp?: string | null, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<HealthCheckResult>}
 */
export async function checkHealthEndpoint(options = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_CANARY_BASE_URL;
  const expectedApp = options.expectedApp ?? DEFAULT_CANARY_EXPECTED_APP;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL("/api/health", baseUrl).toString();

  try {
    const response = await fetchImpl(url, {
      headers: {
        "user-agent": "0509-prod-canary/1.0",
      },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({}));
    const app = typeof payload?.app === "string" ? payload.app : null;
    const appMatches = expectedApp ? app === expectedApp : true;
    const healthy = response.ok && payload?.status === "ok" && appMatches;
    const message =
      healthy
        ? null
        : !response.ok || payload?.status !== "ok"
          ? `Health endpoint returned ${response.status}.`
          : `Health endpoint app mismatch: expected ${expectedApp}, got ${app ?? "unknown"}.`;

    return {
      ok: healthy,
      status: response.status,
      app,
      expectedApp,
      message,
      url,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      app: null,
      expectedApp,
      message: error instanceof Error ? error.message : "Unknown health check failure.",
      url,
    };
  }
}

/**
 * @param {{ baseUrl?: string, canaryBypassToken?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<LaunchReadinessCheckResult>}
 */
export async function checkLaunchReadinessEndpoint(options = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_CANARY_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const canaryBypassToken = options.canaryBypassToken ?? process.env.CANARY_BYPASS_TOKEN;
  const url = new URL("/api/launch-readiness", baseUrl).toString();

  if (!isConfiguredSecret(canaryBypassToken)) {
    return {
      ok: false,
      status: null,
      message: "Missing CANARY_BYPASS_TOKEN; launch readiness signals cannot be checked.",
      url,
      blockers: ["missing_canary_bypass_token"],
      signals: null,
      metaAdsBeta: null,
    };
  }
  const canaryToken = String(canaryBypassToken).trim();

  try {
    const response = await fetchImpl(url, {
      headers: {
        "user-agent": "0509-prod-canary/1.0",
        "x-0509-canary-token": canaryToken,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({}));
    const blockers = Array.isArray(payload?.blockers) ? payload.blockers : [];
    const metaAdsBeta =
      payload?.metaAdsBeta && typeof payload.metaAdsBeta === "object"
        ? payload.metaAdsBeta
        : null;

    return {
      ok: response.ok && payload?.ok === true,
      status: response.status,
      message:
        response.ok && payload?.ok === true
          ? null
          : (payload?.message ?? (blockers.join(", ") || `Launch readiness returned ${response.status}.`)),
      url,
      blockers,
      signals: payload?.signals ?? null,
      metaAdsBeta,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      message: error instanceof Error ? error.message : "Unknown launch readiness check failure.",
      url,
      blockers: ["launch_readiness_unreachable"],
      signals: null,
      metaAdsBeta: null,
    };
  }
}

/**
 * @param {ProductionCanaryOptions} [options]
 */
export async function runProductionCanary(options = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_CANARY_BASE_URL;
  const expectedApp = options.expectedApp ?? DEFAULT_CANARY_EXPECTED_APP;
  const queries = options.queries?.length ? options.queries : [...DOGFOOD_QUERIES];
  const country = options.country ?? DEFAULT_COUNTRY;
  const mode = options.mode ?? DEFAULT_MODE;
  const benchmarkImpl = options.benchmarkImpl ?? benchmarkProviders;
  const canaryBypassToken = options.canaryBypassToken ?? process.env.CANARY_BYPASS_TOKEN;
  const freshLiveBypass = {
    required: true,
    configured: isConfiguredSecret(canaryBypassToken),
    message: isConfiguredSecret(canaryBypassToken)
      ? null
      : "Missing CANARY_BYPASS_TOKEN; canary cannot prove it bypassed cache and provider cooldown.",
  };
  const searchTimeoutMs = options.searchTimeoutMs ?? DEFAULT_CANARY_FRESH_LIVE_SEARCH_TIMEOUT_MS;
  const metaAdsStrict = options.metaAdsStrict === true;
  const healthChecks = [];
  for (const healthBaseUrl of resolveHealthBaseUrls(options, baseUrl)) {
    healthChecks.push(
      await checkHealthEndpoint({
        baseUrl: healthBaseUrl,
        expectedApp,
        fetchImpl: options.fetchImpl,
      }),
    );
  }
  const health = healthChecks[0] ?? {
    ok: false,
    status: null,
    app: null,
    expectedApp,
    message: "No health endpoints configured.",
    url: new URL("/api/health", baseUrl).toString(),
  };
  const launchReadiness = await checkLaunchReadinessEndpoint({
    baseUrl,
    canaryBypassToken,
    fetchImpl: options.fetchImpl,
  });
  const results = await benchmarkImpl({
    providers: ["current_0509"],
    queries,
    country,
    mode,
    baseUrl,
    forceLive: true,
    canaryBypassToken,
    timeoutMs: searchTimeoutMs,
  });
  const blockingFailures = findBlockingFreshLiveCurrent0509Failures(results);
  const metaAdsBeta = {
    beta: true,
    strict: metaAdsStrict,
    status: blockingFailures.length === 0 ? "ok" : "needs_proof",
    failures: blockingFailures,
    readiness: launchReadiness.metaAdsBeta ?? null,
  };

  return {
    passed:
      healthChecks.every((check) => check.ok) &&
      launchReadiness.ok &&
      freshLiveBypass.configured &&
      (!metaAdsStrict || blockingFailures.length === 0),
    generatedAt: new Date().toISOString(),
    baseUrl,
    health,
    healthChecks,
    launchReadiness,
    queries,
    country,
    mode,
    requireFreshLive: true,
    freshLiveBypass,
    blockingFailures,
    metaAdsBeta,
    results,
  };
}

/**
 * @param {Awaited<ReturnType<typeof runProductionCanary>>} report
 */
export function formatProductionCanaryReport(report) {
  const healthChecks = report.healthChecks?.length ? report.healthChecks : [report.health];
  const lines = healthChecks.map(
    (health) => `health: ${health.ok ? "ok" : "failed"} (${health.status ?? "no response"}) ${health.url}`,
  );

  for (const health of healthChecks) {
    if (health.message) {
      lines.push(`health note: ${health.url} ${health.message}`);
    }
  }

  if (report.freshLiveBypass?.required) {
    lines.push(
      report.freshLiveBypass.configured
        ? "fresh-live bypass: ok"
        : `fresh-live bypass: failed (${report.freshLiveBypass.message})`,
    );
  }

  if (report.launchReadiness) {
    lines.push(
      report.launchReadiness.ok
        ? "ops readiness: ok"
        : `ops readiness: failed (${report.launchReadiness.message})`,
    );
  }

  if (report.metaAdsBeta?.status === "needs_proof") {
    const readinessNote = formatReadinessNote(report.metaAdsBeta.readiness);
    lines.push(`meta ads beta: needs proof${readinessNote}`);
    lines.push(
      `meta ads probe: ${report.blockingFailures
        .map((result) => `${result.query} (${result.status}, ${result.sourceLabel ?? "no source"})`)
        .join(", ")}`,
    );
    if (report.metaAdsBeta.strict) {
      lines.push("meta ads strict gate: failed");
    }
  } else if (report.metaAdsBeta?.beta) {
    lines.push("meta ads beta: ok");
  } else if (report.blockingFailures.length === 0) {
    lines.push("search: ok");
  } else {
    lines.push(
      `search: failed for ${report.blockingFailures
        .map((result) => `${result.query} (${result.status}, ${result.sourceLabel ?? "no source"})`)
        .join(", ")}`,
    );
  }

  return lines.join("\n");
}

/**
 * @param {unknown} readiness
 */
function formatReadinessNote(readiness) {
  if (!readiness || typeof readiness !== "object") {
    return "";
  }

  const value = /** @type {{ samples?: unknown, sampleTarget?: unknown, successRate?: unknown }} */ (readiness);
  return ` (${formatNumber(value.samples, 0)}/${formatNumber(value.sampleTarget, 20)} samples, ${formatPercent(value.successRate)} success)`;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function formatNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * @param {unknown} value
 */
function formatPercent(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value * 100)}%`
    : "0%";
}
