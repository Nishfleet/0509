/**
 * Visual defect audit — multi-page, multi-viewport, multi-browser.
 * Captures full-page screenshots and mechanical defect detection.
 *
 * Targets production URL (https://0509.io) by default.
 * Does NOT exercise signed-in app routes — those need a session and we don't
 * have live credentials. Public surfaces only.
 */

import { chromium, firefox, devices } from "@playwright/test";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "var", "visual-audit");
const PRODUCTION_URL = process.env.E2E_PROD_BASE_URL ?? "https://0509.io";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

// Routes to audit. These are the public routes from app/routes.ts.
const ROUTES = [
  { path: "/", name: "landing" },
  { path: "/pricing", name: "pricing" },
  { path: "/search", name: "search" },
  { path: "/help", name: "help" },
  { path: "/docs", name: "docs" },
  { path: "/changelog", name: "changelog" },
  { path: "/trust", name: "trust" },
  { path: "/status", name: "status" },
  { path: "/privacy", name: "privacy" },
  { path: "/terms", name: "terms" },
  { path: "/competitor-monitoring", name: "competitor-monitoring" },
  { path: "/ads/nike.com", name: "ads-page" },
  { path: "/compare/magicbrief", name: "compare-magicbrief" },
  { path: "/compare/meta-ad-library", name: "compare-meta-ad-library" },
  { path: "/compare/visualping", name: "compare-visualping" },
  { path: "/compare/spyland", name: "compare-spyland" },
  { path: "/compare/pulzifi", name: "compare-pulzifi" },
  { path: "/compare/foreplay", name: "compare-foreplay" },
  { path: "/auth/login", name: "auth-login" },
  { path: "/auth/signup", name: "auth-signup" },
  { path: "/auth/forgot-password", name: "auth-forgot" },
  { path: "/auth/reset-password", name: "auth-reset" },
  // App routes — known to redirect to login without a session.
  { path: "/app", name: "app-root", expectRedirect: true },
  { path: "/app/collections", name: "app-collections", expectRedirect: true },
  { path: "/app/watchlists", name: "app-watchlists", expectRedirect: true },
  { path: "/app/sources", name: "app-sources", expectRedirect: true },
  { path: "/app/billing", name: "app-billing", expectRedirect: true },
  { path: "/app/settings", name: "app-settings", expectRedirect: true },
];

mkdirSync(OUT_DIR, { recursive: true });

function log(...args) {
  console.log(`[audit ${new Date().toISOString()}]`, ...args);
}

async function captureConsole(page) {
  const errors = [];
  const warnings = [];
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error") errors.push({ text: msg.text(), location: msg.location() });
    if (type === "warning") warnings.push({ text: msg.text() });
  });
  page.on("pageerror", (err) => {
    errors.push({ text: `[pageerror] ${err.message}`, stack: err.stack });
  });
  return { errors, warnings };
}

async function captureNetwork(page) {
  const failed = [];
  page.on("requestfailed", (req) => {
    failed.push({ url: req.url(), failure: req.failure()?.errorText });
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      failed.push({ url: res.url(), status: res.status() });
    }
  });
  return failed;
}

async function detectOverflow(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const overflow = Math.max(0, document.documentElement.scrollWidth - vw);
    // Find offending elements
    const offenders = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0) {
        const path = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "");
        offenders.push({ tag: path, right: Math.round(r.right), width: Math.round(r.width) });
      }
    });
    // Reduce: keep first 8 unique tags
    const seen = new Set();
    const unique = [];
    for (const o of offenders) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      unique.push(o);
      if (unique.length >= 8) break;
    }
    return { overflow, offenders: unique, viewportWidth: vw, documentWidth: document.documentElement.scrollWidth };
  });
}

