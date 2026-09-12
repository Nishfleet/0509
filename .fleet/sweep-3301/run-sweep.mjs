// Throwaway evidence collector — issue #3301 phase 5 (unbounded pre-fix prod
// console-hygiene sweep). NOT tracked code: this file lives under .fleet/**.
//
// Vehicle: a single sequential node/playwright process (no worker pool —
// PLAYWRIGHT_WORKERS=1 honored trivially; ONE process, no parallelism, no
// vitest, no coverage, no typecheck, no tracked-code diffs).
//
// Equivalence to the suite's two projects (playwright.config.ts, issue #1898
// posture): both projects are `...devices["Desktop Chrome"]` with the
// production baseURL (E2E_PROD_BASE_URL ?? https://0509.io) and
//   chromium:        viewport 1440x900, isMobile:false, hasTouch:false
//   mobile-chromium: viewport 390x844,  isMobile:true,  hasTouch:true
// This script spreads the SAME device descriptor and the SAME overrides, so
// each (journey, viewport) runs in a context identical to the corresponding
// project's `use` block (UA, screen 1920x1080, deviceScaleFactor 1 included).
// Runner parity: headless (npx playwright test is headless too), no retries.
//
// Collection posture mirrors tests/search-console-hygiene.spec.ts (phase 1)
// and STRENGTHENS it, weakening nothing:
//   - ALL console messages of ALL types (spec: error only) — full text,
//     args-joined text, location; findings classification covers error/warning.
//   - window securitypolicyviolation events with ALL spec'd fields (spec:
//     6 fields; here: 11, incl. originalPolicy, sample, sourceFile,
//     lineNumber, columnNumber), same init-script-before-navigation +
//     sessionStorage-accumulation mechanism.
//   - ALL pageerror events (name + message + full stack).
//   - the final navigation's response chain (redirect hops walked backwards
//     via request.redirectedFrom()), ALL document-type responses (iframes
//     included), ALL failed requests.
//   - RAW-HTML inline-script inventory of the journey's final URL (own
//     response, own nonce): which src-less scripts are nonceless, ld+json
//     presence/nonce — answers "which inline scripts" without asserting.
//   - one viewport screenshot per journey+viewport.
// NO filters, NO caps, NO assertion-weakening.

import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGS = path.join(HERE, "logs");
const SHOTS = path.join(HERE, "screenshots");
mkdirSync(LOGS, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const BASE = process.env.E2E_PROD_BASE_URL ?? "https://0509.io";
const NAV_TIMEOUT = 20_000;   // same as the projects' navigationTimeout
const ACT_TIMEOUT = 30_000;   // same as the projects' actionTimeout
const isMobileViewport = (label) => label === "mobile";

// 11-field securitypolicyviolation collector — serialized by addInitScript,
// so plain JavaScript only. Accumulates into sessionStorage exactly like the
// phase-1 spec so a mid-journey document navigation cannot drop violations.
const CSP_COLLECTOR = () => {
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
      columnNumber: event.columnNumber,
      disposition: event.disposition,
      documentURI: event.documentURI,
      effectiveDirective: event.effectiveDirective,
      lineNumber: event.lineNumber,
      originalPolicy: event.originalPolicy,
      sample: event.sample,
      sourceFile: event.sourceFile,
      statusCode: event.statusCode,
      violatedDirective: event.violatedDirective,
    });
    try {
      sessionStorage.setItem(KEY, JSON.stringify(violations));
    } catch {
      // A quota failure must not swallow the in-window record.
    }
  });
};

const EMPTY_SEARCH_PATH = "/search?q=zzqqxx9noresult&country=all";
const POPULATED_SEARCH_PATH = "/search?q=nike&country=all";
const FIRST_RESULT_ROW = ".f9-results-panel .f9-wk-row .f9-wk-rowlink";
const PROOF_STATE = "#selected-proof.f9-proof-summary";
const SETTLED_PANEL = ".f9-results-panel[data-f9-result-cache-status]";

