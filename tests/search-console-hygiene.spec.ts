import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * /search console-hygiene gate (issue #3301, phase 1).
 *
 * Termination command (post-merge, prod):
 *   E2E_PROD_BASE_URL=https://0509.io npx playwright test tests/search-console-hygiene.spec.ts
 *
 * Three journeys against the configured base URL (E2E_PROD_BASE_URL, same
 * source as the hero-fold projects' baseURL):
 *   (a) empty   — /search?q=zzqqxx9noresult&country=all (bare /search 302s to
 *                 /brands, so the guard always uses a query);
 *   (b) populated — /search?q=nike&country=all;
 *   (c) selected proof — start from (b), click the first real result row
 *       (`.f9-wk-row .f9-wk-rowlink`, the selector used by
 *       e2e/prod-public.spec.ts and the journey specs) and land on the
 *       ?selected= proof state.
 *
 * Every journey asserts, with NO filtering and NO weakening:
 *   1. zero console messages of type error,
 *   2. zero pageerror events,
 *   3. zero window securitypolicyviolation events (collected via an init
 *      script attached BEFORE the first navigation; accumulated into
 *      sessionStorage so a full-document navigation mid-journey cannot drop
 *      earlier violations).
 *
 * Plus a structural check on the RAW served HTML via the request fixture
 * (NOT the hydrated DOM): the Content-Security-Policy response header's nonce
 * must be carried by every src-less <script> tag in that HTML, the JSON-LD
 * block (@context https://schema.org) must be present AND nonced, and the
 * script-src directive must contain neither 'unsafe-inline' nor any 'sha256-'
 * hash. Pre-fix prod serves exactly this broken shape (ld+json, react-dom's
 * `_R_` timing script and the `$RB` boundary helper are nonceless), so this
 * gate is RED there by design until the phase-2 nonce wiring lands.
 *
 * Posture matches tests/hero-fold.spec.ts (the chromium + mobile-chromium
 * projects in playwright.config.ts). The e2e/helpers/release-experience
 * helpers were evaluated and none fit: this gate deliberately has NO overflow
 * assertion and no touch-target/focus checks — console/CSP hygiene only.
 */

const EMPTY_SEARCH_PATH = "/search?q=zzqqxx9noresult&country=all";
const POPULATED_SEARCH_PATH = "/search?q=nike&country=all";
const FIRST_RESULT_ROW = ".f9-results-panel .f9-wk-row .f9-wk-rowlink";
const PROOF_STATE = "#selected-proof.f9-proof-summary";

type CspViolation = {
  blockedURI: string;
  documentURI: string;
  effectiveDirective: string;
  violatedDirective: string;
  disposition: string;
  statusCode: number;
};

// Serialized via toString() by addInitScript, so this must stay plain
// JavaScript — no TypeScript syntax inside.
const CSP_VIOLATION_COLLECTOR = () => {
  const KEY = "__cspViolations";
  let stored = [];
  try {
    stored = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
  } catch {
    stored = [];
  }
  const violations = stored;
  window[KEY] = violations;
  window.addEventListener("securitypolicyviolation", (event) => {
    violations.push({
      blockedURI: event.blockedURI,
      documentURI: event.documentURI,
      effectiveDirective: event.effectiveDirective,
      violatedDirective: event.violatedDirective,
      disposition: event.disposition,
      statusCode: event.statusCode,
    });
    try {
      sessionStorage.setItem(KEY, JSON.stringify(violations));
    } catch {
      // A quota failure must not swallow the in-window record.
    }
  });
};

async function collectSecurityPolicyViolations(page: Page): Promise<CspViolation[]> {
  return page.evaluate(() => {
    const collected = (window as unknown as { __cspViolations?: unknown }).__cspViolations;
    return Array.isArray(collected) ? collected : [];
  }) as Promise<CspViolation[]>;
}

function describeViolations(violations: CspViolation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.effectiveDirective || violation.violatedDirective} blocked ${violation.blockedURI} (disposition ${violation.disposition})`,
    )
    .join(" | ");
}

/**
 * Structural half of the gate: fetch the RAW served HTML (the same URL the
 * journey ended on) with the request fixture — not the hydrated DOM — and
 * prove the CSP header's nonce covers every inline script.
 */
async function assertRawHtmlCspHygiene(
  request: APIRequestContext,
  url: string,
  label: string,
): Promise<void> {
  const response = await request.get(url);
  expect(response.status(), `${label}: raw fetch must serve 200`).toBe(200);
  const csp = response.headers()["content-security-policy"];
  expect(csp, `${label}: Content-Security-Policy response header must be present`).toBeTruthy();
  const nonce = /'nonce-([^']+)'/u.exec(csp ?? "")?.[1];
  expect(nonce, `${label}: script-src must carry a 'nonce-<...>' token`).toBeTruthy();

  const scriptSrc = /script-src[^;]*/iu.exec(csp ?? "")?.[0] ?? "";
  expect(
    scriptSrc.includes("'unsafe-inline'"),
    `${label}: script-src must not allow 'unsafe-inline' (got: ${scriptSrc})`,
  ).toBe(false);
  expect(
    /'sha256-[^']*'/u.test(scriptSrc),
    `${label}: script-src must not allow 'sha256-' hashes (got: ${scriptSrc})`,
  ).toBe(false);

  const html = await response.text();
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>/gu)].map((match) => match[1]);
  const inlineScriptTags = scriptTags.filter((attrs) => !/\bsrc\s*=/iu.test(attrs));
  expect(
    inlineScriptTags.length,
    `${label}: raw HTML should contain inline scripts to check`,
  ).toBeGreaterThan(0);

  const nonceMarker = `nonce="${nonce}"`;
  const nonceless = inlineScriptTags.filter((attrs) => !attrs.includes(nonceMarker));
  expect(
    nonceless,
    `${label}: every src-less <script> in the raw HTML must carry the CSP nonce ${nonce}`,
  ).toEqual([]);

  const jsonLdTag = /<script[^>]*type="application\/ld\+json"[^>]*>/u.exec(html)?.[0];
  expect(jsonLdTag, `${label}: JSON-LD block (application/ld+json) must be present`).toBeTruthy();
  expect(
    jsonLdTag?.includes(nonceMarker),
    `${label}: the JSON-LD block must carry the CSP nonce (got: ${jsonLdTag})`,
  ).toBe(true);
  expect(
    /@context['"]\s*:\s*['"]https:\/\/schema\.org['"]/u.test(html),
    `${label}: JSON-LD must declare the https://schema.org context`,
  ).toBe(true);
}

test(`(a) empty /search journey: zero console errors, zero CSP violations, zero page errors`, async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`[console.error] ${message.text()} (${message.location().url})`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(`[pageerror] ${String(error)}`));
  await page.addInitScript(CSP_VIOLATION_COLLECTOR);

  await page.goto(EMPTY_SEARCH_PATH, { waitUntil: "domcontentloaded" });
  await expect(
    page.locator(".f9-results-panel[data-f9-result-cache-status]"),
    "empty search must reach a settled results panel",
  ).toBeVisible();
  // Let streamed boundaries + hydration settle so late CSP violations and
  // console errors are all captured before the asserts.
  await page.waitForTimeout(1500);

  const violations = await collectSecurityPolicyViolations(page);
  expect(violations, `expected zero securitypolicyviolation events, got: ${describeViolations(violations)}`).toEqual([]);
  expect(consoleErrors, `expected zero console errors, got: ${consoleErrors.join(" | ")}`).toEqual([]);
  expect(pageErrors, `expected zero page errors, got: ${pageErrors.join(" | ")}`).toEqual([]);

  await assertRawHtmlCspHygiene(request, EMPTY_SEARCH_PATH, "empty /search");
});