async function detectOverlap(page) {
  // Find pairs of (input, button) where button bounding box intersects input.
  return page.evaluate(() => {
    function rect(el) {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
    }
    function intersect(a, b) {
      return !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
    }
    function overlapArea(a, b) {
      const x = Math.max(a.x, b.x);
      const y = Math.max(a.y, b.y);
      const right = Math.min(a.right, b.right);
      const bottom = Math.min(a.bottom, b.bottom);
      if (right <= x || bottom <= y) return 0;
      return (right - x) * (bottom - y);
    }
    function visible(el) {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
    }
    function labelFor(el) {
      const label = el.getAttribute("aria-label") || el.getAttribute("name") || el.getAttribute("placeholder") || el.textContent?.trim();
      return (label || el.tagName.toLowerCase()).slice(0, 80);
    }

    const inputs = Array.from(document.querySelectorAll("input,textarea,select,[role='textbox'],[role='combobox']")).filter(visible);
    const buttons = Array.from(document.querySelectorAll("button,a[href],[role='button'],input[type='submit'],input[type='button']")).filter(visible);

    const findings = [];
    for (const input of inputs) {
      const ir = rect(input);
      for (const btn of buttons) {
        if (input.contains(btn) || btn.contains(input)) continue;
        const br = rect(btn);
        if (!intersect(ir, br)) continue;
        const area = overlapArea(ir, br);
        // Only flag if overlap is significant relative to input (e.g. >5% of input area).
        const inputArea = ir.w * ir.h;
        if (inputArea === 0) continue;
        if (area / inputArea < 0.05) continue;
        findings.push({
          inputLabel: labelFor(input),
          inputTag: input.tagName.toLowerCase() + (input.id ? `#${input.id}` : ""),
          inputRect: { x: Math.round(ir.x), y: Math.round(ir.y), w: Math.round(ir.w), h: Math.round(ir.h) },
          buttonLabel: labelFor(btn),
          buttonTag: btn.tagName.toLowerCase(),
          buttonRect: { x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.w), h: Math.round(br.h) },
          overlapArea: Math.round(area),
        });
      }
    }
    return findings.slice(0, 20);
  });
}

async function detectBrokenImages(page) {
  return page.evaluate(() => {
    const findings = [];
    document.querySelectorAll("img").forEach((img) => {
      if (img.complete && img.naturalWidth === 0) {
        findings.push({ src: img.src, alt: img.alt });
      }
    });
    return findings;
  });
}

async function detectInvisibleText(page) {
  // Spot-check headings and key CTAs for invisible / contrast issues.
  return page.evaluate(() => {
    function srgbToLinear(c) {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    function luminance(rgb) {
      const m = rgb.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b] = m[1].split(",").map((x) => parseFloat(x.trim()));
      if ([r, g, b].some((v) => Number.isNaN(v))) return null;
      return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
    }
    function contrastRatio(fg, bg) {
      const l1 = luminance(fg);
      const l2 = luminance(bg);
      if (l1 == null || l2 == null) return null;
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }
    function effectiveBg(el) {
      // Use elementFromPoint at the element's center to find what is actually
      // rendered behind the text. Walk up from that element looking for an
      // opaque background. This is more reliable than walking parents of `el`
      // because CSS can put `el` inside a transparent wrapper.
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      let cur = document.elementFromPoint(cx, cy);
      while (cur) {
        const s = window.getComputedStyle(cur);
        const c = s.backgroundColor;
        if (c && !c.includes("rgba(0, 0, 0, 0)") && c !== "transparent") return c;
        cur = cur.parentElement;
      }
      return "rgb(255,255,255)";
    }
    function visible(el) {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      if (r.width === 0 || r.height === 0) return false;
      if (s.display === "none" || s.visibility === "hidden") return false;
      if (parseFloat(s.opacity) === 0) return false;
      return true;
    }
    const findings = [];
    document.querySelectorAll("h1, h2, h3, button, a, p").forEach((el) => {
      if (!visible(el)) return;
      const text = (el.textContent || "").trim().slice(0, 80);
      if (!text) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      const s = window.getComputedStyle(el);
      const fg = s.color;
      const bg = effectiveBg(el);
      const ratio = contrastRatio(fg, bg);
      const fontSize = parseFloat(s.fontSize);
      // WCAG AA: 4.5 for normal, 3.0 for large (>=18.66px bold OR >=24px).
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && parseInt(s.fontWeight) >= 700);
      const threshold = isLarge ? 3.0 : 4.5;
      if (ratio != null && ratio < threshold) {
        findings.push({
          text,
          tag: el.tagName.toLowerCase(),
          fontSize,
          color: fg,
          background: bg,
          contrastRatio: Number(ratio.toFixed(2)),
          threshold,
        });
      }
    });
    return findings.slice(0, 15);
  });
}

