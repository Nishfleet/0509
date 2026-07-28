#!/usr/bin/env node
/**
 * BL-025 live proof capture — Overview (/app, new-user state) and /search.
 *
 * Local fixture harness only. Signs in with the e2e fixture cookie, forces the
 * workspace theme preference before first paint, and records for every
 * viewport/theme pair: a full-page screenshot, console errors, the document
 * height, and the horizontal overflow. Run against `e2e:serve:local`.
 *
 *   node scripts/bl025-capture.mjs <outDir> <prefix>
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4179";
const FIXTURE_COOKIE = "f9_e2e_fixture";
const FIXTURE_MODE_HEADER = "x-0509-e2e-test-mode";

const outDir = process.argv[2] ?? "/tmp/bl025";
const prefix = process.argv[3] ?? "after";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
];
const THEMES = ["light", "dark"];
const SURFACES = [
  { name: "overview", url: "/app", user: "e2e-free" },
  { name: "search", url: "/search", user: "e2e-free" },
];
/** Horizontal-scroll sweep (brief §9.1) runs wider than the capture set. */
const SWEEP_WIDTHS = [320, 360, 390, 414, 480, 640, 768, 1024, 1280, 1440, 1600, 1920, 2560];

mkdirSync(outDir, { recursive: true });

/**
 * Scope the fixture-mode header to the app origin. Setting it context-wide
 * adds it to the Google Fonts preflight too, which the CDN rejects — the
 * capture then renders in fallback faces and is not proof of the design.
 */
async function applyFixtureHeader(context) {
  await context.route(`${BASE_URL}/**`, async (route) => {
    await route.continue({
      headers: { ...route.request().headers(), [FIXTURE_MODE_HEADER]: "1" },
    });
  });
}

const browser = await chromium.launch();
const metrics = [];
const sweep = [];

for (const surface of SURFACES) {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      await applyFixtureHeader(context);
      await context.addCookies([
        { name: FIXTURE_COOKIE, value: surface.user, url: BASE_URL, sameSite: "Lax" },
      ]);
      await context.addInitScript(
        (value) => window.localStorage.setItem("f9-theme", value),
        theme,
      );

      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(String(error)));

      await page.goto(`${BASE_URL}${surface.url}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);

      const measured = await page.evaluate(() => ({
        theme: document.documentElement.getAttribute("data-f9-theme"),
        docHeight: document.documentElement.scrollHeight,
        overflow: Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      }));

      const file = path.join(outDir, `${prefix}-${surface.name}-${viewport.name}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: true });

      metrics.push({
        surface: surface.name,
        url: surface.url,
        viewport: viewport.name,
        theme,
        resolvedTheme: measured.theme,
        docHeight: measured.docHeight,
        horizontalOverflow: measured.overflow,
        consoleErrors,
        pageErrors,
        screenshot: path.basename(file),
      });
      console.log(
        `${surface.name} ${viewport.name} ${theme}: h=${measured.docHeight} overflow=${measured.overflow} ` +
          `errors=${consoleErrors.length + pageErrors.length}`,
      );

      await context.close();
    }
  }
}

// Horizontal-scroll sweep, dark theme (the denser of the two grounds).
for (const surface of SURFACES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await applyFixtureHeader(context);
  await context.addCookies([
    { name: FIXTURE_COOKIE, value: surface.user, url: BASE_URL, sameSite: "Lax" },
  ]);
  await context.addInitScript(() => window.localStorage.setItem("f9-theme", "dark"));
  const page = await context.newPage();
  for (const width of SWEEP_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE_URL}${surface.url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() =>
      Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    );
    sweep.push({ surface: surface.name, width, horizontalOverflow: overflow });
    console.log(`sweep ${surface.name} @${width}: overflow=${overflow}`);
  }
  await context.close();
}

await browser.close();

writeFileSync(
  path.join(outDir, `${prefix}-metrics.json`),
  `${JSON.stringify({ capturedAt: new Date().toISOString(), metrics, sweep }, null, 2)}\n`,
);

const failures = metrics.filter(
  (entry) =>
    entry.consoleErrors.length > 0 || entry.pageErrors.length > 0 || entry.horizontalOverflow > 1,
);
const sweepFailures = sweep.filter((entry) => entry.horizontalOverflow > 1);
if (failures.length || sweepFailures.length) {
  console.error("FAIL", JSON.stringify({ failures, sweepFailures }, null, 2));
  process.exitCode = 1;
} else {
  console.log("clean: zero console errors, zero horizontal scroll");
}
