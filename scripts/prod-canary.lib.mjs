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
 *   baseUrl?: string,
 *   healthBaseUrls?: string[],
 *   expectedApp?: string | null,
 *   queries?: string[],
 *   country?: string,
 *   mode?: "advertiser" | "keyword",
 *   fetchImpl?: typeof fetch,
 *   benchmarkImpl?: typeof benchmarkProviders,
 *   canaryBypassToken?: string
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
  const results = await benchmarkImpl({
    providers: ["current_0509"],
    queries,
    country,
    mode,
    baseUrl,
    forceLive: true,
    canaryBypassToken,
  });
  const blockingFailures = findBlockingFreshLiveCurrent0509Failures(results);

  return {
    passed: healthChecks.every((check) => check.ok) && blockingFailures.length === 0,
    generatedAt: new Date().toISOString(),
    baseUrl,
    health,
    healthChecks,
    queries,
    country,
    mode,
    requireFreshLive: true,
    blockingFailures,
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

  if (report.blockingFailures.length === 0) {
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