// Journey (letters) → definition. (a)(b)(c) mirror the phase-1 spec's
// journeys exactly (same selectors, same 1500ms settle); (d)(f) extend the
// walk to /pricing and signup start per the phase-5 bullet.
const JOURNEYS = {
  a: {
    title: "(a) empty /search",
    path: EMPTY_SEARCH_PATH,
    async run(page) {
      await page.locator(SETTLED_PANEL).waitFor({ state: "visible", timeout: ACT_TIMEOUT });
      await page.waitForTimeout(1500);
    },
  },
  b: {
    title: "(b) populated /search",
    path: POPULATED_SEARCH_PATH,
    async run(page) {
      await page.locator(FIRST_RESULT_ROW).first().waitFor({ state: "visible", timeout: ACT_TIMEOUT });
      await page.locator(SETTLED_PANEL).waitFor({ state: "visible", timeout: ACT_TIMEOUT });
      await page.waitForTimeout(1500);
    },
  },
  c: {
    title: "(c) selected proof — populated + click first result row → ?selected=",
    path: POPULATED_SEARCH_PATH,
    async run(page) {
      const firstRow = page.locator(FIRST_RESULT_ROW).first();
      await firstRow.waitFor({ state: "visible", timeout: ACT_TIMEOUT });
      await firstRow.click();
      await page.waitForURL(/selected=/u, { timeout: NAV_TIMEOUT });
      await page.locator(PROOF_STATE).waitFor({ state: "visible", timeout: ACT_TIMEOUT });
      await page.waitForTimeout(1500);
    },
  },
  d: {
    title: "(d) /pricing",
    path: "/pricing",
    async run(page) {
      await page.waitForLoadState("load", { timeout: NAV_TIMEOUT }).catch(() => {});
      await page.waitForTimeout(2500);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    },
  },
  f: {
    title: "(f) signup start — /signup (302) landing on /auth/signup",
    path: "/signup",
    async run(page) {
      await page.waitForLoadState("load", { timeout: NAV_TIMEOUT }).catch(() => {});
      await page.waitForTimeout(2500);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    },
  },
};

// ---------- evidence-format helpers ----------

