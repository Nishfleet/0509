#!/usr/bin/env node
/**
 * BL-008 live proof from the local fixture harness.
 * Usage: node scripts/bl008-proof.mjs <label> <outDir>
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const label = process.argv[2] ?? "after";
const outDir = process.argv[3] ?? "/home/nish/workspaces/products/0509-audit-artifacts-bl008";
const base = "http://127.0.0.1:4179";

mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const themes = ["light", "dark"];
const surfaces = [
  {
    user: "e2e-starter",
    path: "/app/watchlists?watchlist=e2e-watchlist-starter-1",
    slug: "change-feed-starter",
    panel: "changed",
  },
  {
    user: "e2e-starter",
    path: "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=evidence",
    slug: "evidence-tab-starter",
    panel: "evidence",
  },
];

const results = [];
const browser = await chromium.launch();

for (const vp of viewports) {
  for (const theme of themes) {
    for (const surface of surfaces) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
      });
      await context.addCookies([
        { name: "f9_e2e_fixture", value: surface.user, url: base, sameSite: "Lax" },
      ]);
      await context.route(`${base}/**`, (route) =>
        route.continue({
          headers: { ...route.request().headers(), "x-0509-e2e-test-mode": "1" },
        }),
      );
      await context.addInitScript((value) => {
        try {
          window.localStorage.setItem("f9-theme", value);
        } catch {}
      }, theme);

      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

      await page.goto(`${base}${surface.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);

      const metrics = await page.evaluate(() => {
        const overflowing = [...document.querySelectorAll("body *")]
          .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 5)
          .map((node) => `${node.tagName.toLowerCase()}.${node.className}`.slice(0, 90));
        return {
          docHeight: Math.round(document.documentElement.scrollHeight),
          scrollWidth: Math.round(document.documentElement.scrollWidth),
          innerWidth: window.innerWidth,
          theme: document.documentElement.getAttribute("data-f9-theme") ?? "light",
          diffPlates: document.querySelectorAll(".f9-evidence-diff-plate").length,
          quietLines: document.querySelectorAll(".f9-evidence-quiet-line").length,
          insightGrid: document.querySelectorAll(".f9-insight-grid").length,
          eventCards: document.querySelectorAll(".f9-event-card").length,
          glossaryCollapsed: document.querySelectorAll(".f9-evidence-report-glossary").length,
          overflowing,
        };
      });

      const file = `${outDir}/${label}-${surface.slug}-${vp.name}-${theme}.png`;
      await page.screenshot({ path: file, fullPage: true });

      results.push({
        label,
        user: surface.user,
        route: surface.path,
        panel: surface.panel,
        viewport: vp.name,
        theme: metrics.theme,
        docHeight: metrics.docHeight,
        horizontalOverflow: metrics.scrollWidth - metrics.innerWidth,
        diffPlates: metrics.diffPlates,
        quietLines: metrics.quietLines,
        insightGrid: metrics.insightGrid,
        eventCards: metrics.eventCards,
        glossaryCollapsed: metrics.glossaryCollapsed,
        consoleErrors: [...consoleErrors],
        overflowingNodes: metrics.overflowing,
        screenshot: file,
      });

      await context.close();
    }
  }
}

await browser.close();
writeFileSync(`${outDir}/${label}-metrics.json`, JSON.stringify(results, null, 2));
console.log(
  results
    .map(
      (r) =>
        `${r.viewport}/${r.theme} ${r.panel} — height ${r.docHeight}px, overflow ${r.horizontalOverflow}px, diffPlates ${r.diffPlates}, quietLines ${r.quietLines}, insightGrid ${r.insightGrid}, eventCards ${r.eventCards}, console errors ${r.consoleErrors.length}`,
    )
    .join("\n"),
);
