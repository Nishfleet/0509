import { createHash } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Console-hygiene gate for the remaining public surfaces (issue #3379) — the
 * sibling of #3301's /search gate, covering the surfaces the 2026-09-12
 * money-path walk did NOT drive:
 *
 *   /login            → 302 to /auth/login; the journey follows the redirect
 *                       so the gate exercises the user-facing path the issue
 *                       names. The document asserts are on the login page.
 *   /                 → the marketing landing (app/routes/marketing.tsx is the
 *                       index route; the issue's "/marketing" names that
 *                       template — there is no /marketing path).
 *   /brands           → brands hub index.
 *   /compare          → hub + one compare-template instance (/compare/keeptabz).
 *   /guides           → index + one guide-template instance.
 *   /privacy, /terms  → the legal templates.
 *
 * Every journey asserts, with NO filtering and NO weakening:
 *   1. zero console messages of type error,
 *   2. zero pageerror events,
 *   3. zero window securitypolicyviolation events (collected via an init
 *      script attached BEFORE the first navigation; accumulated into
 *      sessionStorage so a full-document navigation or redirect mid-journey
 *      cannot drop earlier violations).
 *
 * Plus a structural check on the RAW served HTML via the request fixture (NOT
 * the hydrated DOM). The app serves TWO deliberate CSP postures
 * (workers/security-headers.ts + workers/edge-cache.ts), and each surface
 * declares which one it must ship — a silent class flip fails the gate:
 *
 *   nonce class — `script-src 'self' <beacon> 'nonce-<per-request>'`: every
 *   src-less <script> in the document must carry exactly that nonce, and the
 *   directive must contain neither 'unsafe-inline' nor any 'sha256-' hash.
 *   This is the issue's literal acceptance ("nonce on every inline script").
 *
 *   hash class — the edge-cache nonce-free variant (`'sha256-…'` sources in
 *   place of the nonce, workers/edge-cache.ts): every src-less EXECUTABLE
 *   <script> (no type, or type="module") must hash — sha256 over its exact
 *   body bytes, matching extractInlineScriptBodies — into the served
 *   script-src; non-executable data blocks (application/ld+json et al.) are
 *   CSP-exempt and need no source. The directive must contain neither
 *   'unsafe-inline' nor a 'nonce-' token.
 *
 * RECORDED DECISION (the issue's "or" branch): the hash-class surfaces
 * deliberately stay no-nonce. A shared secret cannot be shared between
 * visitors of a cached document, so the stored copy commits to its inline
 * scripts by content hash instead — the #2950/#2716 "nonce problem actually
 * solved" posture. Zero runtime violations AND full hash coverage is the
 * internally-consistent form of that posture, and that is what this gate
 * pins — it is not a weakening of the nonce assertion, it is the same
 * property (every inline script is authorised, 'unsafe-inline' stays absent)
 * expressed for the class those surfaces actually ship.
 *
 * /brands/:category is not a separate surface entry: the hub only links
 * categories with >= BRAND_CATEGORY_PAGE_MIN_BRANDS live brands, which the
 * local fixture does not seed; the category template shares the hub's exact
 * render pipeline and CSP class.
 *
 * Termination commands:
 *   local:  E2E_START_LOCAL_SERVER=1 E2E_PROD_BASE_URL=http://127.0.0.1:4179 \
 *             npx playwright test tests/console-hygiene.spec.ts
 *   prod:   npx playwright test tests/console-hygiene.spec.ts
 * Posture matches tests/hero-fold.spec.ts (the chromium + mobile-chromium
 * projects in playwright.config.ts; both run against E2E_PROD_BASE_URL).
 */

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
  (window as unknown as { __cspViolations?: CspViolation[] }).__cspViolations =
    violations;
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

type InlineScript = { attrs: string; body: string; executable: boolean };

/**
 * The document's src-less <script> elements, split exactly as the edge cache's
 * extractInlineScriptBodies splits them: external (`src=`) scripts are
 * authorised by host tokens; non-executable data blocks (application/ld+json
 * and any other non-empty, non-"module" type) are CSP-exempt; the rest are
 * executable and need a nonce or a hash. The open-tag scan is quote-aware and
 * the end tag takes the lenient tokenizer form, matching the worker byte-for-
 * byte so a hash assertion compares the same bytes the worker hashed.
 */
const SCRIPT_TAG =
  /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script(?:\s[^<]*)?>/giu;

function extractInlineScripts(html: string): InlineScript[] {
  const scripts: InlineScript[] = [];
  for (const match of html.matchAll(SCRIPT_TAG)) {
    const attrs = match[1];
    if (/\bsrc\s*=/iu.test(attrs)) {
      continue;
    }
    const typeMatch = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(attrs);
    const type = (typeMatch?.slice(1).find((value) => value !== undefined) ?? "")
      .trim()
      .toLowerCase();
    scripts.push({ attrs, body: match[2], executable: type === "" || type === "module" });
  }
  return scripts;
}

function describeScript(script: InlineScript): string {
  return `attrs="${script.attrs.trim().slice(0, 80)}" body="${script.body.trim().slice(0, 80)}"`;
}

function sha256CspSource(body: string): string {
  return `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
}

/**
 * Structural half of the gate: fetch the RAW served HTML (the same path the
 * journey drove — redirects followed, so /login measures the /auth/login
 * document) with the request fixture and prove the CSP covers every inline
 * script under the surface's declared posture class.
 */
async function assertRawHtmlCspHygiene(
  request: APIRequestContext,
  path: string,
  expectedClass: "nonce" | "hash",
): Promise<void> {
  const label = path;
  const response = await request.get(path);
  expect(response.status(), `${label}: raw fetch must serve 200`).toBe(200);
  const csp = response.headers()["content-security-policy"];
  expect(csp, `${label}: Content-Security-Policy response header must be present`).toBeTruthy();
  const scriptSrc = /script-src[^;]*/iu.exec(csp ?? "")?.[0] ?? "";
  expect(
    scriptSrc.includes("'unsafe-inline'"),
    `${label}: script-src must not allow 'unsafe-inline' (got: ${scriptSrc})`,
  ).toBe(false);

  const nonce = /'nonce-([^']+)'/u.exec(scriptSrc)?.[1];
  const scripts = extractInlineScripts(await response.text());
  const executable = scripts.filter((script) => script.executable);

  if (expectedClass === "nonce") {
    expect(
      nonce,
      `${label}: expected the per-request nonce CSP class but script-src has no 'nonce-' token (got: ${scriptSrc})`,
    ).toBeTruthy();
    const nonceMarker = `nonce="${nonce}"`;
    const nonceless = scripts.filter((script) => !script.attrs.includes(nonceMarker));
    expect(
      nonceless.map(describeScript),
      `${label}: every src-less <script> in the raw HTML must carry the CSP nonce ${nonce}`,
    ).toEqual([]);
    expect(
      /'sha256-[^']*'/u.test(scriptSrc),
      `${label}: nonce-class script-src must not carry 'sha256-' hashes (got: ${scriptSrc})`,
    ).toBe(false);
    return;
  }

  // Hash class: the edge cache's nonce-free variant. The directive must not
  // carry a 'nonce-' token (a shared secret is exactly what this class
  // removes), and every EXECUTABLE src-less script must be authorised by its
  // own sha256. Data blocks (ld+json et al.) are CSP-exempt by spec.
  expect(
    /'nonce-/u.test(scriptSrc),
    `${label}: hash-class script-src must not carry a 'nonce-' token (got: ${scriptSrc})`,
  ).toBe(false);
  const uncovered = executable.filter(
    (script) => !scriptSrc.includes(sha256CspSource(script.body)),
  );
  expect(
    uncovered.map(describeScript),
    `${label}: every executable src-less <script> must be sha256-authorised by script-src (got: ${scriptSrc})`,
  ).toEqual([]);
}

const SURFACES: { path: string; h1: RegExp; cspClass: "nonce" | "hash" }[] = [
  { path: "/login", h1: /return to the changes/i, cspClass: "nonce" },
  { path: "/", h1: /growth teams/i, cspClass: "hash" },
  { path: "/brands", h1: /tracked brands/i, cspClass: "hash" },
  { path: "/compare", h1: /stacks up against/i, cspClass: "hash" },
  { path: "/compare/keeptabz", h1: /keeptabz/i, cspClass: "hash" },
  { path: "/guides", h1: /^guides$/i, cspClass: "hash" },
  {
    path: "/guides/how-to-monitor-meta-ad-library",
    h1: /meta ad library/i,
    cspClass: "hash",
  },
  { path: "/privacy", h1: /privacy basics/i, cspClass: "hash" },
  { path: "/terms", h1: /five to nine terms/i, cspClass: "hash" },
];

for (const surface of SURFACES) {
  test(`${surface.path}: zero console errors, zero CSP violations, zero page errors; raw HTML is CSP-consistent`, async ({
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

    await page.goto(surface.path, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1 }),
      `${surface.path} must render its expected page heading (not an error shell)`,
    ).toContainText(surface.h1);
    // Let streamed boundaries + hydration settle so late CSP violations and
    // console errors are all captured before the asserts.
    await page.waitForTimeout(1500);

    // disposition:"report" events are report-only policies observing, not
    // blocking — production carries Cloudflare Script Monitor's injected
    // report-only policy (script-src 'unsafe-inline' 'unsafe-eval';
    // connect-src 'none') which by design reports every script and fetch on
    // the page. The gate asserts the page's ENFORCED policy blocks nothing.
    const violations = (await collectSecurityPolicyViolations(page)).filter(
      (violation) => violation.disposition !== "report",
    );
    expect(
      violations,
      `${surface.path}: expected zero securitypolicyviolation events, got: ${describeViolations(violations)}`,
    ).toEqual([]);
    expect(
      consoleErrors,
      `${surface.path}: expected zero console errors, got: ${consoleErrors.join(" | ")}`,
    ).toEqual([]);
    expect(
      pageErrors,
      `${surface.path}: expected zero page errors, got: ${pageErrors.join(" | ")}`,
    ).toEqual([]);

    // Structural check on the raw served document for the same path.
    await assertRawHtmlCspHygiene(request, surface.path, surface.cspClass);
  });
}
