/**
 * Locale-prefix redirect canary library (issue #2962, orchestrator Branch B).
 *
 * Pure functions shared between the CLI script
 * (`scripts/canary-locale-prefix-routes.mjs`) and its unit test
 * (`tests/locale-prefix-routes-guard.test.ts`). Keeping the surface
 * here lets the test exercise every probe shape without spawning a
 * child process or stubbing the entire script module.
 *
 * The untranslated buyer-surface locale cluster (`$locale.*` routes from
 * issue #1501) is DELETED: those pages served byte-identical English copy
 * with `lang="en"` and `canonical → the EN twin` yet declared hreflang
 * variants — an audit defect. Every formerly-200 URL must now 301 to its EN
 * pathname so nothing already indexed dead-ends on a 404:
 *
 *   for loc in de ja pt-br fr es; do
 *     for r in / /pricing /help ... /compare/panoramata /ads/nike.com; do
 *       code=$(curl -sS -o /dev/null -w "%{http_code}" "https://0509.io/$loc$r")
 *       [ "$code" = "301" ] || exit 1
 *     done
 *   done
 *
 * The genuinely translated sneaker-resale cluster (issue #1457/#1460) is
 * untouched and is the positive control: `/de|ja|pt-br/sneaker-resale` must
 * still serve 200. This detector is wired as the post-deploy probe the
 * issue's mechanical-fix clause asks for — it observes that the defect class
 * is closed and fails closed on regression (a route file reintroduced under
 * a locale prefix stops 301ing and the canary goes red).
 *
 * Pure functions shared between the CLI script
 * (`scripts/canary-locale-prefix-routes.mjs`) and its unit test
 * (`tests/locale-prefix-routes-guard.test.ts`).
 */

export const DEFAULT_BASE_URL = "https://0509.io";
export const DEFAULT_TIMEOUT_MS = 20_000;

export const LOCALE_PREFIXES = ["de", "ja", "pt-br", "fr", "es"];

/**
 * The buyer-surface routes that used to serve 200 under every locale prefix
 * (issues #1501/#1563/#1578 + the #1562 programmatic surface). Each must now
 * respond `301` with `Location` = the same pathname without the locale
 * prefix (query preserved). The bare `/` route is the cluster's bare
 * `/{locale}` index and 301s to `/`.
 */
const REDIRECT_ROUTES = [
  "/",
  "/pricing",
  "/help",
  "/docs",
  "/api/docs",
  "/status",
  "/changelog",
  "/trust",
  "/compare",
  "/search",
  "/competitor-monitoring",
  "/capture-rules",
  "/methodology",
  // Compare children (the EN pages stay live; the locale paths 301 to them).
  "/compare/panoramata",
  "/compare/meta-ad-library",
  "/compare/visualping",
  "/compare/visualping-ad-library",
  "/compare/visualping-ad-libraries",
  "/compare/spyland",
  "/compare/pulzifi",
  "/compare/foreplay",
  "/compare/foreplay-spyder",
  "/compare/adspyder",
  "/compare/adspy",
  "/compare/keeptabz",
  "/compare/gethookd",
  "/compare/bigspy",
  "/compare/minea",
  "/compare/poweradspy",
  "/switch/panoramata",
  "/switch/visualping",
  "/switch/magicbrief",
  "/switch/adspy",
  // The /guides/* how-to cluster served 200 under every locale prefix in
  // production (issues #2294/#3093) — its locale URLs are already indexed,
  // so each must 301 to the EN guide, never 404.
  "/guides/how-to-track-competitor-ads",
  "/guides/how-to-monitor-meta-ad-library",
  "/guides/how-to-monitor-competitor-landing-page-changes",
  "/guides/how-to-get-alerted-when-a-competitor-changes-their-offer",
  "/guides/how-to-prove-what-changed-on-a-competitor-website",
  "/guides/how-to-turn-a-one-off-competitor-check-into-a-standing-watch",
  "/ads/nike.com",
];

/** The translated sneaker-resale cluster: must keep serving 200 per locale. */
const TRANSLATED_LOCALE_PREFIXES = ["de", "ja", "pt-br"];

/**
 * The URL the canary probes for a single (locale, route) pair. Trailing
 * slashes on `baseUrl` are stripped so a misconfigured
 * `--base-url https://0509.io/` does not produce `https://0509.io//de`.
 * @param {string} baseUrl
 * @param {string} locale
 * @param {string} route
 */