function fmtConsole(records) {
  if (!records.length) return "_none._";
  return records
    .map((r, i) => {
      const loc = r.url
        ? `${r.url}${r.lineNumber != null ? `:${r.lineNumber}${r.columnNumber != null ? ":" + r.columnNumber : ""}` : ""}`
        : "(no location)";
      return [
        `${i + 1}. \`[${r.type}]\` ${r.text}`,
        r.argsText && r.argsText !== r.text ? `   - args-joined: ${r.argsText}` : "",
        `   - location: ${loc}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

function fmtCsp(violations) {
  if (!violations.length) return "_none._";
  return violations
    .map((v, i) =>
      [
        `${i + 1}. **${v.effectiveDirective || v.violatedDirective}** blocked **${v.blockedURI}** (disposition ${v.disposition}, statusCode ${v.statusCode})`,
        `   - violatedDirective: \`${v.violatedDirective}\``,
        `   - documentURI: \`${v.documentURI}\``,
        `   - sourceFile: \`${v.sourceFile}\`  lineNumber: ${v.lineNumber}  columnNumber: ${v.columnNumber}`,
        `   - sample: \`${v.sample ?? ""}\``,
        `   - originalPolicy: \`${v.originalPolicy}\``,
      ].join("\n"),
    )
    .join("\n");
}

function fmtPageErrors(errors) {
  if (!errors.length) return "_none._";
  return errors
    .map(
      (e, i) =>
        `${i + 1}. **${e.name}**: ${e.message}\n   - stack: \`${(e.stack ?? "").split("\n").slice(0, 6).join(" ⏎ ")}\``,
    )
    .join("\n");
}

function fmtDocResponses(records) {
  if (!records.length) return "_none._";
  return records
    .map((r, i) => `${i + 1}. ${r.status} ${r.url}${r.location ? ` (Location: ${r.location})` : ""} — frame: ${r.frameUrl}`)
    .join("\n");
}

function fmtRedirectChain(chain) {
  if (!chain.length) return "_no main-frame navigation response captured._";
  return chain.map((c, i) => `${i + 1}. ${c.status} → ${c.url}${c.location ? ` (Location: ${c.location})` : ""}`).join("\n");
}

function fmtFailedRequests(records) {
  if (!records.length) return "_none._";
  return records.map((r, i) => `${i + 1}. ${r.url} — ${r.failure} (${r.resourceType})`).join("\n");
}

function fmtScriptInventory(inv) {
  if (!inv.ok) return `Raw-HTML fetch failed: ${inv.error}`;
  const lines = [];
  lines.push(`- raw fetch: ${inv.status} ${inv.fetchedUrl}`);
  lines.push(`- Content-Security-Policy (full): \`${inv.csp}\``);
  lines.push(`- script-src directive: \`${inv.scriptSrc}\``);
  lines.push(`- nonce tokens in policy: ${inv.nonceCount}; 'unsafe-inline' present: ${inv.hasUnsafeInline}; 'sha256-' hashes present: ${inv.hasShaHashes}`);
  lines.push(`- ALL <script> tags: ${inv.totalScripts}; src-less (inline) of those: ${inv.inlineScripts.length}`);
  if (!inv.inlineScripts.length) lines.push("- no inline scripts (nothing to be nonceless)");
  else {
    lines.push("- per src-less (inline) script: attrs + first 140 chars of body + nonce verdict");
    lines.push(
      inv.inlineScripts
        .map(
          (s, i) =>
            `  ${i + 1}. attrs: \`${s.attrs}\`\n     body@140: \`${s.body140}\`\n     carries THIS response's CSP nonce (${s.nonceShort}): ${s.nonceOk ? "yes" : "**NO — nonceless**"}${s.isJsonLd ? "  ← application/ld+json" : ""}${s.isReactRuntime ? "  ← react-dom/react-router runtime-class script" : ""}`,
        )
        .join("\n"),
    );
  }
  if (inv.srcScripts.length) {
    lines.push(
      `- src= scripts (not nonce-relevant): ${inv.srcScripts.length} — e.g. ${inv.srcScripts.slice(0, 3).map((s) => `\`${s.attrs}\``).join(" | ")}${inv.srcScripts.length > 3 ? " | …" : ""}`,
    );
  }
  lines.push(
    `- JSON-LD (application/ld+json) present: ${inv.hasJsonLd ? "yes" : "no"}; carries nonce: ${inv.jsonLdNonceOk ? (inv.hasJsonLd ? "yes" : "n/a") : "**no**"}; declares https://schema.org @context: ${inv.hasSchemaContext ? "yes" : "no"}`,
  );
  return lines.join("\n");
}

