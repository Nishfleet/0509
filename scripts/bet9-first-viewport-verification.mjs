#!/usr/bin/env node
// Live verification for BET 9 — "Make the first viewport about the buyer"
// (category-research.md §3.4, issue #976).
//
// Opens `/` at the two termination viewports (1440x900 and 390x844) and
// checks that the headline, value proposition, and clickable search CTA all
// sit inside the first viewport, with zero console errors and no horizontal
// scroll. Writes first-viewport screenshots next to this script's --out dir.
//
// Local D1 often has no proof brief, so the fallback H1 is too short to
// prove the budget. On loopback hosts the script injects the live Nykaa-
// length wall unless --no-inject is set. Production is never rewritten.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

export const DEFAULT_BASE_URL = "https://0509.io";
export const FOLD_EPSILON_PX = 1;

export const VIEWPORTS = Object.freeze([
  Object.freeze({ name: "desktop", width: 1440, height: 900 }),
  Object.freeze({ name: "mobile", width: 390, height: 844 }),
]);

export const SELECTORS = Object.freeze({
  headline: "h1.ld-wall",
  valueProposition: "p.ld-deck-copy",
  cta: ".ld-command button[type='submit']",
});

export const WORST_CASE_HEADLINE_HTML =
  '<span class="ld-row">“Unlock the secret to radiant…”</span>' +
  '<span class="ld-row">was the hook on 12 Meta ads <i class="ld-flag">Aug 25</i></span>' +
  '<span class="ld-row ld-row-indent">linking to nykaa.com.</span>' +
  '<span class="ld-row">We saved the proof.</span>';

// After #1173 the Nykaa wall lives in the proof strip, not the H1. Local D1
// often renders the empty strip, which is too short to prove the #1212 budget.
export const WORST_CASE_PROOF_STRIP_HTML =
  '<div class="ld-proof-strip-head">' +
  '<span class="ld-proof-live">Live proof</span>' +
  "<b>We saved the proof — nykaa.com</b>" +
  '<span class="ld-proof-time">Captured Aug 25 · Meta Ad Library</span>' +
  "</div>" +
  '<div class="ld-proof-strip-body">' +
  '<div class="ld-proof-hook">' +
  '<span class="ld-proof-quote">“Unlock the secret to radiant…”</span>' +
  '<span class="ld-proof-attrib">was the hook on 12 Meta ads linking to nykaa.com. We saved every one.</span>' +
  "</div>" +
  '<div class="ld-proof-trail"><ul><li><span class="ld-proof-signal">Ad hook</span>Unlock the secret to radiant</li></ul></div>' +
  "</div>" +
  '<div class="ld-proof-strip-foot">Every row links to the same public page. No proof, no claim.</div>';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const DEFAULT_OUT_DIR = join(REPO_ROOT, "docs", "design", "bet9-first-viewport");

/**
 * @param {string | null | undefined} text
 */
export function isFallbackHeadline(text) {
  if (!text) return true;
  const collapsed = text.replace(/\s+/g, " ").trim();
  return /Know when/i.test(collapsed) && /competitors change/i.test(collapsed);
}

/**
 * @param {string | null | undefined} text
 */
export function isEmptyProofStrip(text) {
  if (!text) return true;
  return /No live proof yet/i.test(text.replace(/\s+/g, " ").trim());
}

/**
 * @param {{ top: number, bottom: number, height: number, width: number } | null} rect
 * @param {number} foldHeight
 * @param {number} [epsilon]
 */
export function rectInFold(rect, foldHeight, epsilon = FOLD_EPSILON_PX) {
  if (!rect) return false;
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (rect.top < -epsilon) return false;
  if (rect.bottom > foldHeight + epsilon) return false;
  return true;
}

/**
 * @param {{
 *   tag?: string,
 *   type?: string,
 *   disabled?: boolean,
 *   pointerEvents?: string,
 *   width?: number,
 *   height?: number,
 * } | null} cta
 */
export function isClickableCta(cta) {
  if (!cta) return false;
  if (cta.tag !== "BUTTON") return false;
  if (cta.type !== "submit") return false;
  if (cta.disabled) return false;
  if (cta.pointerEvents === "none") return false;
  if ((cta.width ?? 0) <= 0 || (cta.height ?? 0) <= 0) return false;
  return true;
}

