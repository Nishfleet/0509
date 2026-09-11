#!/usr/bin/env node
import { fileURLToPath } from "node:url";

const baseUrl = process.env.PUBLIC_HOME_URL ?? "https://0509.io";

// Deploy-gate contract for anonymous public HTML caching.
//
// PR #360 (2026-07-20) deliberately moved anonymous public HTML off no-store:
// the worker now sets `cache-control: public, max-age=300` (NO
// stale-while-revalidate) with `vary: cookie`, and DELETES cdn-cache-control /
// cloudflare-cdn-cache-control / pragma / expires on those responses (see
// PUBLIC_HTML_CACHE_CONTROL + withSecurityHeaders in workers/security-headers.ts).
// The five-minute bound is the guard against the 2026-07-13 asset-skew incident
// class; SWR would stretch the stale window to an hour.
//
// This gate asserts that exact deliberate contract — equally strict as the old
// no-store check, just matching what the product genuinely ships now. The
// coupling test in tests/worker-security-headers.test.ts imports
// EXPECTED_PUBLIC_HOME_CACHE_CONTROL and PUBLIC_HTML_CACHE_CONTROL and asserts
// they are equal so the gate and product can never silently diverge again.
//
// The last SSR-pricing private variant is gone (issue #2694: the homepage and
// /pricing both resolve buyer-country prices via the client-side
// /api/pricing-preview fetch), so this document carries no prices and rides
// the worker's shared policy exclusively. The only accepted policy is the
// public one below — a stale `private, max-age=300` variant is a deploy
// failure, not an accepted shape.
export const EXPECTED_PUBLIC_HOME_CACHE_CONTROL = "public, max-age=300";
const ACCEPTED_PUBLIC_HOME_CACHE_CONTROLS = new Set([
  EXPECTED_PUBLIC_HOME_CACHE_CONTROL,
]);

// Deploy-gate contract for the Cloudflare Web Analytics beacon (PR #610).
//
// Web Analytics is enabled for the zone with automatic (edge) injection, so
// Cloudflare inserts https://static.cloudflareinsights.com/beacon.min.js into
// HTML responses as it passes the edge. If the beacon host ever drops out of
// the live script-src directive, the CSP blocks the beacon and analytics
// silently records zero page views — no crash, no log, just a silent zero.
// That silent failure is exactly what the coupling test in
// tests/worker-security-headers.test.ts guards: it imports this constant and
// CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC from workers/security-headers.ts and
// asserts they are equal, so the gate and the product policy can never
// silently diverge again.
export const EXPECTED_SCRIPT_SRC_BEACON_HOST = "https://static.cloudflareinsights.com/beacon.min.js";

// Deploy-gate contract for the nonce-based CSP (issue #2348).
//
// The live site used to serve `script-src 'self' 'unsafe-inline' …` and
// `connect-src 'self' https:`; the bare `https:` let one injected script post
// session data to any host. Both are now gone. If either ever comes back — a
// later edit reintroducing 'unsafe-inline', or a connect-src regression to the
// scheme wildcard — deploys must fail rather than silently reopen the hole.
// Coupled to the product policy by tests/worker-security-headers.test.ts so the
// gate and the worker can never diverge.
export const FORBIDDEN_SCRIPT_SRC_KEYWORD = "'unsafe-inline'";
export const FORBIDDEN_CONNECT_SRC_WILDCARD = "https:";

// Deploy-gate contract for the Google Fonts paths. The page loads its
// stylesheet from fonts.googleapis.com (style-src) and the font files from
// fonts.gstatic.com (font-src), and an inline FONT_SWAP_SCRIPT flips the
// stylesheet to media="all" on load. If either host drops out of the live CSP,
// fonts silently stop applying (display=swap keeps the text readable, so the
// only symptom is a wrong typeface nobody files a bug about).
export const EXPECTED_STYLE_SRC_FONTS_HOST = "https://fonts.googleapis.com";
export const EXPECTED_FONT_SRC_FONTS_HOST = "https://fonts.gstatic.com";

const staleSignals = [
  "The market moves after you log off",
  "After-hours market intelligence",
  "Enter pilot",
  "Intelligence room",
  "pricing-region",
  "Fraunces",
  "Manrope",
  "Rs 2,500",
  "Rs 7,500",
  "APP_REGION_DEFAULT",
  "Dodo preview",
  "Buyer currency is served from checkout preview.",
  "Prices are loaded from Dodo",
  "No unlimited claims",
  "Meta beta access",
  "Dodo price syncing",
  "Loading local monthly price",
  "Loading local annual price",
  "Loading local pack price",
  "market lanes watched",
  "source states separated",
  "source trail per move",
  "decision scan",
  "Start with Scout",
  "Proof-first monitoring",
  // The 2026-08-20 live defect class: the public proof brief glued the
  // website to the library phrase ("12 public Meta ads link to nykaa.comin
  // the Meta Ad Library."). The fix is in main (PR #806) but the canary
  // must fail any deploy that would serve the glued-domain string again.
  "nykaa.comin",
];
const requiredSignals = [
  "Know when competitors change the offer.",
  "Stop finding out after the sales call.",
  "Recommended",
  "Start with Starter",
];

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrls() {
  const plain = new URL("/", baseUrl);
  const busted = new URL("/", baseUrl);
  busted.searchParams.set("public-home-canary", `${Date.now()}`);
  return [plain, busted];
}

/** @param {string} varyHeader @returns {boolean} */
function varyIncludesCookie(varyHeader) {
  return varyHeader
    .toLowerCase()
    .split(",")
    .some((token) => token.trim() === "cookie");
}

