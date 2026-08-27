/**
 * Authenticated surface audit — routes × viewports × themes × paid-state
 * fixtures. Deterministic layout/contrast rules only; no model.
 *
 * Folds e2e/contrast-audit.mjs (do not fork the WCAG math). Catches the
 * class of defects that shipped to a paying account because the harness
 * never rendered the app logged-in, in dark, at a wide viewport, as a
 * paying tier:
 *   - control-row alignment (CTA floating above the field it submits)
 *   - gutter alignment (children sitting outside the section content edge)
 *   - WCAG AA label contrast
 *   - horizontal overflow
 *   - tap targets under 44×44 on touch widths
 *   - missing focus rings
 *
 * Usage: node e2e/surface-audit.mjs [--base http://127.0.0.1:4179]
 * Exit 1 if any cell fails a rule.
 */

import { chromium } from "@playwright/test";

import {
  collectContrastLabels,
  contrast,
  threshold,
} from "./contrast-audit.mjs";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

export const SURFACE_AUDIT_USERS = Object.freeze([
  "e2e-free",
  "e2e-scout",
  "e2e-starter",
  "e2e-agency",
  "e2e-expired",
]);
export const SURFACE_AUDIT_ROUTES = Object.freeze([
  "/app",
  "/app/billing",
  "/app/watchlists",
  "/app/settings",
]);
export const SURFACE_AUDIT_THEMES = Object.freeze(["light", "dark"]);
export const SURFACE_AUDIT_VIEWPORTS = Object.freeze([
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 1000 },
  { name: "2000", width: 2000, height: 1000 },
]);
export const SURFACE_AUDIT_RULES = Object.freeze([
  "contrast",
  "control-row",
  "gutter",
  "overflow",
  "tap",
  "focus",
]);

export function contrastFailuresFromLabels(labels) {
  const failures = [];
  for (const label of labels) {
    if (label.opacity < 1) continue;
    const ratio = contrast(label.color, label.background);
    if (ratio === null) continue;
    const min = threshold(label.fontSize, label.fontWeight);
    if (ratio < min) {
      failures.push({
        rule: "contrast",
        ratio: Number(ratio.toFixed(2)),
        min,
        text: label.text,
        className: label.className,
        color: label.color,
        background: label.background,
      });
    }
  }
  return failures;
}

export function controlRowFailuresFromGroups(groups) {
  const failures = [];
  for (const group of groups) {
    if (!Array.isArray(group.controls) || group.controls.length < 2) continue;
    const lefts = group.controls.map((item) => item.left).filter((value) => Number.isFinite(value));
    if (lefts.length === group.controls.length && Math.max(...lefts) - Math.min(...lefts) <= 8) {
      // One-column wrap: the field sits above the CTA, not beside it.
      continue;
    }
    const bottoms = group.controls.map((item) => item.bottom);
    const delta = Math.max(...bottoms) - Math.min(...bottoms);
    if (delta > 1) {
      failures.push({
        rule: "control-row",
        selector: group.selector,
        delta: Number(delta.toFixed(1)),
        controls: group.controls,
      });
    }
  }
  return failures;
}

export function gutterFailuresFromEdges(sections, viewportWidth = 1440) {
  if (viewportWidth <= 640) return [];
  const failures = [];
  for (const section of sections) {
    const edges = (section.edges ?? []).filter((edge) => Number.isFinite(edge.left));
    if (edges.length < 2) continue;
    const lefts = edges.map((edge) => edge.left);
    const delta = Math.max(...lefts) - Math.min(...lefts);
    if (delta > 1) {
      failures.push({
        rule: "gutter",
        selector: section.selector,
        delta: Number(delta.toFixed(1)),
        edges,
      });
    }
  }
  return failures;
}

export function overflowFailuresFromWidth(scrollWidth, innerWidth) {
  const overflow = Math.max(0, scrollWidth - innerWidth);
  return overflow > 1
    ? [{ rule: "overflow", overflow: Number(overflow.toFixed(1)) }]
    : [];
}

export function tapTargetFailuresFromRects(targets, viewportWidth) {
  if (viewportWidth > 640) return [];
  return targets
    .filter((target) => target.width < 44 || target.height < 44)
    .map((target) => ({ rule: "tap", ...target }));
}

export function focusRingFailuresFromChecks(checks) {
  return checks
    .filter((check) => !check.ok)
    .map((check) => ({ rule: "focus", text: check.text, tag: check.tag, outline: check.outline }));
}

