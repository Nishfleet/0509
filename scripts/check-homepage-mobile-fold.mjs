import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const URL = process.env.BASE_URL ?? "http://127.0.0.1:4187/";
const WIDTH = 390;
const HEIGHT = 844;
const OUT = "/tmp/verify-0509-971";

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

// The fold failure is the data-driven Nykaa wall (~4 wrapping rows). Local
// D1 often has no proof brief, so the fallback H1 is too short to prove the
// budget. Replay the live wall markup when that happens.
const liveWall = await page.evaluate(() => {
  const h1 = document.querySelector(".ld-wall");
  if (!h1) return "missing";
  const text = (h1.textContent ?? "").replace(/\s+/g, " ").trim();
  if (/saved the proof/i.test(text) && /meta ads/i.test(text)) return "live";
  h1.innerHTML =
    '<span class="ld-row">“Unlock the secret to radiant…”</span>' +
    '<span class="ld-row">was the hook on 12 Meta ads <i class="ld-flag">Aug 25</i></span>' +
    '<span class="ld-row ld-row-indent">linking to nykaa.com.</span>' +
    '<span class="ld-row">We saved the proof.</span>';
  return "injected";
});

const metrics = await page.evaluate(() => {
  const d = document.documentElement;
  const fold = window.innerHeight;
  const input = document.querySelector(".ld-command input");
  const btn = document.querySelector(".ld-command button");
  const rect = (el) =>
    el
      ? {
          top: Math.round(el.getBoundingClientRect().top),
          bottom: Math.round(el.getBoundingClientRect().bottom),
          height: Math.round(el.getBoundingClientRect().height),
        }
      : null;
  return {
    scrollWidth: d.scrollWidth,
    clientWidth: d.clientWidth,
    overflow: d.scrollWidth - d.clientWidth,
    fold,
    h1: document.querySelector(".ld-wall")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 120) ?? null,
    input: rect(input),
    button: rect(btn),
  };
});

await page.screenshot({ path: `${OUT}/after-390.png`, fullPage: false });

await browser.close();

const inputAbove = metrics.input !== null && metrics.input.bottom <= metrics.fold;
const ctaAbove = metrics.button !== null && metrics.button.bottom <= metrics.fold;
const noOverflow = metrics.overflow <= 0;
const noConsole = consoleErrors.length === 0;
const ok = inputAbove && ctaAbove && noOverflow && noConsole;

console.log(
  JSON.stringify(
    { liveWall, metrics, consoleErrors, inputAbove, ctaAbove, noOverflow, noConsole, ok },
    null,
    2,
  ),
);

if (!ok) process.exit(1);
