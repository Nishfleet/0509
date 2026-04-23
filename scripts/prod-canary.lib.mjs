import {
  DEFAULT_COUNTRY,
  DEFAULT_MODE,
  DOGFOOD_QUERIES,
  benchmarkProviders,
  findBlockingCurrent0509Failures,
} from "./provider-bakeoff.lib.mjs";

export const DEFAULT_CANARY_BASE_URL = "https://0509.in";

/**
 * @typedef {{
 *   ok: boolean,
 *   status: number | null,
 *   app: string | null,
 *   message: string | null,
 *   url: string
 * }} HealthCheckResult
 */

/**
 * @typedef {{
 *   baseUrl?: string,
 *   queries?: string[],
 *   country?: string,
 *   mode?: "advertiser" | "keyword",
 *   fetchImpl?: typeof fetch,
 *   benchmarkImpl?: typeof benchmarkProviders
 * }} ProductionCanaryOptions
 */

/**
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<HealthCheckResult>}
 */
export async function checkHealthEndpoint(options = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_CANARY_BASE_URL;
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
    const healthy = response.ok && payload?.status === "ok";

    return {
      ok: healthy,
      status: response.status,
      app,
      message: healthy ? null : `Health endpoint returned ${response.status}.`,
      url,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      app: null,
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
  const queries = options.queries?.length ? options.queries : [...DOGFOOD_QUERIES];
  const country = options.country ?? DEFAULT_COUNTRY;
  const mode = options.mode ?? DEFAULT_MODE;
  const benchmarkImpl = options.benchmarkImpl ?? benchmarkProviders;
  const health = await checkHealthEndpoint({
    baseUrl,
    fetchImpl: options.fetchImpl,
  });
  const results = await benchmarkImpl({
    providers: ["current_0509"],
    queries,
    country,
    mode,
    baseUrl,
  });
  const blockingFailures = findBlockingCurrent0509Failures(results);

  return {
    passed: health.ok && blockingFailures.length === 0,
    generatedAt: new Date().toISOString(),
    baseUrl,
    health,
    queries,
    country,
    mode,
    blockingFailures,
    results,
  };
}

/**
 * @param {Awaited<ReturnType<typeof runProductionCanary>>} report
 */
export function formatProductionCanaryReport(report) {
  const lines = [
    `health: ${report.health.ok ? "ok" : "failed"} (${report.health.status ?? "no response"}) ${report.health.url}`,
  ];

  if (report.health.message) {
    lines.push(`health note: ${report.health.message}`);
  }

  if (report.blockingFailures.length === 0) {
    lines.push("search: ok");
  } else {
    lines.push(
      `search: failed for ${report.blockingFailures
        .map((result) => `${result.query} (${result.status})`)
        .join(", ")}`,
    );
  }

  return lines.join("\n");
}
