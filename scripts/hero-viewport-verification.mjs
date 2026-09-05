#!/usr/bin/env node
// Regression verification for the chosen BET 9 hero direction (Safe) — issue #1488.
//
// Loads docs/design/hero-directions/01-safe.html at the two termination
// viewports (1440x900 desktop, 390x844 mobile) and asserts that the headline,
// value proposition, and clickable CTA all sit inside the first viewport,
// with zero console errors and no horizontal overflow. Mirrors the checks in
// scripts/bet9-first-viewport-verification.mjs but runs against the static
// exploration artifact so it stays green without a running app server.
//
// Exit 0 = PASS, exit 1 = FAIL. Prints one line per check so the vitest
// wrapper can assert on the structured output.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HERO_HTML = path.join(__dirname, "..", "docs", "design", "hero-directions", "01-safe.html");

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const SELECTORS = {
  headline: "h1.ld-wall",
  valueProposition: "p.ld-deck-copy",
  cta: ".ld-command button[type='submit']",
};

const FOLD_EPSILON_PX = 1;
const NESTED_OVERFLOW_TOLERANCE_PX = 2;

let failed = false;
const browser = await chromium.launch();
try {
  for (const { name, width, height } of VIEWPORTS) {
    const fold = height;
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    const url = "file://" + HERO_HTML;
    const res = await page.goto(url, { waitUntil: "networkidle" });
    if (!res || !res.ok()) {
      console.log(`FAIL ${name} load status=${res ? res.status() : "null"}`);
      failed = true;
      await page.close();
      continue;
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);

    const snap = await page.evaluate(
      ({ selectors, fold, nestedTolerance }) => {
        const rect = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return {
            top: b.top,
            bottom: b.bottom,
            width: b.width,
            height: b.height,
            tag: el.tagName,
            type: el.type,
            disabled: el.disabled,
            pointerEvents: getComputedStyle(el).pointerEvents,
          };
        };
        const inFold = (r) =>
          r && r.width > 0 && r.height > 0 && r.top >= -1 && r.bottom <= fold + 1;
        const clickable = (r) =>
          r &&
          r.tag === "BUTTON" &&
          r.type === "submit" &&
          !r.disabled &&
          r.pointerEvents !== "none" &&
          r.width > 0 &&
          r.height > 0;
        // Nested overflow: every element whose box starts inside the first
        // viewport must not overflow its own box beyond the tolerance.
        // Excludes intentional clipped/scroll containers (overflow-x:
        // auto/scroll/hidden/clip) and inline/contents display, mirroring
        // scripts/bet9-first-viewport-verification.mjs.
        const nested = [];
        for (const el of document.querySelectorAll("*")) {
          if (el.classList.contains("f9-sr-only") || el.classList.contains("ld-sr-only")) continue;
          if (el instanceof HTMLSelectElement) continue;
          const overflow = el.scrollWidth - el.clientWidth;
          if (overflow <= nestedTolerance) continue;
          const style = window.getComputedStyle(el);
          if (style.display === "inline" || style.display === "contents") continue;
          if (["auto", "scroll", "hidden", "clip"].includes(style.overflowX)) continue;
          const b = el.getBoundingClientRect();
          if (b.top >= fold + 1) continue;
          nested.push({ selector: el.tagName, overflow });
        }
        return {
          headline: rect(selectors.headline),
          valueProposition: rect(selectors.valueProposition),
          cta: rect(selectors.cta),
          headlineInFold: inFold(rect(selectors.headline)),
          valuePropInFold: inFold(rect(selectors.valueProposition)),
          ctaInFold: inFold(rect(selectors.cta)),
          ctaClickable: clickable(rect(selectors.cta)),
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          nestedOverflow: nested,
        };
      },
      { selectors: SELECTORS, fold, nestedTolerance: NESTED_OVERFLOW_TOLERANCE_PX },
    );

    const checks = [
      { name: `${name} headline_in_first_viewport`, pass: !!snap.headlineInFold, detail: snap.headline ? `top=${snap.headline.top} bottom=${snap.headline.bottom} fold=${fold}` : "missing" },
      { name: `${name} value_proposition_in_first_viewport`, pass: !!snap.valuePropInFold, detail: snap.valueProposition ? `top=${snap.valueProposition.top} bottom=${snap.valueProposition.bottom} fold=${fold}` : "missing" },
      { name: `${name} cta_in_first_viewport`, pass: !!snap.ctaInFold, detail: snap.cta ? `top=${snap.cta.top} bottom=${snap.cta.bottom} fold=${fold}` : "missing" },
      { name: `${name} cta_clickable`, pass: !!snap.ctaClickable, detail: snap.cta ? `tag=${snap.cta.tag} type=${snap.cta.type} disabled=${snap.cta.disabled} pointerEvents=${snap.cta.pointerEvents}` : "missing" },
      { name: `${name} no_horizontal_scroll`, pass: snap.scrollWidth <= snap.clientWidth, detail: `scrollWidth=${snap.scrollWidth} clientWidth=${snap.clientWidth}` },
      { name: `${name} no_nested_overflow_in_first_viewport`, pass: snap.nestedOverflow.length === 0, detail: snap.nestedOverflow.length ? JSON.stringify(snap.nestedOverflow) : "0" },
      { name: `${name} zero_console_errors`, pass: consoleErrors.length === 0, detail: consoleErrors.length ? consoleErrors.join("; ") : "0" },
    ];
    for (const c of checks) {
      const status = c.pass ? "PASS" : "FAIL";
      console.log(`${status} ${c.name}: ${c.detail}`);
      if (!c.pass) failed = true;
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? "Termination: FAIL" : "Termination: PASS");
if (failed) process.exit(1);
