import { performance } from "node:perf_hooks";

import { extractHtmlViaCdp } from "./provider-bakeoff.cdp.mjs";

export const AD_LIBRARY_RESULT_SELECTOR =
  'a[href*="/ads/library/?id="], a[href*="facebook.com/ads/library/?id="]';
export const DEFAULT_COUNTRY = "India";
export const DEFAULT_MODE = "advertiser";
export const DEFAULT_PROVIDERS = Object.freeze([
  "current_0509",
  "browserless_bql",
  "browserbase",
  "brightdata",
  "zyte_api",
]);
export const DOGFOOD_QUERIES = Object.freeze([
  "nykaa",
  "boat",
  "mamaearth",
  "swiggy",
  "zomato",
  "meesho",
]);
export const FRESH_LIVE_CURRENT_0509_TIMEOUT_MS = 60_000;
export const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
export const CURRENT_0509_PROBE_TIMEOUT_MS = 10_000;

const MOBILE_VIEWPORT = Object.freeze({
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
const BROWSERLESS_RENDER_WAIT_MS = 5_000;

const BROWSERLESS_BQL_MUTATION = `
mutation MetaLibraryBakeoff($url: String!, $userAgent: String!) {
  userAgent(userAgent: $userAgent) {
    time
  }
  viewport(
    width: ${MOBILE_VIEWPORT.width}
    height: ${MOBILE_VIEWPORT.height}
    deviceScaleFactor: ${MOBILE_VIEWPORT.deviceScaleFactor}
    mobile: ${String(MOBILE_VIEWPORT.mobile)}
  ) {
    width
    height
    deviceScaleFactor
    mobile
  }
  goto(url: $url) {
    status
  }
  waitForTimeout(time: ${BROWSERLESS_RENDER_WAIT_MS}) {
    time
  }
  html {
    html
  }
}
`.trim();

/**
 * @typedef {"advertiser" | "keyword"} SearchMode
 */

/**
 * @typedef {"current_0509" | "browserless_bql" | "browserbase" | "brightdata" | "zyte_api"} ProviderName
 */

/**
 * @typedef {"ok" | "empty" | "blocked" | "rate_limited" | "error" | "skipped"} ProbeStatus
 */

/**
 * @typedef {{
 *   provider: ProviderName,
 *   query: string,
 *   country: string,
 *   mode: SearchMode
 * }} ProbeTarget
 */

/**
 * @typedef {{
 *   libraryIds: string[],
 *   matchCount: number,
 *   loginWall: boolean,
 *   rateLimited: boolean,
 *   blockedLikely: boolean,
 *   degraded: boolean,
 *   emptyReason: string | null,
 *   sourceLabel: string | null,
 *   resultCount: number | null,
 *   noAdsFound: boolean
 * }} HtmlAnalysis
 */

/**
 * @typedef {{
 *   provider: ProviderName,
 *   query: string,
 *   country: string,
 *   mode: SearchMode,
 *   status: ProbeStatus,
 *   latencyMs: number,
 *   httpStatus: number | null,
 *   siteStatus: number | null,
 *   matchCount: number,
 *   loginWall: boolean,
 *   rateLimited: boolean,
 *   blockedLikely: boolean,
 *   degraded: boolean,
 *   emptyReason?: string | null,
 *   sourceLabel: string | null,
 *   url: string,
 *   note: string | null
 * }} ProbeResult
 */

/**
 * @typedef {Record<string, string | undefined>} ProviderEnv
 */

/**
 * @typedef {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} FetchImpl
 */

/**
 * @typedef {(options: {
 *   wsUrl: string,
 *   url: string,
 *   selector: string,
 *   userAgent: string,
 *   viewport: typeof MOBILE_VIEWPORT,
 *   timeoutMs?: number
 * }) => Promise<{ html: string, pageState: { hasSelector: boolean, readyState: string, loginWall: boolean, rateLimited: boolean, blockedLikely: boolean } }>} ExtractCdpImpl
 */

/**
 * @param {string | undefined} country
 */
function countryCode(country) {
  if (!country) {
    return "IN";
  }

  const normalized = country.trim().toLowerCase();
  if (normalized === "india") {
    return "IN";
  }
  if (normalized === "united states" || normalized === "usa" || normalized === "us") {
    return "US";
  }
  if (normalized === "united kingdom" || normalized === "uk") {
    return "GB";
  }

  return country.toUpperCase();
}

/**
 * @param {{ query: string, country?: string, mode?: SearchMode }} target
 */
export function buildMetaLibraryUrl(target) {
  const params = new URLSearchParams();
  params.set("active_status", "all");
  params.set("ad_type", "all");
  params.set("country", countryCode(target.country));
  params.set("is_targeted_country", "false");
  params.set("media_type", "all");
  params.set("search_type", target.mode === "keyword" ? "keyword_unordered" : "keyword_exact_phrase");
  params.set("q", target.query);
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

/**
 * @param {{ query: string, country?: string, mode?: SearchMode, baseUrl?: string, forceLive?: boolean }} target
 */
export function buildCurrent0509SearchUrl(target) {
  const url = new URL("/search", target.baseUrl ?? "https://0509.io");
  url.searchParams.set("query", target.query);
  url.searchParams.set("country", target.country ?? DEFAULT_COUNTRY);
  url.searchParams.set("mode", target.mode ?? DEFAULT_MODE);
  if (target.forceLive) {
    url.searchParams.set("fresh", "live");
  }
  return url.toString();
}

/**
 * @param {string} html
 */
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} html
 * @returns {HtmlAnalysis}
 */
export function analyzeMetaLibraryHtml(html) {
  const libraryIds = new Set();
  for (const match of html.matchAll(/(?:\/ads\/library\/\?id=|facebook\.com\/ads\/library\/\?id=)(\d+)/gi)) {
    if (match[1]) {
      libraryIds.add(match[1]);
    }
  }

  const text = stripHtml(html).toLowerCase();
  const hasLogin = /(log in|login|sign in|sign into)/.test(text);
  const mentionsFacebook = text.includes("facebook") || text.includes("meta ad library");
  const renderedText = stripHtml(html);
  const sourceMatch = renderedText.match(
    /(?:source:\s*|tracking path:\s*|meta ads beta\s*[·-]\s*|results:\s*)(recent results|fresh results delayed|fresh results|sample results|cached live results|live ad library capture|customer api fallback|workspace meta access|api fallback|demo dataset)/i,
  );
  const sourceMarkerMatch = html.match(
    /\bdata-f9-result-source=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i,
  );
  const cacheMarkerMatch = html.match(
    /\bdata-f9-result-cache-status=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i,
  );
  const emptyReasonMarkerMatch = html.match(
    /\bdata-f9-result-empty-reason=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i,
  );
  const resultCountMatch = renderedText.match(/\b(\d+)\s+ads?\s+(?:found|on\s+this\s+page)\b/i);
  const sourceMarker = sourceMarkerMatch?.[1] ?? sourceMarkerMatch?.[2] ?? sourceMarkerMatch?.[3] ?? "";
  const cacheMarker = cacheMarkerMatch?.[1] ?? cacheMarkerMatch?.[2] ?? cacheMarkerMatch?.[3] ?? "";
  const emptyReasonMarker =
    emptyReasonMarkerMatch?.[1] ?? emptyReasonMarkerMatch?.[2] ?? emptyReasonMarkerMatch?.[3] ?? "";
  const sourceLabel =
    normalizeCurrent0509SourceMarker(sourceMarker, cacheMarker) ??
    (sourceMatch?.[1] ? normalizeCurrent0509SourceLabel(sourceMatch[1]) : null);

  return {
    libraryIds: [...libraryIds],
    matchCount: libraryIds.size,
    loginWall: hasLogin && mentionsFacebook,
    rateLimited:
      text.includes("rate limit") ||
      text.includes("too many requests") ||
      text.includes("try again later"),
    blockedLikely:
      text.includes("captcha") ||
      text.includes("access denied") ||
      text.includes("temporarily blocked") ||
      text.includes("unusual activity"),
    degraded: text.includes("commercial discovery degraded") || text.includes("live search is delayed"),
    emptyReason: normalizeCurrent0509EmptyReason(emptyReasonMarker),
    sourceLabel,
    resultCount: resultCountMatch?.[1] ? Number(resultCountMatch[1]) : null,
    noAdsFound: text.includes("no ads found for this query"),
  };
}

/**
 * @param {string} value
 */
function normalizeCurrent0509SourceLabel(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "customer api fallback") {
    return "API fallback";
  }
  if (normalized === "workspace meta access") {
    return "API fallback";
  }
  if (normalized === "api fallback") {
    return "API fallback";
  }
  if (normalized === "cached live results") {
    return "Cached live results";
  }
  if (normalized === "recent results") {
    return "Cached live results";
  }
  if (normalized === "live ad library capture") {
    return "Live Ad Library capture";
  }
  if (normalized === "fresh results") {
    return "Fresh results";
  }
  if (normalized === "fresh results delayed") {
    return "Fresh results delayed";
  }
  if (normalized === "sample results") {
    return "Demo dataset";
  }
  if (normalized === "demo dataset") {
    return "Demo dataset";
  }
  return value.trim();
}

/**
 * @param {string} source
 * @param {string} cacheStatus
 */
function normalizeCurrent0509SourceMarker(source, cacheStatus = "") {
  const normalizedSource = source.trim().toLowerCase();
  const normalizedCacheStatus = cacheStatus.trim().toLowerCase();
  if (normalizedCacheStatus === "hit" || normalizedCacheStatus === "stale") {
    return "Cached live results";
  }
  if (normalizedSource === "meta_library_browser") {
    return "Live Ad Library capture";
  }
  if (normalizedSource === "meta_api" || normalizedSource === "meta") {
    return "API fallback";
  }
  if (normalizedSource === "demo") {
    return "Demo dataset";
  }
  return null;
}

/**
 * @param {string} value
 */
function normalizeCurrent0509EmptyReason(value) {
  const normalized = value.trim().toLowerCase();
  return normalized && normalized !== "none" ? normalized : null;
}

/**
 * @param {Response} response
 */
function isCurrent0509LoginRedirect(response) {
  if (response.status < 300 || response.status >= 400) {
    return false;
  }
  const location = response.headers?.get?.("location") ?? "";
  return /\/auth\/login\b/i.test(location);
}

/**
 * @param {Response} response
 */
function isCurrent0509NonPublicSearchResponse(response) {
  return response.status === 404 || isCurrent0509LoginRedirect(response);
}

/**
 * @param {string | null | undefined} note
 */
function classifyErrorStatus(note) {
  const lower = (note ?? "").toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests")) {
    return "rate_limited";
  }
  if (lower.includes("captcha") || lower.includes("login") || lower.includes("blocked") || lower.includes("access denied")) {
    return "blocked";
  }
  return "error";
}