/**
 * @param {string} cspHeader the full content-security-policy header value
 * @returns {boolean} whether script-src allows the Cloudflare Web Analytics beacon
 */
/**
 * @param {string} cspHeader the full content-security-policy header value
 * @param {string} name directive name, e.g. "script-src"
 * @returns {string} the directive source list ("" when the directive is absent)
 */
function cspDirective(cspHeader, name) {
  const directive = cspHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  if (directive === undefined) return "";
  return directive === name ? "" : directive.slice(name.length).trim();
}

/**
 * Whether a directive's source list contains `source` as a whole token.
 *
 * Exact token matching, never a substring: `https://fonts.gstatic.com` must not
 * be satisfied by `https://evil.example/?u=https://fonts.gstatic.com`, which a
 * naive `includes()` would accept. (CodeQL js/incomplete-url-substring-sanitization
 * flags the substring form for exactly this reason.)
 * @param {string} directive the directive source list
 * @param {string} source the source token to look for
 * @returns {boolean} whether the source list contains the token
 */
function cspHasSource(directive, source) {
  return directive.split(/\s+/).includes(source);
}

/**
 * @param {string} cspHeader the full content-security-policy header value
 * @returns {boolean} whether script-src allows the Cloudflare Web Analytics beacon
 */
function cspAllowsBeacon(cspHeader) {
  return cspHasSource(cspDirective(cspHeader, "script-src"), EXPECTED_SCRIPT_SRC_BEACON_HOST);
}

/**
 * Whether the live CSP satisfies the issue #2348 contract: no 'unsafe-inline'
 * in script-src, no bare `https:` wildcard in connect-src, and both Google
 * Fonts hosts still reachable from the directives that actually fetch them.
 * @param {string} cspHeader the full content-security-policy header value
 * @returns {{ unsafeInlineScriptSrc: boolean, connectSrcWildcard: boolean, fontsStyleSrc: boolean, fontsFontSrc: boolean }}
 */
export function cspContract(cspHeader) {
  const scriptSrc = cspDirective(cspHeader, "script-src");
  const connectSrc = cspDirective(cspHeader, "connect-src");
  return {
    // A violation is the PRESENCE of the forbidden token, so these are the
    // inverse of "ok" — named for what they assert so the failure JSON reads
    // plainly.
    unsafeInlineScriptSrc: cspHasSource(scriptSrc, FORBIDDEN_SCRIPT_SRC_KEYWORD),
    // Match the bare scheme token only: `https://fonts.gstatic.com` is a
    // legitimate full-URL source and must not be mistaken for the wildcard.
    connectSrcWildcard: cspHasSource(connectSrc, FORBIDDEN_CONNECT_SRC_WILDCARD),
    fontsStyleSrc: cspHasSource(cspDirective(cspHeader, "style-src"), EXPECTED_STYLE_SRC_FONTS_HOST),
    fontsFontSrc: cspHasSource(cspDirective(cspHeader, "font-src"), EXPECTED_FONT_SRC_FONTS_HOST),
  };
}

/** @param {URL} url */
async function checkUrl(url) {
  const response = await fetch(url, {
    headers: {
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "0509-public-home-canary/1.0",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await response.text();
  const cacheControl = response.headers.get("cache-control") ?? "";
  const vary = response.headers.get("vary") ?? "";
  const missing = requiredSignals.filter((signal) => !html.includes(signal));
  const stale = staleSignals.filter((signal) => html.includes(signal));
  // Deliberate anonymous public-HTML contract (PR #360): cache-control must be
  // EXACTLY one of the bounded public policies (no stale-while-revalidate
  // anywhere), and the response must vary on cookie so any honoring cache
  // revalidates when auth state changes. The country-varying SSR-pricing
  // variant is private (browser-only) for the same reason the /api surface is.
  // The worker no longer emits cloudflare-cdn-cache-control on these paths (it
  // deletes it), so it is intentionally not asserted here.
  const cacheSafe =
    ACCEPTED_PUBLIC_HOME_CACHE_CONTROLS.has(cacheControl.trim()) && varyIncludesCookie(vary);

  // PR #610 contract: the live CSP must keep allowing the Cloudflare Web
  // Analytics beacon. Without this, analytics silently records zero page views
  // (blocked beacon, no error anywhere).
  const cspHeader = response.headers.get("content-security-policy") ?? "";
  const cspAllowsBeaconSafe = cspAllowsBeacon(cspHeader);

  // Issue #2348 contract: no 'unsafe-inline' in script-src, no bare `https:`
  // in connect-src, and both Google Fonts paths still reachable.
  const csp = cspContract(cspHeader);
  const cspContractSafe =
    !csp.unsafeInlineScriptSrc && !csp.connectSrcWildcard && csp.fontsStyleSrc && csp.fontsFontSrc;

  return {
    url: url.toString(),
    ok:
      response.ok &&
      missing.length === 0 &&
      stale.length === 0 &&
      cacheSafe &&
      cspAllowsBeaconSafe &&
      cspContractSafe,
    status: response.status,
    missing,
    stale,
    cacheControl,
    vary,
    cspAllowsBeacon: cspAllowsBeaconSafe,
    cspContract: csp,
  };
}

async function run() {
  /** @type {Awaited<ReturnType<typeof checkUrl>>[]} */
  let lastResults = [];
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    lastResults = await Promise.all(buildUrls().map(checkUrl));
    if (lastResults.every((result) => result.ok)) {
      console.log("live public-home check passed");
      return;
    }
    await sleep(5_000);
  }

  console.error("live public-home check failed");
  console.error(JSON.stringify(lastResults, null, 2));
  process.exit(1);
}

// Only fire the live canary when executed directly; importing this module (the
// anti-drift coupling test does) must not trigger network calls.
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
