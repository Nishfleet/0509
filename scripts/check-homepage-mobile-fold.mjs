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

// The fold failure used to be a 10-line data-driven Nykaa wall in the H1.
// #1173 moved that proof into a strip under a buyer-naming H1. Local D1
// often has no proof brief, so the empty strip is too short to prove the
// budget. Replay a live-sized strip when that happens.
const liveWall = await page.evaluate(() => {
  const h1 = document.querySelector(".ld-wall");
  if (!h1) return "missing-h1";
  const text = (h1.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!/growth teams/i.test(text)) return "unexpected-h1";
  const strip = document.querySelector(".ld-proof-strip");
  if (strip && /saved the proof/i.test(strip.textContent ?? "")) return "live-strip";
  const injected = document.createElement("aside");
  injected.className = "ld-proof-strip";
  injected.setAttribute("aria-label", "Live proof brief");
  injected.innerHTML =
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
  const empty = document.querySelector(".ld-proof-strip");
  if (empty) empty.replaceWith(injected);
  else h1.insertAdjacentElement("afterend", injected);
  return "injected-strip";
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