// Raw-HTML inventory of one URL: the response's OWN CSP nonce vs every
// src-less <script>. Evidence only — no assertions, nothing weakened.
async function inventoryRawHtml(context, url) {
  try {
    const response = await context.request.get(url);
    const status = response.status();
    const csp = response.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/u.exec(csp)?.[1] ?? "";
    const scriptSrc = /script-src[^;]*/iu.exec(csp)?.[0] ?? "";
    const html = await response.text();
    const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)].map((m) => ({ attrs: m[1] ?? "", body: m[2] ?? "" }));
    const inlineScripts = tags.filter((t) => !/\bsrc\s*=/iu.test(t.attrs));
    const srcScripts = tags.filter((t) => /\bsrc\s*=/iu.test(t.attrs));
    const nonceMarker = nonce ? `nonce="${nonce}"` : null;
    const inv = {
      ok: true,
      status,
      fetchedUrl: response.url(),
      csp,
      scriptSrc: scriptSrc.trim(),
      nonceShort: nonce ? `${nonce.slice(0, 8)}…` : "(none found)",
      nonceCount: (csp.match(/'nonce-[^']+'/gu) ?? []).length,
      hasUnsafeInline: scriptSrc.includes("'unsafe-inline'"),
      hasShaHashes: /'sha256-[^']*'/u.test(scriptSrc),
      totalScripts: tags.length,
      inlineScripts: [],
      srcScripts: srcScripts.map((t) => ({ attrs: t.attrs.trim() })),
      hasJsonLd: /type="application\/ld\+json"/iu.test(html),
      jsonLdNonceOk: false,
      hasSchemaContext: /@context['"]\s*:\s*['"]https:\/\/schema\.org['"]/u.test(html),
    };
    for (const t of inlineScripts) {
      const attrs = t.attrs.trim();
      const nonceOk = Boolean(nonceMarker) && attrs.includes(nonceMarker);
      const isJsonLd = /type="application\/ld\+json"/iu.test(attrs);
      if (isJsonLd && nonceOk) inv.jsonLdNonceOk = true;
      const body = t.body.replace(/\s+/gu, " ").trim();
      inv.inlineScripts.push({
        attrs,
        body140: body.slice(0, 140),
        nonceOk,
        isJsonLd,
        isReactRuntime:
          /id="_R_"|\$R[BCV]\b|\$RX|\$RT\b|\$RR\b|streamController|completeSegment|writeInlineScript|flushCompletedQueues|listenToBroadcast|initializeFFRec|ReactDOMHydrationDiffCallbacks/u.test(
            t.body,
          ) || /id="_R_"/u.test(attrs),
      });
    }
    return inv;
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

// ---------- sweep ----------

const browser = await chromium.launch(); // headless — same as the test runner
const startedAt = new Date();
const runLog = [];

