/**
 * Label-contrast audit — every theme, every listed route.
 *
 * The trap this exists for: a hardcoded background (`background: #fff`)
 * paired with a themed foreground (`color: var(--ink-soft)`). It reads fine
 * in the theme it was authored in and collapses in the other one — the
 * billing page's recommended-plan CTA shipped at 1.9:1 in dark that way, and
 * nothing in the harness measured label contrast.
 *
 * Usage: node e2e/contrast-audit.mjs [--base http://127.0.0.1:4179]
 * Exit 1 if any label is under its WCAG AA threshold.
 */

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
/**
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string | undefined}
 */
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const BASE = argOf("base", process.env.E2E_BASE_URL ?? "http://127.0.0.1:4179");
const FIXTURE = argOf("user", "e2e-starter");
const ROUTES = (argOf("routes", "/app,/app/billing,/app/watchlists,/app/settings") ?? "").split(",");
const THEMES = ["light", "dark"];

/** WCAG relative luminance from an `rgb()` / `rgba()` string. */
/**
 * @param {string} color
 * @returns {number | null}
 */
export function luminance(color) {
  const parts = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  if (parts.length < 3) return null;
  const [r, g, b] = parts.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * @param {string} fg
 * @param {string} bg
 * @returns {number | null}
 */
export function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** AA: 3.0 for large text (>=24px, or >=18.66px bold), 4.5 for the rest. */
/**
 * @param {number} fontSizePx
 * @param {string | number} fontWeight
 * @returns {number}
 */
export function threshold(fontSizePx, fontWeight) {
  const bold = Number(fontWeight) >= 700;
  if (fontSizePx >= 24 || (bold && fontSizePx >= 18.66)) return 3;
  return 4.5;
}

export const collectContrastLabels = () =>
  [...document.querySelectorAll("button, a, [role='button']")].flatMap((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return [];
    const text = (el.textContent ?? "").trim();
    if (!text) return [];
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return [];
    let bgEl = el;
    let bg = style.backgroundColor;
    while (bgEl.parentElement && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
      bgEl = bgEl.parentElement;
      bg = getComputedStyle(bgEl).backgroundColor;
    }
    return [{
      text: text.slice(0, 40).replace(/\s+/g, " "),
      className: typeof el.className === "string" ? el.className : "",
      color: style.color,
      background: bg,
      fontSize: Number.parseFloat(style.fontSize),
      fontWeight: style.fontWeight,
      opacity: Number.parseFloat(style.opacity),
    }];
  });

async function main() {
  const browser = await chromium.launch();
  const failures = [];
  let checked = 0;

  for (const theme of THEMES) {
    for (const route of ROUTES) {
      const context = await browser.newContext({
        colorScheme: /** @type {"light" | "dark"} */ (theme),
        viewport: { width: 1440, height: 1000 },
      });
      await context.setExtraHTTPHeaders({ "x-0509-e2e-test-mode": "1" });
      await context.addCookies([
        { name: "f9_e2e_fixture", value: FIXTURE ?? "e2e-starter", url: BASE, sameSite: "Lax" },
      ]);
      const page = await context.newPage();
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      for (const label of await page.evaluate(collectContrastLabels)) {
        // A disabled control is exempt from AA by design; opacity is how
        // this codebase draws that state.
        if (label.opacity < 1) continue;
        const ratio = contrast(label.color, label.background);
        if (ratio === null) continue;
        checked += 1;
        const min = threshold(label.fontSize, label.fontWeight);
        if (ratio < min) {
          failures.push({ theme, route, ratio: Number(ratio.toFixed(2)), min, ...label });
        }
      }
      await context.close();
    }
  }

  await browser.close();

  console.log(`contrast audit: ${checked} labels checked across ${THEMES.length} themes x ${ROUTES.length} routes`);
  for (const f of failures) {
    console.log(
      `  FAIL ${String(f.ratio).padStart(5)}:1 (needs ${f.min}) [${f.theme}] ${f.route} "${f.text}" — ${f.color} on ${f.background} — .${f.className.split(" ").join(".")}`,
    );
  }
  if (failures.length > 0) {
    console.log(`\n${failures.length} label(s) under WCAG AA.`);
    process.exit(1);
  }
  console.log("all labels pass WCAG AA.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
