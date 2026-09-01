/**
 * Locale-prefix buyer-surface canary library (issue #1501).
 *
 * Pure functions shared between the CLI script
 * (`scripts/canary-locale-prefix-routes.mjs`) and its unit test
 * (`tests/canary-locale-prefix-routes.test.ts`). Keeping the surface
 * here lets the test exercise every probe shape without spawning a
 * child process or stubbing the entire script module.
 *
 * Probes every URL the issue's `verify:` block requires to return 200:
 *
 *   for loc in de ja pt-br fr es; do
 *     for r in / /pricing /sitemap.xml /help /docs /api/docs /status \
 *              /changelog /trust /compare; do
 *       code=$(curl -sS -o /dev/null -w "%{http_code}" "https://0509.io/$loc$r")
 *       [ "$code" = "200" ] || exit 1
 *     done
 *   done
 *
 * Same surface list, same locales, same expectation. `runCanary` returns
 * a report whose `passed` field is the canary's verdict; the CLI script
 * maps it to the process exit code so the operator's canary lane fails
 * closed on the first non-200 probe.
 */

export const DEFAULT_BASE_URL = "https://0509.io";
export const DEFAULT_TIMEOUT_MS = 20_000;

export const LOCALE_PREFIXES = ["de", "ja", "pt-br", "fr", "es"];
// Mirrors BUYER_SURFACE_PATHS minus the `/` index (the cluster's bare
// `/{locale}` is canonicalized to `/`, so a 200 on `/` proves `/<locale>`
// works) and minus `/sitemap.xml` (worker-handled; the route file's safety
// net still 200s). Listed explicitly here so the canary script is
// self-contained and survives a `locale-markets.ts` edit that the
// operator's canary lane has not yet pulled.
export const ROUTES = [
  "/",
  "/pricing",
  "/sitemap.xml",
  "/help",
  "/docs",
  "/api/docs",
  "/status",
  "/changelog",
  "/trust",
  "/compare",
];

/**
 * Build the URL the canary probes for a single (locale, route) pair.
 * Strips trailing slashes from `baseUrl` so a misconfigured
 * `--base-url https://0509.io/` does not produce `https://0509.io//de`.
 * The bare `/` route is the cluster's `/{locale}` index, so the
 * concatenation collapses to `${baseUrl}/${locale}` with no trailing
 * slash.
 */
/**
 * @param {string} baseUrl
 * @param {string} locale
 * @param {string} route
 * @returns {string}
 */
export function probeUrl(baseUrl, locale, route) {
  const trimmedRoute = route === "/" ? "" : route;
  return `${baseUrl.replace(/\/+$/, "")}/${locale}${trimmedRoute}`;
}

/**
 * Probe a single URL and return its HTTP status. Network / DNS / timeout
 * errors surface as `null` so the report can distinguish "the server
 * answered with 4xx/5xx" from "the canary could not reach the server".
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @param {typeof fetch} [fetchImpl]
 */
export async function probe(url, timeoutMs, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "0509-locale-prefix-canary/1.0" },
    });
    return { status: response.status, ok: response.status === 200 };
  } catch (error) {
    return { status: null, ok: false, error: error instanceof Error ? error.name : "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the full locale-prefix cluster probe and return a verdict report.
 * The canary's pass condition is `failures.length === 0` — every probed
 * URL must return 200, no exceptions. A single 404 or 5xx anywhere in
 * the cluster fails the canary.
 *
 * @typedef {Object} CanaryProbe
 * @property {string} locale
 * @property {string} route
 * @property {string} url
 * @property {number | null} status
 * @property {boolean} ok
 * @property {string} [error]
 *
 * @typedef {Object} CanaryReport
 * @property {boolean} passed
 * @property {string} generatedAt
 * @property {string} baseUrl
 * @property {CanaryProbe[]} probes
 * @property {CanaryProbe[]} failures
 *
 * @param {{ baseUrl: string; timeoutMs?: number; fetchImpl?: typeof fetch }} options
 * @returns {Promise<CanaryReport>}
 */
export async function runCanary(options) {
  const probes = [];
  for (const locale of LOCALE_PREFIXES) {
    for (const route of ROUTES) {
      const url = probeUrl(options.baseUrl, locale, route);
      const result = await probe(url, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.fetchImpl);
      probes.push({ locale, route, url, ...result });
    }
  }
  const failures = probes.filter((entry) => !entry.ok);
  return {
    passed: failures.length === 0,
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    probes,
    failures,
  };
}

/**
 * Render the verdict report as a one-shot human-readable summary. The
 * failing probes are listed in place (in cluster-iteration order) so the
 * operator can see the full damage at a glance; the "first failing
 * probe" footer mirrors the issue verification loop's `exit 1` point so
 * a quick re-run on the failing URL is one `curl` away.
 *
 * @param {CanaryReport} report
 * @returns {string}
 */
export function formatReport(report) {
  const lines = [];
  lines.push("locale-prefix buyer-surface canary");
  lines.push(`base url: ${report.baseUrl}`);
  lines.push(`probes: ${report.probes.length} (failures: ${report.failures.length})`);
  lines.push(`result: ${report.passed ? "ok" : "FAILED"}`);
  for (const probe of report.probes) {
    const status = probe.status === null ? `error(${probe.error ?? "unknown"})` : String(probe.status);
    const marker = probe.ok ? "ok" : "FAIL";
    lines.push(`  [${marker}] /${probe.locale}${probe.route} -> ${status}`);
  }
  if (!report.passed) {
    lines.push("");
    lines.push("first failing probe:");
    const first = report.failures[0];
    if (first) {
      lines.push(`  /${first.locale}${first.route} -> ${first.status === null ? "error" : first.status}`);
    }
  }
  return lines.join("\n");
}
