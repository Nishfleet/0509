// Render the three BET 9 hero directions at both termination viewports
// (1440px desktop and 390px mobile) and screenshot them — 6 PNGs total,
// per issue #1488 accept #4. Run: node docs/design/hero-directions/shoot.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = __dirname;

const pages = [
  { html: "01-safe.html", stem: "01-safe" },
  { html: "02-bold.html", stem: "02-bold" },
  { html: "03-weird-but-plausible.html", stem: "03-weird-but-plausible" },
];

// BET 9 termination viewports — desktop first viewport and mobile first
// viewport (matches scripts/bet9-first-viewport-verification.mjs VIEWPORTS).
const viewports = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
];

let failed = false;
const browser = await chromium.launch();
try {
  for (const { html, stem } of pages) {
    for (const { name, width, height } of viewports) {
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });
      const consoleErrors = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text());
      });
      const url = "file://" + path.join(dir, html);
      const res = await page.goto(url, { waitUntil: "networkidle" });
      if (!res || !res.ok()) {
        console.error(`FAIL load ${html} @ ${name}: status ${res ? res.status() : "null"}`);
        failed = true;
        await page.close();
        continue;
      }
      // Wait for the webfonts to settle so the Bricolage 800 wall renders,
      // not a fallback.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);

      const out = path.join(dir, `${stem}-${name}.png`);
      await page.screenshot({ path: out, fullPage: false });
      const dims = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth,
        h: document.documentElement.scrollHeight,
        cw: document.documentElement.clientWidth,
      }));
      const overflow = dims.w - dims.cw;
      console.log(
        `OK  ${stem}-${name}.png  viewport=${width}x${height} doc=${dims.w}x${dims.h} overflow=${overflow} consoleErrors=${consoleErrors.length}`,
      );
      if (consoleErrors.length) {
        for (const e of consoleErrors) console.log(`     console: ${e}`);
        failed = true;
      }
      if (overflow > 0) {
        console.log(`     horizontal overflow: scrollWidth=${dims.w} clientWidth=${dims.cw}`);
        failed = true;
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);