for (const [letter, journey] of Object.entries(JOURNEYS)) {
  for (const vpLabel of ["desktop", "mobile"]) {
    const contextOptions = {
      ...devices["Desktop Chrome"],
      viewport: isMobileViewport(vpLabel) ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      ...(isMobileViewport(vpLabel) ? { isMobile: true, hasTouch: true } : {}),
    };
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    const consoleRecords = [];
    const documentResponses = [];
    const navigationResponses = []; // main-frame document responses, in event order
    const failedRequests = [];
    const pageErrors = [];

    page.on("console", (message) => {
      const location = message.location();
      const record = {
        type: message.type(),
        text: message.text(),
        url: location?.url ?? "",
        lineNumber: location?.lineNumber ?? null,
        columnNumber: location?.columnNumber ?? null,
        argsText: "",
      };
      consoleRecords.push(record);
      // Second-arg fidelity (e.g. the #419 component stack) without blocking:
      // resolve asynchronously; the log is written after the settle wait.
      void (async () => {
        try {
          const args = typeof message.args === "function" ? message.args() : message.args;
          if (!Array.isArray(args) || args.length < 2) return;
          const parts = [];
          for (const handle of args) {
            parts.push(
              await handle.evaluate((value) =>
                typeof value === "string"
                  ? value
                  : (() => {
                      try {
                        const json = JSON.stringify(value);
                        return json === undefined ? String(value) : json;
                      } catch {
                        return String(value);
                      }
                    })(),
              ),
            );
          }
          record.argsText = parts.join(" ");
        } catch {
          // Execution context gone (mid-journey navigation) — text() already recorded.
        }
      })();
    });
    page.on("pageerror", (error) => {
      pageErrors.push({ name: error?.name ?? "Error", message: error?.message ?? String(error), stack: error?.stack ?? "" });
    });
    page.on("response", (response) => {
      const request = response.request();
      if (request.resourceType() === "document") {
        documentResponses.push({
          status: response.status(),
          url: response.url(),
          location: response.headers()["location"] ?? "",
          frameUrl: response.frame().url(),
        });
        if (request.isNavigationRequest() && response.frame() === page.mainFrame()) {
          navigationResponses.push(response);
        }
      }
    });
    page.on("requestfailed", (request) => {
      failedRequests.push({
        url: request.url(),
        failure: request.failure()?.errorText ?? "unknown",
        resourceType: request.resourceType(),
      });
    });

    await page.addInitScript(CSP_COLLECTOR);

    const journeyStart = new Date();
    let journeyError = "";
    try {
      // No baseURL fixture here — resolve against BASE exactly as the
      // projects' productionBaseURL would (absolute paths replaced wholesale).
      const targetUrl = new URL(journey.path, BASE).href;
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      await journey.run(page);
    } catch (error) {
      journeyError = String(error);
    }
    const journeyEnd = new Date();

    // Collect everything AFTER the full settle so late violations are included.
    let cspViolations = [];
    try {
      cspViolations =
        (await page.evaluate(() => {
          const fromWindow = window.__cspViolations ?? [];
          let fromSession = [];
          try {
            fromSession = JSON.parse(sessionStorage.getItem("__cspViolations") ?? "[]");
          } catch {}
          return JSON.stringify(fromWindow) === JSON.stringify(fromSession)
            ? fromWindow
            : fromWindow.concat([{ note: "window/sessionStorage divergence — session copy:", sessionCopy: fromSession }]);
        })) ?? [];
    } catch (error) {
      journeyError = (journeyError ? journeyError + " | " : "") + "collect: " + String(error);
    }

    // Redirect chain: walk the LAST main-frame navigation response backwards
    // (final 200 ← its redirectedFrom's 302 ← …), regardless of whether the
    // runner emits intermediate redirect responses as events.
    const redirectChain = [];
    try {
      let resp = navigationResponses.at(-1);
      while (resp) {
        redirectChain.push({ status: resp.status(), url: resp.url(), location: resp.headers()["location"] ?? "" });
        const redirectedFrom = resp.request().redirectedFrom();
        resp = redirectedFrom ? await redirectedFrom.response() : null;
      }
    } catch (error) {
      redirectChain.push({ status: "chain-walk-error", url: String(error), location: "" });
    }

    const finalUrl = (() => {
      try {
        return page.url();
      } catch {
        return "(page closed)";
      }
    })();

    const screenshotPath = path.join(SHOTS, `${letter}-${vpLabel}.png`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false }); // the settled viewport = what the user sees
    } catch (error) {
      journeyError = (journeyError ? journeyError + " | " : "") + "screenshot: " + String(error);
    }

    const inv = finalUrl.startsWith("http") ? await inventoryRawHtml(context, finalUrl) : { ok: false, error: "no final URL" };

    const errorCount = consoleRecords.filter((r) => r.type === "error").length;
    const warningCount = consoleRecords.filter((r) => r.type === "warning").length;

    const md = [
      `# Journey ${letter} — ${vpLabel} (${isMobileViewport(vpLabel) ? "mobile 390×844" : "desktop 1440×900"})`,
      "",
      `- Journey: ${journey.title} (initial navigation: \`${journey.path}\`)`,
      `- Base URL: \`${BASE}\` (E2E_PROD_BASE_URL; production, pre-fix at sweep time)`,
      `- Context: \`...devices["Desktop Chrome"]\` ${isMobileViewport(vpLabel) ? "+ viewport 390×844 + isMobile + hasTouch — exactly the playwright.config.ts \`mobile-chromium\` project's use block" : "+ viewport 1440×900 — exactly the playwright.config.ts \`chromium\` project's use block"}; headless; deviceScaleFactor ${contextOptions.deviceScaleFactor}; UA \`${contextOptions.userAgent}\``,
      `- Process: single sequential node/playwright process, no worker pool (PLAYWRIGHT_WORKERS=1 honored); no retries.`,
      `- Started: ${journeyStart.toISOString()} — Finished: ${journeyEnd.toISOString()} (duration ${((journeyEnd - journeyStart) / 1000).toFixed(1)}s)`,
      `- **Final URL: ${finalUrl}**`,
      `- Main-frame navigation response chain (final response, walked backwards through redirect hops):`,
      "",
      fmtRedirectChain(redirectChain),
      "",
      `## Counts (unbounded — every record below is complete, nothing truncated)`,
      "",
      `- console records: ${consoleRecords.length} total (error: ${errorCount}, warning: ${warningCount}, other: ${consoleRecords.length - errorCount - warningCount})`,
      `- securitypolicyviolation events: ${cspViolations.length}`,
      `- pageerror events: ${pageErrors.length}`,
      `- failed requests: ${failedRequests.length}`,
      `- document-type responses seen: ${documentResponses.length}`,
      journeyError ? `- **journey/collect error: ${journeyError}**` : `- journey completed without vehicle error`,
      "",
      `## ALL console messages (full text)`,
      "",
      fmtConsole(consoleRecords),
      "",
      `## securitypolicyviolation events (ALL fields)`,
      "",
      fmtCsp(cspViolations),
      "",
      `## pageerror events (full text + stack)`,
      "",
      fmtPageErrors(pageErrors),
      "",
      `## document-type responses (all, incl. iframes; Location = redirect hop)`,
      "",
      fmtDocResponses(documentResponses),
      "",
      `## failed requests (all)`,
      "",
      fmtFailedRequests(failedRequests),
      "",
      `## Raw-HTML inline-script inventory of the FINAL URL (this response's own CSP nonce)`,
      "",
      fmtScriptInventory(inv),
      "",
      `## Screenshot`,
      "",
      `- \`.fleet/sweep-3301/screenshots/${letter}-${vpLabel}.png\` (final settled state, viewport)`,
      "",
    ].join("\n");

    const logPath = path.join(LOGS, `${letter}-${vpLabel}.md`);
    writeFileSync(logPath, md);

    runLog.push({
      journey: letter,
      viewport: vpLabel,
      finalUrl,
      durationMs: journeyEnd - journeyStart,
      consoleTotal: consoleRecords.length,
      consoleErrors: errorCount,
      consoleWarnings: warningCount,
      cspViolations: cspViolations.length,
      pageErrors: pageErrors.length,
      failedRequests: failedRequests.length,
      journeyError,
      log: path.relative(HERE, logPath),
      screenshot: path.relative(HERE, screenshotPath),
      noncelessInline: inv.ok ? inv.inlineScripts.filter((s) => !s.nonceOk).length : -1,
      inlineTotal: inv.ok ? inv.inlineScripts.length : -1,
    });

    await context.close();
  }
}