export function collectControlRowMisalignments() {
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const groups = [];
  for (const row of document.querySelectorAll("*")) {
    const style = getComputedStyle(row);
    const display = style.display;
    const isFlex = display === "flex" || display === "inline-flex";
    const isGrid = display === "grid" || display === "inline-grid";
    if (!isFlex && !isGrid) continue;
    if (style.alignItems !== "end" && style.alignItems !== "flex-end") continue;
    if (isFlex && (style.flexDirection === "column" || style.flexDirection === "column-reverse")) continue;

    const buckets = new Map();
    for (const child of row.children) {
      if (child.tagName === "INPUT" && child.getAttribute("type") === "hidden") continue;
      if (!isVisible(child)) continue;
      const control = child.matches("a, button, input, select, textarea, [role='button']")
        ? child
        : child.querySelector("a, button, input, select, textarea, [role='button']");
      if (!control || !isVisible(control)) continue;
      if (control.tagName === "INPUT" && control.getAttribute("type") === "hidden") continue;
      const rowKey = isGrid ? getComputedStyle(child).gridRowStart : "flex";
      const list = buckets.get(rowKey) ?? [];
      list.push({
        text: (control.textContent || control.getAttribute("aria-label") || control.tagName)
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 40),
        bottom: control.getBoundingClientRect().bottom,
        left: control.getBoundingClientRect().left,
        tag: control.tagName.toLowerCase(),
      });
      buckets.set(rowKey, list);
    }
    const selector =
      typeof row.className === "string" && row.className.trim()
        ? `.${row.className.trim().split(/\s+/).join(".")}`
        : row.tagName.toLowerCase();
    for (const [gridRow, controls] of buckets) {
      groups.push({ selector, gridRow, controls });
    }
  }
  return groups;
}

export function collectGutterSections() {
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const contentLeft = (root) => {
    let left = Infinity;
    for (const el of [root, ...root.querySelectorAll("*")]) {
      if (!isVisible(el)) continue;
      const style = getComputedStyle(el);
      if (style.position === "absolute" || style.position === "fixed") continue;
      const hasText = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
      const isControl = /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.getAttribute("role") === "button";
      if (!hasText && !isControl && el !== root) continue;
      left = Math.min(left, el.getBoundingClientRect().left);
    }
    return left;
  };
  const stacked = (el) => {
    const style = getComputedStyle(el);
    if (style.display === "flex" || style.display === "inline-flex") {
      return style.flexDirection === "column" || style.flexDirection === "column-reverse";
    }
    if (style.display === "grid" || style.display === "inline-grid") {
      const starts = [...el.children]
        .filter((child) => isVisible(child) && !(child.tagName === "INPUT" && child.getAttribute("type") === "hidden"))
        .map((child) => getComputedStyle(child).gridColumnStart);
      const unique = new Set(starts);
      return unique.size <= 1 || [...unique].every((value) => value === "auto" || value === "1");
    }
    return true;
  };

  const sections = [];
  for (const section of document.querySelectorAll(
    ".f9-wk-page section, .f9-wk-page .f9-evidence-setup-card, .f9-evidence-setup-card",
  )) {
    if (!isVisible(section) || !stacked(section)) continue;
    // The live defect was a bleed section that handed the gutter to its
    // children and then forgot some of them. Ordinary `.f9-wk-sec` blocks
    // indent a kicker differently from a nested form; that is not this bug.
    const margin = getComputedStyle(section);
    const bleeds = Number.parseFloat(margin.marginLeft) < -1 || Number.parseFloat(margin.marginRight) < -1;
    if (!bleeds && !section.classList.contains("f9-evidence-setup-card")) continue;
    const edges = [...section.children]
      .filter((child) => {
        const style = getComputedStyle(child);
        if (style.position === "absolute" || style.position === "fixed") return false;
        if (child.tagName === "INPUT" && child.getAttribute("type") === "hidden") return false;
        return isVisible(child);
      })
      .map((child) => ({
        className: typeof child.className === "string" ? child.className : "",
        tag: child.tagName.toLowerCase(),
        left: contentLeft(child),
      }))
      .filter((edge) => Number.isFinite(edge.left));
    sections.push({
      selector:
        typeof section.className === "string" && section.className.trim()
          ? `.${section.className.trim().split(/\s+/).join(".")}`
          : section.tagName.toLowerCase(),
      edges,
    });
  }
  return sections;
}