/**
 * @param {ProviderEnv} env
 */
function encodeBasicAuth(env) {
  return `Basic ${Buffer.from(`${env.ZYTE_API_KEY ?? ""}:`).toString("base64")}`;
}

/**
 * @param {ProviderEnv} env
 */
function buildBrowserbaseSessionEndpoint(env = process.env) {
  return env.BROWSERBASE_API_URL || "https://api.browserbase.com/v1/sessions";
}

/**
 * @param {string} sessionId
 * @param {ProviderEnv} env
 */
function buildBrowserbaseSessionUrl(sessionId, env = process.env) {
  const endpoint = new URL(buildBrowserbaseSessionEndpoint(env));
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${encodeURIComponent(sessionId)}`;
  endpoint.search = "";
  return endpoint.toString();
}

/**
 * @param {ProbeTarget} target
 * @param {ProviderEnv} env
 */
export function buildBrowserbaseSessionRequest(target, env = process.env) {
  return {
    endpoint: buildBrowserbaseSessionEndpoint(env),
    headers: {
      "content-type": "application/json",
      "x-bb-api-key": env.BROWSERBASE_API_KEY ?? "",
    },
    body: {
      projectId: env.BROWSERBASE_PROJECT_ID,
      keepAlive: false,
      proxies: env.BROWSERBASE_PROXIES === "false" ? false : true,
      ...(env.BROWSERBASE_REGION ? { region: env.BROWSERBASE_REGION } : {}),
      ...(env.BROWSERBASE_VERIFIED === "true"
        ? {
            browserSettings: {
              verified: true,
            },
          }
        : {}),
      userMetadata: {
        source: "0509-provider-bakeoff",
        query: target.query,
      },
    },
  };
}

/**
 * @param {string} sessionId
 * @param {ProviderEnv} env
 */
export function buildBrowserbaseSessionReleaseRequest(sessionId, env = process.env) {
  return {
    endpoint: buildBrowserbaseSessionUrl(sessionId, env),
    headers: {
      "content-type": "application/json",
      "x-bb-api-key": env.BROWSERBASE_API_KEY ?? "",
    },
    body: {
      status: "REQUEST_RELEASE",
      ...(env.BROWSERBASE_PROJECT_ID ? { projectId: env.BROWSERBASE_PROJECT_ID } : {}),
    },
  };
}

/**
 * @param {ProviderEnv} env
 */
export function buildBrightDataWsUrl(env = process.env) {
  if (env.BRIGHT_DATA_BROWSER_WS) {
    return env.BRIGHT_DATA_BROWSER_WS;
  }
  if (!env.BRIGHT_DATA_USERNAME || !env.BRIGHT_DATA_PASSWORD) {
    return null;
  }
  return `wss://${encodeURIComponent(env.BRIGHT_DATA_USERNAME)}:${encodeURIComponent(env.BRIGHT_DATA_PASSWORD)}@brd.superproxy.io:9222`;
}