test(`(b) populated /search journey: zero console errors, zero CSP violations, zero page errors`, async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`[console.error] ${message.text()} (${message.location().url})`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(`[pageerror] ${String(error)}`));
  await page.addInitScript(CSP_VIOLATION_COLLECTOR);

  await page.goto(POPULATED_SEARCH_PATH, { waitUntil: "domcontentloaded" });
  await expect(
    page.locator(`${FIRST_RESULT_ROW}`).first(),
    "populated search must render result rows",
  ).toBeVisible();
  await expect(
    page.locator(".f9-results-panel[data-f9-result-cache-status]"),
    "populated search must reach a settled results panel",
  ).toBeVisible();
  await page.waitForTimeout(1500);

  const violations = await collectSecurityPolicyViolations(page);
  expect(violations, `expected zero securitypolicyviolation events, got: ${describeViolations(violations)}`).toEqual([]);
  expect(consoleErrors, `expected zero console errors, got: ${consoleErrors.join(" | ")}`).toEqual([]);
  expect(pageErrors, `expected zero page errors, got: ${pageErrors.join(" | ")}`).toEqual([]);

  await assertRawHtmlCspHygiene(request, POPULATED_SEARCH_PATH, "populated /search");
});

test(`(c) selected proof journey: clicking the first result row reaches ?selected= with zero console errors, zero CSP violations, zero page errors`, async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`[console.error] ${message.text()} (${message.location().url})`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(`[pageerror] ${String(error)}`));
  await page.addInitScript(CSP_VIOLATION_COLLECTOR);

  await page.goto(POPULATED_SEARCH_PATH, { waitUntil: "domcontentloaded" });
  const firstRow = page.locator(FIRST_RESULT_ROW).first();
  await expect(firstRow, "populated search must render result rows").toBeVisible();
  await firstRow.click();
  await expect(page).toHaveURL(/selected=/u);
  await expect(
    page.locator(PROOF_STATE),
    "the ?selected= proof state must render the proof summary",
  ).toBeVisible();
  await page.waitForTimeout(1500);

  const violations = await collectSecurityPolicyViolations(page);
  expect(violations, `expected zero securitypolicyviolation events, got: ${describeViolations(violations)}`).toEqual([]);
  expect(consoleErrors, `expected zero console errors, got: ${consoleErrors.join(" | ")}`).toEqual([]);
  expect(pageErrors, `expected zero page errors, got: ${pageErrors.join(" | ")}`).toEqual([]);

  // Structural check on the exact URL the journey ended on — the SSR'd
  // ?selected= proof state must be just as hygienic as the listing.
  await assertRawHtmlCspHygiene(request, page.url(), "selected proof /search");
});