export function collectHorizontalOverflow() {
  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  };
}

export function collectTapTargets() {
  const targets = [];
  for (const el of document.querySelectorAll(
    "button, [role='button'], input:not([type='hidden']), select, textarea, a.f9-evidence-cta, a.f9-wk-btn, nav a, .f9-dash-mobile-nav a, .f9-dash-mobile-nav button",
  )) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width === 0 || rect.height === 0 || style.display === "none" || style.visibility === "hidden") continue;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox" || type === "radio" || type === "file") continue;
    }
    targets.push({
      text: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40),
      width: Number(rect.width.toFixed(1)),
      height: Number(rect.height.toFixed(1)),
    });
  }
  return targets;
}

export function collectFocusRingChecks() {
  const checks = [];
  const previous = document.activeElement;
  for (const el of document.querySelectorAll(
    "a[href], button, input:not([type='hidden']), select, textarea, [role='button']",
  )) {
    const rect = el.getBoundingClientRect();
    const vis = getComputedStyle(el);
    if (rect.width === 0 || rect.height === 0 || vis.display === "none" || vis.visibility === "hidden") continue;
    if (el.disabled) continue;
    if (el.closest("details:not([open])")) continue;
    if (el.tagName === "INPUT" && el.getAttribute("type") === "file") continue;
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    el.focus({ preventScroll: true });
    const style = getComputedStyle(el);
    const focusVisible = typeof el.matches === "function" && el.matches(":focus-visible");
    // Script focus does not set :focus-visible in Chromium. Skip those so
    // we only fail a control that WAS keyboard-focused and still has no ring.
    if (!focusVisible) continue;
    const outlineOk = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
    const shadowOk = Boolean(style.boxShadow) && style.boxShadow !== "none";
    checks.push({
      text: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40),
      tag: el.tagName.toLowerCase(),
      outline: `${style.outlineStyle} ${style.outlineWidth}`,
      ok: outlineOk || shadowOk,
    });
  }
  if (previous && typeof previous.focus === "function") previous.focus({ preventScroll: true });
  else if (document.activeElement && typeof document.activeElement.blur === "function") {
    document.activeElement.blur();
  }
  return checks;
}