/**
 * @param {ProbeTarget} target
 * @param {ProviderEnv} env
 */
export function buildZyteRequest(target, env = process.env) {
  return {
    endpoint: env.ZYTE_API_URL || "https://api.zyte.com/v1/extract",
    headers: {
      authorization: encodeBasicAuth(env),
      "content-type": "application/json",
    },
    body: {
      url: buildMetaLibraryUrl(target),
      browserHtml: true,
      javascript: true,
      geolocation: countryCode(target.country),
      viewport: {
        width: MOBILE_VIEWPORT.width,
        height: MOBILE_VIEWPORT.height,
      },
      actions: [
        {
          action: "waitForSelector",
          selector: {
            type: "css",
            value: AD_LIBRARY_RESULT_SELECTOR,
            state: "attached",
          },
        },
      ],
    },
  };
}

/**
 * @param {HtmlAnalysis} analysis
 * @param {boolean} ok
 */
function classifyHtmlOutcome(analysis, ok) {
  if (!ok) {
    return "error";
  }
  if (analysis.rateLimited) {
    return "rate_limited";
  }
  if (analysis.loginWall || analysis.blockedLikely) {
    return "blocked";
  }
  if (analysis.matchCount > 0) {
    return "ok";
  }
  return "empty";
}

/**
 * @param {HtmlAnalysis} analysis
 * @param {boolean} ok
 */