/**
 * @typedef {{
 *   top: number,
 *   bottom: number,
 *   height: number,
 *   width: number,
 *   text?: string,
 *   tag?: string,
 *   type?: string,
 *   disabled?: boolean,
 *   pointerEvents?: string,
 * }} MeasuredRect
 *
 * @typedef {{
 *   name: string,
 *   fold: number,
 *   scrollWidth: number,
 *   clientWidth: number,
 *   headline: MeasuredRect | null,
 *   valueProposition: MeasuredRect | null,
 *   cta: MeasuredRect | null,
 *   consoleErrors: string[],
 *   injected?: boolean,
 *   screenshotPath?: string,
 * }} ViewportSnapshot
 *
 * @typedef {{
 *   name: string,
 *   ok: boolean,
 *   detail: string,
 * }} ViewportCheck
 *
 * @typedef {{
 *   name: string,
 *   pass: boolean,
 *   checks: ViewportCheck[],
 *   snapshot: ViewportSnapshot,
 * }} ViewportVerdict
 */

/**
 * @param {ViewportSnapshot} snapshot
 * @returns {ViewportVerdict}
 */
export function evaluateViewport(snapshot) {
  const fold = snapshot.fold;
  const headlineOk = rectInFold(snapshot.headline, fold);
  const deckOk = rectInFold(snapshot.valueProposition, fold);
  const ctaInFold = rectInFold(snapshot.cta, fold);
  const ctaClickable = isClickableCta(snapshot.cta);
  const noOverflow = snapshot.scrollWidth <= snapshot.clientWidth;
  const noConsole = snapshot.consoleErrors.length === 0;

  const checks = [
    {
      name: "headline_in_first_viewport",
      ok: headlineOk,
      detail: describeRect("headline", snapshot.headline, fold),
    },
    {
      name: "value_proposition_in_first_viewport",
      ok: deckOk,
      detail: describeRect("value proposition", snapshot.valueProposition, fold),
    },
    {
      name: "cta_in_first_viewport",
      ok: ctaInFold,
      detail: describeRect("CTA", snapshot.cta, fold),
    },
    {
      name: "cta_clickable",
      ok: ctaClickable,
      detail: snapshot.cta
        ? `tag=${snapshot.cta.tag} type=${snapshot.cta.type} disabled=${snapshot.cta.disabled} pointer-events=${snapshot.cta.pointerEvents}`
        : "CTA missing",
    },
    {
      name: "no_horizontal_scroll",
      ok: noOverflow,
      detail: `scrollWidth=${snapshot.scrollWidth} clientWidth=${snapshot.clientWidth} overflow=${snapshot.scrollWidth - snapshot.clientWidth}`,
    },
    {
      name: "zero_console_errors",
      ok: noConsole,
      detail:
        snapshot.consoleErrors.length === 0
          ? "console errors: 0"
          : `console errors: ${snapshot.consoleErrors.join(" | ")}`,
    },
  ];

  return {
    name: snapshot.name,
    pass: checks.every((check) => check.ok),
    checks,
    snapshot,
  };
}

/**
 * @param {ViewportVerdict[]} viewports
 */
export function evaluateTermination(viewports) {
  return {
    pass: viewports.length > 0 && viewports.every((viewport) => viewport.pass),
    viewports,
  };
}

/**
 * @param {{
 *   baseUrl: string,
 *   termination: ReturnType<typeof evaluateTermination>,
 * }} input
 */