await browser.close();

const finishedAt = new Date();
const digest = [
  `# Sweep digest — issue #3301 phase 5 (unbounded pre-fix prod console sweep)`,
  "",
  `- Base URL: \`${BASE}\``,
  `- Sweep window: ${startedAt.toISOString()} → ${finishedAt.toISOString()}`,
  `- Vehicle: \`.fleet/sweep-3301/run-sweep.mjs\` — single sequential node/playwright process (no worker pool; PLAYWRIGHT_WORKERS=1 honored), headless Chromium, no retries, no filters, no caps.`,
  `- Journeys: 5 (a, b, c, d, f) × 2 viewports (desktop 1440×900 = \`chromium\` project, mobile 390×844 = \`mobile-chromium\` project) = 10 runs.`,
  "",
  `| journey | viewport | final URL | duration | console (err/warn/total) | CSP events | pageerrors | failed req | nonceless inline / total inline | vehicle error |`,
  `|---|---|---|---|---|---|---|---|---|---|`,
  ...runLog.map(
    (r) =>
      `| ${r.journey} | ${r.viewport} | ${r.finalUrl} | ${(r.durationMs / 1000).toFixed(1)}s | ${r.consoleErrors}/${r.consoleWarnings}/${r.consoleTotal} | ${r.cspViolations} | ${r.pageErrors} | ${r.failedRequests} | ${r.noncelessInline}/${r.inlineTotal} | ${r.journeyError ? "yes" : "no"} |`,
  ),
  "",
  `Per-run evidence: logs/<journey>-<viewport>.md + screenshots/<journey>-<viewport>.png. All findings rows in findings.md trace to those logs.`,
  "",
].join("\n");

writeFileSync(path.join(HERE, "digest.md"), digest);
console.log(digest);
