import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * BL-030 live proof, captured from the local fixture harness.
 *
 * Opt-in: this writes ~30 full-page screenshots and sweeps 320-2560 for
 * horizontal scroll, which is far too slow for every local-auth run. Set
 * `BL030_CAPTURE=1` (and optionally `BL030_OUT=<dir>`) to produce the phase
 * evidence set.
 *
 * It captures the two rebuilt surfaces AND an untouched route, because the
 * program's coexistence claim — every surface whose phase has not landed keeps
 * running on the old system inside the new shell — is only a claim until
 * somebody photographs it.
 */
const ENABLED = process.env.BL030_CAPTURE === "1";
const OUT_DIR =
  process.env.BL030_OUT ?? "/home/nish/workspaces/products/0509-audit-artifacts-bl030";
const PREFIX = process.env.BL030_PREFIX ?? "after";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
] as const;
const THEMES = ["light", "dark"] as const;
const SURFACES = [
  { name: "overview", url: "/app", user: "e2e-agency" },
  { name: "overview-newuser", url: "/app", user: "e2e-free" },
  { name: "competitors-board", url: "/app/watchlists", user: "e2e-starter" },
  {
    name: "competitors-pane",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1",
    user: "e2e-starter",
  },
  { name: "collections-untouched", url: "/app/collections", user: "e2e-agency" },
] as const;
const SWEEP_WIDTHS = [320, 360, 390, 414, 480, 640, 768, 1024, 1280, 1440, 1600, 1920, 2560];

async function prepare(context: BrowserContext, baseURL: string, user: string, theme: string) {
  await context.addCookies([
    { name: "f9_e2e_fixture", value: user, url: baseURL, sameSite: "Lax" },
  ]);
  await context.route(`${baseURL}/**`, (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-0509-e2e-test-mode": "1" },
    }),
  );
  await context.addInitScript((value) => {
    try {
      window.localStorage.setItem("f9-theme", value as string);
    } catch {
      /* storage disabled — the boot script falls back to light */
    }
  }, theme);
}

async function measure(page: Page) {
  return page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-f9-theme"),
    docHeight: document.documentElement.scrollHeight,
    overflow: Math.max(
      0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    greenMarks: document.querySelectorAll(".f9-wk-ins").length,
    ruleWeights: [
      ...new Set(
        [...document.querySelectorAll(".f9-wk-page, .f9-wk-page *")]
          .flatMap((node) => {
            const style = getComputedStyle(node);
            return [
              style.borderTopWidth,
              style.borderRightWidth,
              style.borderBottomWidth,
              style.borderLeftWidth,
            ];
          })
          .filter((width) => width !== "0px"),
      ),
    ].sort(),
  }));
}

test.describe("BL-030 live proof", () => {
  test.skip(!ENABLED, "set BL030_CAPTURE=1 to write the phase evidence set");
  test.setTimeout(15 * 60 * 1000);

  test("captures both rebuilt surfaces, an untouched route, and the scroll sweep", async ({
    browser,
    baseURL,
  }) => {
    const base = baseURL!;
    mkdirSync(OUT_DIR, { recursive: true });
    const metrics: unknown[] = [];
    const sweep: unknown[] = [];
    const failures: string[] = [];

    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        for (const viewport of VIEWPORTS) {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 2,
          });
          await prepare(context, base, surface.user, theme);
          const page = await context.newPage();
          const consoleErrors: string[] = [];
          const pageErrors: string[] = [];
          page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
          });
          page.on("pageerror", (error) => pageErrors.push(String(error)));

          await page.goto(`${base}${surface.url}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(400);
          const measured = await measure(page);
          const file = path.join(
            OUT_DIR,
            `${PREFIX}-${surface.name}-${viewport.name}-${theme}.png`,
          );
          await page.screenshot({ path: file, fullPage: true });

          metrics.push({
            surface: surface.name,
            url: surface.url,
            user: surface.user,
            viewport: viewport.name,
            theme,
            resolvedTheme: measured.theme,
            docHeight: measured.docHeight,
            horizontalOverflow: measured.overflow,
            greenMarks: measured.greenMarks,
            ruleWeights: measured.ruleWeights,
            consoleErrors,
            pageErrors,
            screenshot: path.basename(file),
          });
          if (consoleErrors.length || pageErrors.length) {
            failures.push(`${surface.name} ${viewport.name} ${theme}: console/page errors`);
          }
          if (measured.overflow > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: horizontal overflow ${measured.overflow}`,
            );
          }
          await context.close();
        }
      }
    }

    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await prepare(context, base, surface.user, theme);
        const page = await context.newPage();
        for (const width of SWEEP_WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${base}${surface.url}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(120);
          const overflow = await page.evaluate(() =>
            Math.max(
              0,
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
            ),
          );
          sweep.push({ surface: surface.name, theme, width, horizontalOverflow: overflow });
          if (overflow > 1) {
            failures.push(`sweep ${surface.name} ${theme} @${width}: overflow ${overflow}`);
          }
        }
        await context.close();
      }
    }

    writeFileSync(
      path.join(OUT_DIR, `${PREFIX}-metrics.json`),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), metrics, sweep }, null, 2)}\n`,
    );

    expect(failures, "zero console errors and zero horizontal scroll 320-2560").toEqual([]);
  });
});
