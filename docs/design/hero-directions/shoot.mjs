// Render the three BET 9 hero directions at 1440px and screenshot them.
// Run: npx playwright test --config /dev/null is not needed; this is a
// standalone script. Invoke with: node docs/design/hero-directions/shoot.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = __dirname;

const pages = [
  { html: "01-safe.html", png: "01-safe.png" },
  { html: "02-bold.html", png: "02-bold.png" },
  { html: "03-weird-but-plausible.html", png: "03-weird-but-plausible.png" },
];

const WIDTH = 1440;
const HEIGHT = 900; // first viewport at 1440px desktop

const browser = await chromium.launch();
let failed = false;
try {
  for (const { html, png } of pages) {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    const url = "file://" + path.join(dir, html);
    const res = await page.goto(url, { waitUntil: "networkidle" });
    if (!res || !res.ok()) {
      console.error(`FAIL load ${html}: status ${res ? res.status() : "null"}`);
      failed = true;
      await page.close();
      continue;
    }
    // Wait for the webfonts to settle so the Bricolage 800 wall renders, not a fallback.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);

    // Capture any console errors as a finding.
    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });

    const out = path.join(dir, png);
    await page.screenshot({ path: out, fullPage: false });
    const dims = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight,
    }));
    console.log(`OK  ${png}  viewport=${WIDTH}x${HEIGHT} doc=${dims.w}x${dims.h} consoleErrors=${consoleErrors.length}`);
    if (consoleErrors.length) {
      for (const e of consoleErrors) console.log(`     console: ${e}`);
      failed = true;
    }
    await page.close();
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);