function parseList(value, fallback) {
  if (value == null || value === "") return [...fallback];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseViewports(value) {
  if (value == null || value === "") return SURFACE_AUDIT_VIEWPORTS.map((item) => ({ ...item }));
  return parseList(value, []).map((name) => {
    const known = SURFACE_AUDIT_VIEWPORTS.find((item) => item.name === name);
    if (!known) throw new Error(`unknown_surface_audit_viewport:${name}`);
    return { ...known };
  });
}

function parseRules(value) {
  const rules = parseList(value, SURFACE_AUDIT_RULES);
  for (const rule of rules) {
    if (!SURFACE_AUDIT_RULES.includes(rule)) throw new Error(`unknown_surface_audit_rule:${rule}`);
  }
  return rules;
}

function cellLabel(cell) {
  return `${cell.user} ${cell.theme} ${cell.viewport} ${cell.route}`;
}

export async function auditPage(page, cell, rules) {
  const failures = [];
  const pathname = new URL(page.url()).pathname;
  if (pathname.includes("/auth/login")) {
    return [{ rule: "session", ...cell, detail: "redirected to login" }];
  }

  if (rules.includes("contrast")) {
    const labels = await page.evaluate(collectContrastLabels);
    for (const failure of contrastFailuresFromLabels(labels)) failures.push({ ...cell, ...failure });
  }
  if (rules.includes("control-row")) {
    const groups = await page.evaluate(collectControlRowMisalignments);
    for (const failure of controlRowFailuresFromGroups(groups)) failures.push({ ...cell, ...failure });
  }
  if (rules.includes("gutter")) {
    const sections = await page.evaluate(collectGutterSections);
    for (const failure of gutterFailuresFromEdges(sections, cell.viewportWidth)) failures.push({ ...cell, ...failure });
  }
  if (rules.includes("overflow")) {
    const width = await page.evaluate(collectHorizontalOverflow);
    for (const failure of overflowFailuresFromWidth(width.scrollWidth, width.innerWidth)) {
      failures.push({ ...cell, ...failure });
    }
  }
  if (rules.includes("tap")) {
    const targets = await page.evaluate(collectTapTargets);
    for (const failure of tapTargetFailuresFromRects(targets, cell.viewportWidth)) {
      failures.push({ ...cell, ...failure });
    }
  }
  if (rules.includes("focus")) {
    const checks = await page.evaluate(collectFocusRingChecks);
    for (const failure of focusRingFailuresFromChecks(checks)) failures.push({ ...cell, ...failure });
  }
  return failures;
}

export async function runSurfaceAudit(options = {}) {
  const base = options.base ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:4179";
  const users = options.users ?? SURFACE_AUDIT_USERS;
  const routes = options.routes ?? SURFACE_AUDIT_ROUTES;
  const themes = options.themes ?? SURFACE_AUDIT_THEMES;
  const viewports = options.viewports ?? SURFACE_AUDIT_VIEWPORTS;
  const rules = options.rules ?? SURFACE_AUDIT_RULES;
  const browser = options.browser ?? (await chromium.launch());
  const closeBrowser = !options.browser;
  const failures = [];
  let checked = 0;

  try {
    for (const user of users) {
      for (const theme of themes) {
        for (const viewport of viewports) {
          const context = await browser.newContext({
            colorScheme: theme,
            viewport: { width: viewport.width, height: viewport.height },
          });
          await context.setExtraHTTPHeaders({ "x-0509-e2e-test-mode": "1" });
          await context.addCookies([
            { name: "f9_e2e_fixture", value: user, url: base, sameSite: "Lax" },
          ]);
          await context.addInitScript((storedTheme) => {
            try {
              localStorage.setItem("f9-theme", storedTheme);
            } catch {
              // Private mode: colorScheme still drives the boot script.
            }
          }, theme);
          const page = await context.newPage();
          for (const route of routes) {
            const cell = {
              user,
              theme,
              viewport: viewport.name,
              viewportWidth: viewport.width,
              route,
            };
            await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" });
            await page.locator("#f9-main-content, main, body").first().waitFor({ state: "visible" });
            checked += 1;
            failures.push(...(await auditPage(page, cell, rules)));
          }
          await context.close();
        }
      }
    }
  } finally {
    if (closeBrowser) await browser.close();
  }

  return { checked, failures, users, routes, themes, viewports, rules };
}

function formatFailure(failure) {
  const head = `  FAIL [${failure.rule}] ${cellLabel(failure)}`;
  if (failure.rule === "contrast") {
    return `${head} ${String(failure.ratio).padStart(5)}:1 (needs ${failure.min}) "${failure.text}" — ${failure.color} on ${failure.background}`;
  }
  if (failure.rule === "control-row") {
    return `${head} ${failure.selector} bottoms differ by ${failure.delta}px`;
  }
  if (failure.rule === "gutter") {
    return `${head} ${failure.selector} content left edges differ by ${failure.delta}px`;
  }
  if (failure.rule === "overflow") {
    return `${head} scrollWidth exceeds viewport by ${failure.overflow}px`;
  }
  if (failure.rule === "tap") {
    return `${head} "${failure.text}" is ${failure.width}×${failure.height}`;
  }
  if (failure.rule === "focus") {
    return `${head} "${failure.text}" ${failure.tag} outline ${failure.outline}`;
  }
  if (failure.rule === "session") {
    return `${head} ${failure.detail}`;
  }
  return `${head} ${JSON.stringify(failure)}`;
}

async function main() {
  const result = await runSurfaceAudit({
    base: argOf("base", process.env.E2E_BASE_URL ?? "http://127.0.0.1:4179"),
    users: parseList(argOf("users"), SURFACE_AUDIT_USERS),
    routes: parseList(argOf("routes"), SURFACE_AUDIT_ROUTES),
    themes: parseList(argOf("themes"), SURFACE_AUDIT_THEMES),
    viewports: parseViewports(argOf("viewports")),
    rules: parseRules(argOf("rules")),
  });
  const cells = result.users.length * result.themes.length * result.viewports.length * result.routes.length;
  console.log(
    `surface audit: ${result.checked} cells (${result.users.length} users × ${result.themes.length} themes × ${result.viewports.length} viewports × ${result.routes.length} routes), rules ${result.rules.join(",")}`,
  );
  for (const failure of result.failures) console.log(formatFailure(failure));
  if (result.failures.length > 0) {
    console.log(`\n${result.failures.length} failure(s) across ${cells} cells.`);
    process.exit(1);
  }
  console.log("all surface-audit cells pass.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
