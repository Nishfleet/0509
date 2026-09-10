import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const appCss = readFileSync("app/app.css", "utf8");
const anchorsRules = [];
const re = /\.f9-price-anchors[^{]*\{[^}]*\}/g;
let m;
while ((m = re.exec(appCss)) !== null) anchorsRules.push(m[0]);

const html = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { --ld-green: #16c47f; --ld-ink-soft: #55524a; --ld-mono: monospace; }
.f9-container { width: min(1332px, calc(100% - 48px)); margin: 0 auto; }
@media (max-width: 760px) { .f9-container { width: min(100% - 32px, 1332px); } }
.f9-growth-pricing { position: relative; overflow: hidden; }
.f9-growth-pricing > .f9-container { position: relative; z-index: 1; }
${anchorsRules.join("\n")}
</style></head><body>
<div class="f9-growth-pricing">
  <div class="f9-container">
    <div class="f9-price-anchors ld-reveal" aria-label="Price of knowing">
      <span class="ld-kicker">Price of knowing</span>
      <h3>What a competitor watch costs across the market.</h3>
      <p class="ld-pricing-note">Entry prices as printed on each vendor&rsquo;s pricing page, with the source and the day we checked. Only the fields the source prints are listed.</p>
      <table>
        <thead><tr><th scope="col">Tool</th><th scope="col">Entry price</th><th scope="col">Tracked</th><th scope="col">Cadence</th><th scope="col">Source</th></tr></thead>
        <tbody>
          <tr><th scope="row">Five to Nine Scout</th><td>$11/mo</td><td>3 competitors</td><td>every 6h</td><td>This page</td></tr>
          <tr><th scope="row">Five to Nine Starter</th><td>$59/mo</td><td>10 competitors</td><td>every 3h</td><td>This page</td></tr>
          <tr><th scope="row">Foreplay Basic</th><td>$59/month</td><td>—</td><td>—</td><td><a href="#">Source</a> · checked 2026-09-09</td></tr>
          <tr><th scope="row">Visualping Personal 1K</th><td>$14/mo</td><td>10 pages</td><td>every 15 min</td><td><a href="#">Source</a> · checked 2026-09-09</td></tr>
          <tr><th scope="row">Panoramata Startup</th><td>€99/month (billed monthly)</td><td>up to 20 competitors</td><td>—</td><td><a href="#">Source</a> · checked 2026-09-09</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
</body></html>`;

const browser = await chromium.launch();
for (const width of [320, 375, 414, 768, 1024, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 812 } });
  await page.setContent(html);
  const result = await page.evaluate(() => {
    const nested = Array.from(document.querySelectorAll("*"))
      .map((el) => ({ el, overflow: Math.max(0, el.scrollWidth - el.clientWidth) }))
      .filter(({ el, overflow }) => {
        if (overflow <= 2) return false;
        if (el instanceof HTMLSelectElement) return false;
        const style = getComputedStyle(el);
        if (style.display === "inline" || style.display === "contents") return false;
        return !["auto", "scroll", "hidden", "clip"].includes(style.overflowX);
      })
      .map(({ el, overflow }) => ({ selector: el.tagName + (el.className ? "." + String(el.className).trim().split(/\s+/).join(".") : ""), overflow }));
    return { nested, docOverflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  console.log(width, JSON.stringify(result));
  await page.close();
}
await browser.close();