async function detectFormIssues(page) {
  // Look for inputs with no associated label, or labels that aren't associated.
  return page.evaluate(() => {
    function visible(el) {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
    }
    const findings = [];
    document.querySelectorAll("input,textarea,select").forEach((el) => {
      if (!visible(el)) return;
      const type = el.getAttribute("type");
      if (type === "hidden" || type === "submit" || type === "button") return;
      const id = el.id;
      const name = el.getAttribute("name");
      let hasLabel = false;
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label) hasLabel = true;
      }
      if (!hasLabel) {
        const parentLabel = el.closest("label");
        if (parentLabel) hasLabel = true;
      }
      if (!hasLabel) {
        const aria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("placeholder");
        if (aria) hasLabel = true;
      }
      if (!hasLabel) {
        findings.push({
          tag: el.tagName.toLowerCase(),
          name: name || "(none)",
          type: type || "(none)",
          placeholder: el.getAttribute("placeholder"),
        });
      }
    });
    return findings.slice(0, 10);
  });
}

async function detectLayoutCollapse(page) {
  // Find sections / grids that collapse below content width at narrow viewports.
  return page.evaluate(() => {
    const findings = [];
    document.querySelectorAll("main, section, [class*='grid'], [class*='flex']").forEach((el) => {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      if (r.height < 20 && s.display !== "none") {
        findings.push({
          tag: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? `.${el.className.split(/\s+/)[0]}` : ""),
          height: Math.round(r.height),
          width: Math.round(r.width),
        });
      }
    });
    return findings.slice(0, 8);
  });
}

async function runForRoute(browser, route, viewport, results) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    userAgent:
      viewport.name === "mobile"
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : undefined,
  });
  const page = await ctx.newPage();
  const consoleState = await captureConsole(page);
  const failedRequests = await captureNetwork(page);

  const url = `${PRODUCTION_URL}${route.path}`;
  log(`visit ${url} @ ${viewport.name}`);
  let navError = null;
  let finalUrl = url;
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    finalUrl = page.url();
    if (!resp || resp.status() >= 400) {
      navError = `HTTP ${resp?.status()}`;
    }
  } catch (e) {
    navError = String(e);
  }

  // Wait briefly for hydration/JS to settle, then snapshot.
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);

  const key = `${route.name}-${viewport.name}-${results.browserName}`;
  const shotPath = resolve(OUT_DIR, `${key}.png`);
  try {
    await page.screenshot({ path: shotPath, fullPage: true });
  } catch (e) {
    log(`screenshot failed for ${key}: ${e}`);
  }

  const finding = {
    page: route.name,
    path: route.path,
    viewport: viewport.name,
    browser: results.browserName,
    finalUrl,
    navError,
    consoleErrors: consoleState.errors.slice(0, 10),
    consoleWarnings: consoleState.warnings.slice(0, 5),
    failedRequests: failedRequests.slice(0, 15),
    overflow: null,
    overlappingControls: [],
    brokenImages: [],
    invisibleText: [],
    formIssues: [],
    layoutCollapses: [],
  };

  if (!navError) {
    try { finding.overflow = await detectOverflow(page); } catch (e) { log(`overflow detect fail: ${e}`); }
    try { finding.overlappingControls = await detectOverlap(page); } catch (e) { log(`overlap detect fail: ${e}`); }
    try { finding.brokenImages = await detectBrokenImages(page); } catch (e) { log(`broken image detect fail: ${e}`); }
    try { finding.invisibleText = await detectInvisibleText(page); } catch (e) { log(`invisible text detect fail: ${e}`); }
    try { finding.formIssues = await detectFormIssues(page); } catch (e) { log(`form issue detect fail: ${e}`); }
    try { finding.layoutCollapses = await detectLayoutCollapse(page); } catch (e) { log(`layout collapse detect fail: ${e}`); }
  }

  results.pages.push(finding);
  results.screenshots.push({ key, path: shotPath });

  await ctx.close();
}

async function run(browserName, browserType) {
  log(`=== starting browser: ${browserName} ===`);
  const browser = await browserType.launch();
  const results = { browserName, pages: [], screenshots: [] };
  for (const route of ROUTES) {
    for (const vp of VIEWPORTS) {
      try {
        await runForRoute(browser, route, vp, results);
      } catch (e) {
        log(`failure on ${route.name} ${vp.name}: ${e}`);
        results.pages.push({
          page: route.name,
          path: route.path,
          viewport: vp.name,
          browser: browserName,
          fatal: String(e),
        });
      }
    }
  }
  await browser.close();
  return results;
}

const allResults = [];
allResults.push(await run("chromium", chromium));
allResults.push(await run("firefox", firefox));

writeFileSync(
  resolve(OUT_DIR, "audit-results.json"),
  JSON.stringify(allResults, null, 2),
);
log("audit complete. results written to:", resolve(OUT_DIR, "audit-results.json"));
log("screenshots:", allResults.reduce((n, r) => n + r.screenshots.length, 0));