export function probeUrl(baseUrl, locale, route) {
  const trimmedRoute = route === "/" ? "" : route;
  return `${baseUrl.replace(/\/+$/, "")}/${locale}${trimmedRoute}`;
}

/**
 * The expected EN target for a probe. `/pricing` under any locale prefix
 * expects `Location: /pricing`; the bare index expects `/`.
 */
export function expectedLocationFor(
  /** @type {"de" | "ja" | "pt-br" | "fr" | "es"} */ locale,
  /** @type {string} */ route,
) {
  void locale;
  return route === "/" ? "/" : route;
}

/**
 * Probe a single URL. Returns `{ status, location }`; network errors surface
 * as `null` fields so the report can distinguish "the server answered
 * wrong" from "the canary could not reach the server".
 * @param {string} url
 * @param {number} timeoutMs
 * @param {typeof globalThis.fetch} [fetchImpl]
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
    return {
      status: response.status,
      location: response.headers.get("location"),
    };
  } catch (error) {
    return { status: null, location: null, error: error instanceof Error ? error.name : "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

/** Strip scheme + origin so a `Location` header can be compared to a route.
 * @param {string | null} location
 * @returns {string | null}
 */
function locationPath(location) {
  try {
    return new URL(location, "https://0509.io").pathname;
  } catch {
    return null;
  }
}

/**
 * Run the full redirect + survivor-cluster probe and return a verdict
 * report. Pass condition: every locale × redirect-route probe returns 301
 * with `Location` equal to the EN pathname, and every translated
 * sneaker-resale probe (de/ja/pt-br) returns 200. Anything else fails
 * closed.
 * @param {{ baseUrl: string, timeoutMs?: number, fetchImpl?: typeof globalThis.fetch }} options
 * @returns {Promise<{ passed: boolean, generatedAt: string, baseUrl: string, probes: Array<{ locale: string, route: string, url: string, expectedStatus: number, expectedLocation: string, status: number | null, location: string | null, ok: boolean, error?: string }>, failures: Array<{ locale: string, route: string, url: string, expectedStatus: number, expectedLocation: string, status: number | null, location: string | null, ok: boolean, error?: string }> }>}
 */
export async function runCanary(options) {
  const probes = [];

  for (const locale of LOCALE_PREFIXES) {
    for (const route of REDIRECT_ROUTES) {
      const url = probeUrl(options.baseUrl, locale, route);
      const result = await probe(url, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.fetchImpl);
      const expectedLocation = expectedLocationFor(locale, route);
      const ok =
        result.status === 301 &&
        !!result.location &&
        locationPath(result.location) === expectedLocation;
      probes.push({ locale, route, url, expectedStatus: 301, expectedLocation, ...result, ok });
    }
    // Survivor checks: the translated sneaker-resale cluster keeps its 200s.
    if (locale === "de" || locale === "ja" || locale === "pt-br") {
      const url = probeUrl(options.baseUrl, locale, "/sneaker-resale");
      const result = await probe(url, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.fetchImpl);
      probes.push({
        locale,
        route: "/sneaker-resale",
        url,
        expectedStatus: 200,
        ...result,
        ok: result.status === 200,
      });
    }
  }

  const failures = probes.filter((probe) => !probe.ok);
  return {
    passed: failures.length === 0,
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    probes,
    failures,
  };
}

/**
 * Render the verdict report as a one-shot human-readable summary. Failing
 * probes are listed in place (cluster-iteration order) so the operator can
 * see the full damage at a glance; the "first failing probe" footer mirrors
 * the issue verification loop's `exit 1` point.
 * @param {ReturnType<typeof runCanary>} report
 * @returns {string}
 */
export function formatReport(report) {
  const lines = [];
  lines.push("locale-prefix redirect canary");
  lines.push(`base url: ${report.baseUrl}`);
  lines.push(`probes: ${report.probes.length} (failures: ${report.failures.length})`);
  lines.push(`result: ${report.passed ? "ok" : "FAILED"}`);
  for (const probe of report.probes) {
    const status = probe.status === null ? `error(${probe.error ?? "unknown"})` : String(probe.status);
    const marker = probe.ok ? "ok" : "FAIL";
    const location = probe.location ? ` -> ${probe.location}` : "";
    lines.push(`  [${marker}] /${probe.locale}${probe.route} -> ${status}${location}`);
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