export function formatReport({ baseUrl, termination }) {
  const lines = [`BET 9 first-viewport verification @ ${baseUrl}`, ""];
  for (const viewport of termination.viewports) {
    const spec =
      VIEWPORTS.find((row) => row.name === viewport.name) ?? {
        width: "?",
        height: "?",
      };
    lines.push(
      `${viewport.pass ? "PASS" : "FAIL"} ${viewport.name} ${spec.width}x${spec.height} fold=${viewport.snapshot.fold}`,
    );
    for (const check of viewport.checks) {
      lines.push(`  ${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
    }
    lines.push("");
  }
  lines.push(
    termination.pass
      ? "Termination: PASS — headline, value proposition, and clickable CTA are in the first viewport at 1440 and 390."
      : "Termination: FAIL — see viewport checks above.",
  );
  return lines.join("\n");
}

/**
 * @param {string} label
 * @param {MeasuredRect | null} rect
 * @param {number} fold
 */
function describeRect(label, rect, fold) {
  if (!rect) return `${label} missing`;
  const inFold = rectInFold(rect, fold);
  return `${label} top=${rect.top.toFixed(2)} bottom=${rect.bottom.toFixed(2)} fold=${fold} ${inFold ? "in" : "out"}`;
}

/**
 * @param {string} hostname
 */
export function shouldInjectWorstCaseHeadline(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

/**
 * @param {{
 *   baseUrl?: string,
 *   outDir?: string,
 *   injectWorstCase?: boolean | "auto",
 *   browserFactory?: typeof chromium.launch,
 * }} [input]
 */
export async function runFirstViewportCheck(input = {}) {
  const baseUrl = input.baseUrl ?? DEFAULT_BASE_URL;
  const outDir = input.outDir ?? DEFAULT_OUT_DIR;
  const origin = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const inject =
    input.injectWorstCase === "auto" || input.injectWorstCase === undefined
      ? shouldInjectWorstCaseHeadline(origin.hostname)
      : Boolean(input.injectWorstCase);

  mkdirSync(outDir, { recursive: true });

  const launch = input.browserFactory ?? ((opts) => chromium.launch(opts));
  const browser = await launch({ headless: true });
  /** @type {ViewportVerdict[]} */
  const viewports = [];
  try {
    for (const spec of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: spec.width, height: spec.height },
        deviceScaleFactor: 1,
      });
      /** @type {string[]} */
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => {
        consoleErrors.push(String(error));
      });

      await page.goto(origin.toString(), { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);

      const headlineText = await page.evaluate((selector) => {
        const node = document.querySelector(selector);
        return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
      }, SELECTORS.headline);

      let injected = false;
      if (inject && isFallbackHeadline(headlineText)) {
        injected = await page.evaluate(
          ({ selector, html }) => {
            const node = document.querySelector(selector);
            if (!node) return false;
            node.innerHTML = html;
            return true;
          },
          { selector: SELECTORS.headline, html: WORST_CASE_HEADLINE_HTML },
        );
      }

      const stripText = await page.evaluate(() => {
        const node = document.querySelector(".ld-proof-strip");
        return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
      });
      if (inject && isEmptyProofStrip(stripText)) {
        const stripInjected = await page.evaluate((html) => {
          const node = document.querySelector(".ld-proof-strip");
          if (!node) return false;
          node.innerHTML = html;
          return true;
        }, WORST_CASE_PROOF_STRIP_HTML);
        injected = injected || stripInjected;
      }

      const snapshot = await page.evaluate((selectors) => {
        /** @param {Element | null} node */
        const box = (node) => {
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return {
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
            width: rect.width,
            text: (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
            tag: node.tagName,
            type: node instanceof HTMLButtonElement || node instanceof HTMLInputElement
              ? node.type
              : "",
            disabled:
              node instanceof HTMLButtonElement || node instanceof HTMLInputElement
                ? node.disabled
                : false,
            pointerEvents: style.pointerEvents,
          };
        };
        const doc = document.documentElement;
        return {
          fold: window.innerHeight,
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          headline: box(document.querySelector(selectors.headline)),
          valueProposition: box(document.querySelector(selectors.valueProposition)),
          cta: box(document.querySelector(selectors.cta)),
        };
      }, SELECTORS);

      const screenshotPath = join(outDir, `${spec.name}-${spec.width}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      await page.close();

      viewports.push(
        evaluateViewport({
          name: spec.name,
          fold: snapshot.fold,
          scrollWidth: snapshot.scrollWidth,
          clientWidth: snapshot.clientWidth,
          headline: snapshot.headline,
          valueProposition: snapshot.valueProposition,
          cta: snapshot.cta,
          consoleErrors,
          injected,
          screenshotPath,
        }),
      );
    }
  } finally {
    await browser.close();
  }

  const termination = evaluateTermination(viewports);
  return { baseUrl: origin.toString(), outDir, inject, termination };
}

/**
 * @param {string[]} argv
 */
export function parseCliArgs(argv) {
  /** @type {{ baseUrl?: string, outDir?: string, json?: boolean, injectWorstCase?: boolean | "auto" }} */
  const parsed = { injectWorstCase: "auto" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url" && argv[i + 1]) {
      parsed.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--out" && argv[i + 1]) {
      parsed.outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--inject-worst-case-headline") {
      parsed.injectWorstCase = true;
      continue;
    }
    if (arg === "--no-inject") {
      parsed.injectWorstCase = false;
      continue;
    }
  }
  return parsed;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const run = await runFirstViewportCheck({
    baseUrl: args.baseUrl,
    outDir: args.outDir,
    injectWorstCase: args.injectWorstCase,
  });
  const report = formatReport({
    baseUrl: run.baseUrl,
    termination: run.termination,
  });
  console.log(report);
  if (args.json) {
    console.log("");
    console.log("JSON_REPORT_BEGIN");
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          baseUrl: run.baseUrl,
          outDir: run.outDir,
          inject: run.inject,
          termination: run.termination,
        },
        null,
        2,
      ),
    );
    console.log("JSON_REPORT_END");
  }
  process.exit(run.termination.pass ? 0 : 1);
}

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(2);
  });
}