function classifyCurrent0509Outcome(analysis, ok) {
  if (!ok) {
    return "error";
  }
  if (analysis.rateLimited) {
    return "rate_limited";
  }
  if (analysis.sourceLabel === "Demo dataset") {
    return "error";
  }
  if (
    analysis.emptyReason === "no_results" &&
    analysis.sourceLabel === "Live Ad Library capture" &&
    !analysis.degraded
  ) {
    return "ok";
  }
  if (analysis.resultCount === 0 || analysis.noAdsFound) {
    return "empty";
  }
  if (
    (analysis.sourceLabel === "Cached live results" ||
      analysis.sourceLabel === "API fallback" ||
      analysis.sourceLabel === "Live Ad Library capture") &&
    ((analysis.resultCount ?? 0) > 0 || analysis.matchCount > 0)
  ) {
    return "ok";
  }
  if (analysis.loginWall || analysis.blockedLikely) {
    return "blocked";
  }
  return classifyHtmlOutcome(analysis, ok);
}

/**
 * @param {ProbeTarget} target
 * @param {{ fetchImpl?: typeof fetch, baseUrl?: string, timeoutMs?: number, forceLive?: boolean, canaryBypassToken?: string }} [options]
 * @returns {Promise<ProbeResult>}
 */
export async function runCurrent0509Probe(target, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const isPrivateFreshLiveProbe = options.forceLive === true;
  const canaryBypassToken = isPrivateFreshLiveProbe ? options.canaryBypassToken?.trim() : undefined;
  const timeoutMs =
    options.timeoutMs ??
    (isPrivateFreshLiveProbe ? FRESH_LIVE_CURRENT_0509_TIMEOUT_MS : CURRENT_0509_PROBE_TIMEOUT_MS);
  const url = buildCurrent0509SearchUrl({
    query: target.query,
    country: target.country,
    mode: target.mode,
    baseUrl: options.baseUrl,
    forceLive: isPrivateFreshLiveProbe,
  });
  const startedAt = performance.now();
  const headers = {
    "user-agent": "0509-provider-bakeoff/1.0",
    ...(canaryBypassToken ? { "x-0509-canary-token": canaryBypassToken } : {}),
  };

  try {
    const response = await fetchImpl(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (isCurrent0509NonPublicSearchResponse(response)) {
      return {
        provider: "current_0509",
        query: target.query,
        country: target.country,
        mode: target.mode,
        status: isPrivateFreshLiveProbe ? "blocked" : "skipped",
        latencyMs: Math.round(performance.now() - startedAt),
        httpStatus: response.status,
        siteStatus: null,
        matchCount: 0,
        loginWall: true,
        rateLimited: false,
        blockedLikely: isPrivateFreshLiveProbe,
        degraded: false,
        sourceLabel: null,
        url,
        note: isPrivateFreshLiveProbe
          ? `Private current_0509 probe returned HTTP ${response.status}.`
          : "Current 0509 search results are not public; set CANARY_BYPASS_TOKEN for a private live probe.",
      };
    }
    const html = await response.text();
    const analysis = analyzeMetaLibraryHtml(html);
    const matchCount = analysis.resultCount ?? analysis.matchCount;

    return {
      provider: "current_0509",
      query: target.query,
      country: target.country,
      mode: target.mode,
      status: classifyCurrent0509Outcome(analysis, response.ok),
      latencyMs: Math.round(performance.now() - startedAt),
      httpStatus: response.status,
      siteStatus: null,
      matchCount,
      loginWall: analysis.loginWall,
      rateLimited: analysis.rateLimited,
      blockedLikely: analysis.blockedLikely,
      degraded: analysis.degraded,
      emptyReason: analysis.emptyReason,
      sourceLabel: analysis.sourceLabel,
      url,
      note: analysis.degraded
        ? "0509 rendered its delayed search state."
        : analysis.emptyReason === "no_results" && analysis.sourceLabel === "Live Ad Library capture"
          ? "Tracking path: Live Ad Library capture returned a verified no-results page"
        : analysis.noAdsFound || analysis.resultCount === 0
          ? `Tracking path: ${analysis.sourceLabel ?? "unknown"} returned zero rendered results`
        : analysis.sourceLabel
          ? `Tracking path: ${analysis.sourceLabel}`
          : null,
    };
  } catch (error) {
    return {
      provider: "current_0509",
      query: target.query,
      country: target.country,
      mode: target.mode,
      status: "error",
      latencyMs: Math.round(performance.now() - startedAt),
      httpStatus: null,
      siteStatus: null,
      matchCount: 0,
      loginWall: false,
      rateLimited: false,
      blockedLikely: false,
      degraded: false,
      sourceLabel: null,
      url,
      note: error instanceof Error ? error.message : "Unknown current_0509 probe failure.",
    };
  }
}

/**
 * @param {ProviderEnv} env
 */
function buildBrowserlessEndpoint(env) {
  const rawBase =
    env.BROWSERLESS_BQL_URL ||
    env.BROWSERLESS_URL ||
    "https://production-sfo.browserless.io/stealth/bql";
  const url = new URL(rawBase);
  if (!url.pathname.endsWith("/stealth/bql") && !url.pathname.endsWith("/chromium/bql")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/stealth/bql`;
  }
  return url;
}

/**
 * @param {ProbeTarget} target
 * @param {ProviderEnv} env
 */
export function buildBrowserlessBqlRequest(target, env = process.env) {
  const endpoint = buildBrowserlessEndpoint(env);
  const token = env.BROWSERLESS_TOKEN ?? "";
  if (token) {
    endpoint.searchParams.set("token", token);
  }

  return {
    endpoint: endpoint.toString(),
    body: {
      query: BROWSERLESS_BQL_MUTATION,
      variables: {
        url: buildMetaLibraryUrl(target),
        userAgent: MOBILE_USER_AGENT,
      },
    },
  };
}

/**
 * @param {ProbeTarget} target
 * @param {{ fetchImpl?: typeof fetch, env?: ProviderEnv }} [options]
 * @returns {Promise<ProbeResult>}
 */
export async function runBrowserlessBqlProbe(target, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const request = buildBrowserlessBqlRequest(target, env);

  if (!env.BROWSERLESS_TOKEN) {
    return {
      provider: "browserless_bql",
      query: target.query,
      country: target.country,
      mode: target.mode,
      status: "skipped",
      latencyMs: 0,
      httpStatus: null,
      siteStatus: null,
      matchCount: 0,
      loginWall: false,
      rateLimited: false,
      blockedLikely: false,
      degraded: false,
      sourceLabel: null,
      url: request.body.variables.url,
      note: "Missing BROWSERLESS_TOKEN.",
    };
  }

  const startedAt = performance.now();

  try {
    const response = await fetchImpl(request.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request.body),
    });
    const payload = await response.json();
    const latencyMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      const note = typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.error === "string"
          ? payload.error
          : `HTTP ${response.status}`;
      const status = response.status === 429 || classifyErrorStatus(note) === "rate_limited"
        ? "rate_limited"
        : "error";
      return {
        provider: "browserless_bql",
        query: target.query,
        country: target.country,
        mode: target.mode,
        status,
        latencyMs,
        httpStatus: response.status,
        siteStatus: null,
        matchCount: 0,
        loginWall: false,
        rateLimited: status === "rate_limited",
        blockedLikely: false,
        degraded: false,
        sourceLabel: null,
        url: request.body.variables.url,
        note,
      };
    }

    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      const joined = /** @type {{ message?: string }[]} */ (payload.errors)
        .map((error) => error?.message)
        .filter(Boolean)
        .join(" | ");
      const lower = joined.toLowerCase();
      return {
        provider: "browserless_bql",
        query: target.query,
        country: target.country,
        mode: target.mode,
        status: lower.includes("rate limit") || lower.includes("429") ? "rate_limited" : "error",
        latencyMs,
        httpStatus: response.status,
        siteStatus: payload?.data?.goto?.status ?? null,
        matchCount: 0,
        loginWall: false,
        rateLimited: lower.includes("rate limit") || lower.includes("429"),
        blockedLikely: false,
        degraded: false,
        sourceLabel: null,
        url: request.body.variables.url,
        note: joined || "Browserless returned a GraphQL error.",
      };
    }

    const html = payload?.data?.html?.html ?? "";
    const analysis = analyzeMetaLibraryHtml(html);
    return {
      provider: "browserless_bql",
      query: target.query,
      country: target.country,
      mode: target.mode,
      status: classifyHtmlOutcome(analysis, true),
      latencyMs,
      httpStatus: response.status,
      siteStatus: payload?.data?.goto?.status ?? null,
      matchCount: analysis.matchCount,
      loginWall: analysis.loginWall,
      rateLimited: analysis.rateLimited,
      blockedLikely: analysis.blockedLikely,
      degraded: false,
      sourceLabel: null,
      url: request.body.variables.url,
      note: analysis.matchCount > 0 ? "Browserless BQL rendered extractable Meta Ad Library links." : null,
    };
  } catch (error) {
    const status = classifyErrorStatus(error instanceof Error ? error.message : "Unknown Browserless probe failure.");
    return {
      provider: "browserless_bql",
      query: target.query,
      country: target.country,
      mode: target.mode,
      status,
      latencyMs: Math.round(performance.now() - startedAt),
      httpStatus: null,
      siteStatus: null,
      matchCount: 0,
      loginWall: false,
      rateLimited: status === "rate_limited",
      blockedLikely: false,
      degraded: false,
      sourceLabel: null,
      url: request.body.variables.url,
      note: error instanceof Error ? error.message : "Unknown Browserless probe failure.",
    };
  }
}

/**
 * @param {ProviderName} provider
 * @param {ProbeTarget} target
 * @param {string} url
 * @param {{ html: string, pageState: { hasSelector: boolean, readyState: string, loginWall: boolean, rateLimited: boolean, blockedLikely: boolean } }} extraction
 * @param {number} latencyMs
 * @param {number | null} httpStatus
 * @returns {ProbeResult}
 */
function buildRenderedProbeResult(provider, target, url, extraction, latencyMs, httpStatus = null) {
  const analysis = analyzeMetaLibraryHtml(extraction.html);
  return {
    provider,
    query: target.query,
    country: target.country,
    mode: target.mode,
    status: classifyHtmlOutcome({
      ...analysis,
      loginWall: analysis.loginWall || extraction.pageState.loginWall,
      rateLimited: analysis.rateLimited || extraction.pageState.rateLimited,
      blockedLikely: analysis.blockedLikely || extraction.pageState.blockedLikely,
    }, true),
    latencyMs,
    httpStatus,
    siteStatus: null,
    matchCount: analysis.matchCount,
    loginWall: analysis.loginWall || extraction.pageState.loginWall,
    rateLimited: analysis.rateLimited || extraction.pageState.rateLimited,
    blockedLikely: analysis.blockedLikely || extraction.pageState.blockedLikely,
    degraded: analysis.degraded,
    sourceLabel: analysis.sourceLabel,
    url,
    note: analysis.matchCount > 0 ? `${provider} rendered extractable Meta Ad Library links.` : null,
  };
}

/**
 * @param {ProbeTarget} target
 * @param {{
 *   provider: "browserbase" | "brightdata",
 *   wsUrl: string,
 *   fetchImpl?: FetchImpl,
 *   extractCdpImpl?: ExtractCdpImpl
 * }} options
 * @returns {Promise<ProbeResult>}
 */
async function runCdpBackedProbe(target, options) {
  const startedAt = performance.now();
  try {
    const extraction = await (options.extractCdpImpl ?? extractHtmlViaCdp)({
      wsUrl: options.wsUrl,
      url: buildMetaLibraryUrl(target),
      selector: AD_LIBRARY_RESULT_SELECTOR,
      userAgent: MOBILE_USER_AGENT,
      viewport: MOBILE_VIEWPORT,
      timeoutMs: 8_000,
    });

    return buildRenderedProbeResult(
      options.provider,
      target,
      buildMetaLibraryUrl(target),
      extraction,
      Math.round(performance.now() - startedAt),
    );
  } catch (error) {
    const note = error instanceof Error ? error.message : `Unknown ${options.provider} probe failure.`;
    const status = classifyErrorStatus(note);
    return {
      provider: options.provider,
      query: target.query,
      country: target.country,
      mode: target.mode,
      status,
      latencyMs: Math.round(performance.now() - startedAt),
      httpStatus: null,
      siteStatus: null,
      matchCount: 0,
      loginWall: false,
      rateLimited: status === "rate_limited",
      blockedLikely: note.toLowerCase().includes("captcha") || note.toLowerCase().includes("blocked"),
      degraded: false,
      sourceLabel: null,
      url: buildMetaLibraryUrl(target),
      note,
    };
  }
}

/**
 * @param {string | null} sessionId
 * @param {ProviderEnv} env
 * @param {FetchImpl} fetchImpl
 */
async function releaseBrowserbaseSessionSafely(sessionId, env, fetchImpl) {
  if (!sessionId) {
    return null;
  }

  const releaseRequest = buildBrowserbaseSessionReleaseRequest(sessionId, env);

  try {
    const response = await fetchImpl(releaseRequest.endpoint, {
      method: "POST",
      headers: releaseRequest.headers,
      body: JSON.stringify(releaseRequest.body),
    });
    if (response.ok) {
      return null;
    }

    const payload = await response.json().catch(() => ({}));
    const detail = payload?.message || payload?.error || `HTTP ${response.status}`;
    return `Browserbase session release failed: ${String(detail)}.`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    return `Browserbase session release failed: ${detail}.`;
  }
}

/**
 * @param {ProbeTarget} target
 * @param {{ fetchImpl?: FetchImpl, env?: ProviderEnv, extractCdpImpl?: ExtractCdpImpl }} [options]
 * @returns {Promise<ProbeResult>}
 */
export async function runBrowserbaseProbe(target, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const request = buildBrowserbaseSessionRequest(target, env);

  if (!env.BROWSERBASE_API_KEY || !env.BROWSERBASE_PROJECT_ID) {
    return {
      provider: "browserbase",
      query: target.query,
      country: target.country,
      mode: target.mode,
      status: "skipped",
      latencyMs: 0,
      httpStatus: null,
      siteStatus: null,
      matchCount: 0,
      loginWall: false,
      rateLimited: false,
      blockedLikely: false,
      degraded: false,
      sourceLabel: null,
      url: buildMetaLibraryUrl(target),
      note: "Missing BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID.",
    };
  }

  const sessionResponse = await fetchImpl(request.endpoint, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  const payload = await sessionResponse.json().catch(() => ({}));

  if (!sessionResponse.ok) {
    const note = payload?.message || payload?.error || `HTTP ${sessionResponse.status}`;
    const status = sessionResponse.status === 429 || classifyErrorStatus(String(note)) === "rate_limited"
      ? "rate_limited"
      : classifyErrorStatus(String(note));
    return {
      provider: "browserbase",
      query: target.query,
      country: target.country,
      mode: target.mode,
      status,
      latencyMs: 0,
      httpStatus: sessionResponse.status,
      siteStatus: null,
      matchCount: 0,
      loginWall: false,
      rateLimited: status === "rate_limited",
      blockedLikely: false,
      degraded: false,
      sourceLabel: null,
      url: buildMetaLibraryUrl(target),
      note: String(note),
    };
  }

  const wsUrl = payload?.connectUrl;
  const sessionId = typeof payload?.id === "string" ? payload.id : null;
  if (!wsUrl) {
    const releaseWarning = await releaseBrowserbaseSessionSafely(sessionId, env, fetchImpl);
    return {
      provider: "browserbase",
      query: target.query,
      country: target.country,
      mode: target.mode,
      status: "error",
      latencyMs: 0,
      httpStatus: sessionResponse.status,
      siteStatus: null,
      matchCount: 0,
      loginWall: false,
      rateLimited: false,
      blockedLikely: false,
      degraded: false,
      sourceLabel: null,
      url: buildMetaLibraryUrl(target),
      note: [
        "Browserbase session response did not include connectUrl.",
        releaseWarning,
      ].filter(Boolean).join(" "),
    };
  }

  const result = await runCdpBackedProbe(target, {
    provider: "browserbase",
    wsUrl,
    fetchImpl,
    extractCdpImpl: options.extractCdpImpl,
  });
  const releaseWarning = await releaseBrowserbaseSessionSafely(sessionId, env, fetchImpl);
  if (!releaseWarning) {
    return result;
  }
  return {
    ...result,
    note: [result.note, releaseWarning].filter(Boolean).join(" "),
  };
}

/**
 * @param {ProbeTarget} target
 * @param {{ env?: ProviderEnv, extractCdpImpl?: ExtractCdpImpl }} [options]
 * @returns {Promise<ProbeResult>}
 */
export async function runBrightDataProbe(target, options = {}) {
  const env = options.env ?? process.env;
  const wsUrl = buildBrightDataWsUrl(env);

  if (!wsUrl) {
    return {
      provider: "brightdata",
      query: target.query,
      country: target.country,
      mode: target.mode,
      status: "skipped",
      latencyMs: 0,
      httpStatus: null,
      siteStatus: null,
      matchCount: 0,
      loginWall: false,
      rateLimited: false,
      blockedLikely: false,
      degraded: false,
      sourceLabel: null,
      url: buildMetaLibraryUrl(target),
      note: "Missing BRIGHT_DATA_BROWSER_WS or BRIGHT_DATA_USERNAME/BRIGHT_DATA_PASSWORD.",
    };
  }

  return runCdpBackedProbe(target, {
    provider: "brightdata",
    wsUrl,
    extractCdpImpl: options.extractCdpImpl,
  });
}

/**
 * @param {ProbeTarget} target
 * @param {{ fetchImpl?: FetchImpl, env?: ProviderEnv }} [options]
 * @returns {Promise<ProbeResult>}
 */
export async function runZyteProbe(target, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const request = buildZyteRequest(target, env);
  const startedAt = performance.now();

  if (!env.ZYTE_API_KEY) {
    return {
      provider: "zyte_api",
      query: target.query,
      country: target.country,
      mode: target.mode,
      status: "skipped",
      latencyMs: 0,
      httpStatus: null,
      siteStatus: null,
      matchCount: 0,
      loginWall: false,
      rateLimited: false,
      blockedLikely: false,
      degraded: false,
      sourceLabel: null,
      url: request.body.url,
      note: "Missing ZYTE_API_KEY.",
    };
  }

  try {
    const response = await fetchImpl(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
    const payload = await response.json().catch(() => ({}));
    const latencyMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      const note = payload?.detail || payload?.message || payload?.error || `HTTP ${response.status}`;
      const status = response.status === 429 || classifyErrorStatus(String(note)) === "rate_limited"
        ? "rate_limited"
        : classifyErrorStatus(String(note));
      return {
        provider: "zyte_api",
        query: target.query,
        country: target.country,
        mode: target.mode,
        status,
        latencyMs,
        httpStatus: response.status,
        siteStatus: null,
        matchCount: 0,
        loginWall: false,
        rateLimited: status === "rate_limited",
        blockedLikely: false,
        degraded: false,
        sourceLabel: null,
        url: request.body.url,
        note: String(note),
      };
    }

    const html = payload?.browserHtml ?? "";
    const analysis = analyzeMetaLibraryHtml(html);
    const actions = /** @type {{ error?: string | null }[]} */ (
      Array.isArray(payload?.actions) ? payload.actions : []
    );
    const actionError = actions
      .map((action) => action?.error)
      .find(Boolean);

    return {
      provider: "zyte_api",
      query: target.query,
      country: target.country,
      mode: target.mode,
      status: classifyHtmlOutcome(analysis, true),
      latencyMs,
      httpStatus: response.status,
      siteStatus: null,
      matchCount: analysis.matchCount,
      loginWall: analysis.loginWall,
      rateLimited: analysis.rateLimited,
      blockedLikely: analysis.blockedLikely,
      degraded: false,
      sourceLabel: null,
      url: request.body.url,
      note: actionError ? String(actionError) : analysis.matchCount > 0 ? "zyte_api rendered extractable Meta Ad Library links." : null,
    };
  } catch (error) {
    const note = error instanceof Error ? error.message : "Unknown zyte_api probe failure.";
    const status = classifyErrorStatus(note);
    return {
      provider: "zyte_api",
      query: target.query,
      country: target.country,
      mode: target.mode,
      status,
      latencyMs: Math.round(performance.now() - startedAt),
      httpStatus: null,
      siteStatus: null,
      matchCount: 0,
      loginWall: false,
      rateLimited: status === "rate_limited",
      blockedLikely: note.toLowerCase().includes("blocked") || note.toLowerCase().includes("captcha"),
      degraded: false,
      sourceLabel: null,
      url: request.body.url,
      note,
    };
  }
}

/**
 * @param {ProviderName} provider
 * @param {ProbeTarget} target
 * @param {{ fetchImpl?: FetchImpl, env?: ProviderEnv, baseUrl?: string, extractCdpImpl?: ExtractCdpImpl }} [options]
 */
export async function runProviderProbe(provider, target, options = {}) {
  if (provider === "current_0509") {
    return runCurrent0509Probe(target, options);
  }
  if (provider === "browserless_bql") {
    return runBrowserlessBqlProbe(target, options);
  }
  if (provider === "browserbase") {
    return runBrowserbaseProbe(target, options);
  }
  if (provider === "brightdata") {
    return runBrightDataProbe(target, options);
  }
  if (provider === "zyte_api") {
    return runZyteProbe(target, options);
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * @param {{ providers?: ProviderName[], queries?: string[], country?: string, mode?: SearchMode, fetchImpl?: FetchImpl, env?: ProviderEnv, baseUrl?: string, extractCdpImpl?: ExtractCdpImpl, forceLive?: boolean, canaryBypassToken?: string, timeoutMs?: number }} [options]
 */
export async function benchmarkProviders(options = {}) {
  /** @type {ProviderName[]} */
  const providers = options.providers
    ? [...options.providers]
    : /** @type {ProviderName[]} */ ([...DEFAULT_PROVIDERS]);
  const queries = options.queries ?? [...DOGFOOD_QUERIES];
  const country = options.country ?? DEFAULT_COUNTRY;
  const mode = options.mode ?? DEFAULT_MODE;
  /** @type {ProbeResult[]} */
  const results = [];

  for (const query of queries) {
    for (const provider of providers) {
      results.push(
        await runProviderProbe(
          provider,
          {
            provider,
            query,
            country,
            mode,
          },
          options,
        ),
      );
    }
  }

  return results;
}

/**
 * @param {ProbeResult[]} results
 */
export function formatResultsTable(results) {
  const rows = results.map((result) => ({
    provider: result.provider,
    query: result.query,
    status: result.status,
    ms: String(result.latencyMs),
    matches: String(result.matchCount),
    source: result.sourceLabel ?? "-",
    note: result.note ?? "-",
  }));

  const widths = {
    provider: Math.max("provider".length, ...rows.map((row) => row.provider.length)),
    query: Math.max("query".length, ...rows.map((row) => row.query.length)),
    status: Math.max("status".length, ...rows.map((row) => row.status.length)),
    ms: Math.max("ms".length, ...rows.map((row) => row.ms.length)),
    matches: Math.max("matches".length, ...rows.map((row) => row.matches.length)),
    source: Math.max("source".length, ...rows.map((row) => row.source.length)),
    note: Math.max("note".length, ...rows.map((row) => row.note.length)),
  };

  const header = [
    "provider".padEnd(widths.provider),
    "query".padEnd(widths.query),
    "status".padEnd(widths.status),
    "ms".padStart(widths.ms),
    "matches".padStart(widths.matches),
    "source".padEnd(widths.source),
    "note".padEnd(widths.note),
  ].join("  ");

  const separator = [
    "-".repeat(widths.provider),
    "-".repeat(widths.query),
    "-".repeat(widths.status),
    "-".repeat(widths.ms),
    "-".repeat(widths.matches),
    "-".repeat(widths.source),
    "-".repeat(widths.note),
  ].join("  ");

  const body = rows.map((row) =>
    [
      row.provider.padEnd(widths.provider),
      row.query.padEnd(widths.query),
      row.status.padEnd(widths.status),
      row.ms.padStart(widths.ms),
      row.matches.padStart(widths.matches),
      row.source.padEnd(widths.source),
      row.note.padEnd(widths.note),
    ].join("  "),
  );

  return [header, separator, ...body].join("\n");
}

/**
 * @param {ProbeResult[]} results
 */
export function findBlockingCurrent0509Failures(results) {
  return results.filter(
    (result) =>
      result.provider === "current_0509" &&
      !["ok", "skipped"].includes(result.status),
  );
}

/**
 * @param {ProbeResult[]} results
 */
export function findBlockingFreshLiveCurrent0509Failures(results) {
  return results.filter((result) => {
    if (result.provider !== "current_0509") {
      return false;
    }
    if (!["ok", "skipped"].includes(result.status)) {
      return true;
    }
    if (result.status === "skipped") {
      return false;
    }
    if (
      result.emptyReason === "no_results" &&
      result.sourceLabel === "Live Ad Library capture" &&
      !result.degraded
    ) {
      return false;
    }
    return (
      result.degraded ||
      result.sourceLabel !== "Live Ad Library capture" ||
      Number(result.matchCount || 0) <= 0
    );
  });
}
