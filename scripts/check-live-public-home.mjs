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
// The marketing page now embeds buyer-country Dodo prices in the SSR HTML, so
// it serves `private, max-age=300` (browser-only — a shared cache must never
// replay one country's prices for another) whenever the SSR preview is
// available, and falls back to the public variant below when Dodo is slower
// than the SSR bound. Both are bounded, SWR-free, and vary on cookie, so both
// keep the same stale-window guarantees the gate exists to enforce.
export const EXPECTED_PUBLIC_HOME_CACHE_CONTROL = "public, max-age=300";
export const COUNTRY_VARYING_PUBLIC_HOME_CACHE_CONTROL = "private, max-age=300";
const ACCEPTED_PUBLIC_HOME_CACHE_CONTROLS = new Set([
  EXPECTED_PUBLIC_HOME_CACHE_CONTROL,
  COUNTRY_VARYING_PUBLIC_HOME_CACHE_CONTROL,
]);

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
];
const requiredSignals = [
  "Know when competitors change the offer.",
  "Stop finding out after the sales call.",
  "Recommended launch plan",
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

  return {
    url: url.toString(),
    ok: response.ok && missing.length === 0 && stale.length === 0 && cacheSafe,
    status: response.status,
    missing,
    stale,
    cacheControl,
    vary,
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
