#!/usr/bin/env node
/**
 * CSS surface classification for the marketing/app stylesheet split (issue #2967).
 *
 * `app/app.css` was a single 386 KB (source) stylesheet imported by `app/root.tsx`,
 * so every page — marketing landing, dashboard, auth, share — downloaded the same
 * ~256 KB (minified) root stylesheet. This module is the shared brain for:
 *
 *   1. `scripts/split-marketing-css.mjs` — the one-time partitioner that moved
 *      marketing-only rules into `app/styles/marketing.css`.
 *   2. `tests/css-surface-split.test.ts` — the durable gate asserting the split
 *      stays correct as new CSS and new routes land.
 *
 * Classification model (conservative by design):
 *   - Build the import graph from each route group (app.* routes = "app",
 *     everything else = "marketing") and collect the className literals each
 *     group can emit at SSR.
 *   - A CSS rule is `marketing` only when every class it selects is used by the
 *     marketing group and by none of the app group. Anything shared, unknown
 *     (dynamically built class names), or later-overridden by a retained root
 *     rule stays in `app.css` — a wrong move there breaks cascade order on
 *     surfaces with no visual test coverage, so the split only takes what is
 *     provably safe.
 *
 * Zero dependencies; run under node >= 20.
 */

import fs from "node:fs";
import path from "node:path";

const APP_DIR_DEFAULT = "app";

/** Resolve a TS/TSX import specifier to a file inside the app directory. */
function resolveImport(appRoot, fromFile, spec) {
  let base;
  if (spec.startsWith("~/")) base = path.join(appRoot, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|\n)\s*(?:import|export)\s*["']([^"']+)["']|(?:^|\n)\s*import\s*\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(file) {
  const src = fs.readFileSync(file, "utf8");
  const out = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    const r = resolveImport(path.dirname(file), file, spec);
    if (r) out.push(r);
  }
  return out;
}

/** Route files of one group, transitively closed over in-app imports. */
export function reachableFiles(appRoot, startFiles) {
  const seen = new Set();
  const queue = [...startFiles];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (f.endsWith(".css")) continue;
    for (const dep of importsOf(f)) queue.push(dep);
  }
  return seen;
}

/**
 * className literals a set of files can emit: className="…", className={'…'},
 * className={`…`}, ternary/conditional strings inside className={…}, and the
 * string arguments of cn()/clsx()/cx()/classNames() helpers.
 */
export function classNamesInSource(src) {
  const out = new Set();
  const push = (s) => {
    for (const t of s.split(/\s+/)) if (t) out.add(t);
  };
  let m;
  const lit = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;
  while ((m = lit.exec(src))) push(m[1] ?? m[2] ?? m[3] ?? "");
  const braceRe = /className\s*=\s*\{([^}]*)\}/g;
  while ((m = braceRe.exec(src))) {
    for (const s of m[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
      for (const t of s[1].split(/\s+/)) if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(t)) out.add(t);
    }
  }
  const cnRe = /\b(?:cn|clsx|cx|classNames)\s*\(([^();]*)\)/g;
  while ((m = cnRe.exec(src))) {
    for (const s of m[1].matchAll(/["'`]([^"'`]*)["'`]/g)) push(s[1]);
  }
  return out;
}

/** Top-level CSS blocks: one entry per rule or @media/@keyframes container. */
export function* cssRuleBlocks(src) {
  let depth = 0;
  let bufStart = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        yield { start: bufStart, end: i + 1 };
        bufStart = i + 1;
      }
    }
  }
  if (bufStart < src.length) yield { start: bufStart, end: src.length };
}

const CLASS_IN_SELECTOR_RE = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
const KEYFRAMES_NAME_RE = /@keyframes\s+([a-zA-Z0-9_-]+)/;
const ANIMATION_RE = /animation(?:-name)?\s*:\s*([^;}]+)/g;

/** Parse css into classified rule records (see module docstring). */
export function parseCssRules(css, usedBy) {
  const rules = [];
  for (const blk of cssRuleBlocks(css)) {
    const text = css.slice(blk.start, blk.end);
    const kf = KEYFRAMES_NAME_RE.exec(text);
    if (kf && text.trimStart().startsWith("@keyframes")) {
      rules.push({ start: blk.start, end: blk.end, text, keyframes: kf[1], classes: [], anims: [] });
      continue;
    }
    const selIdx = text.indexOf("{");
    const selector = selIdx === -1 ? text : text.slice(0, selIdx);
    const classes = new Set();
    CLASS_IN_SELECTOR_RE.lastIndex = 0;
    let cm;
    while ((cm = CLASS_IN_SELECTOR_RE.exec(selector))) classes.add(cm[1]);
    const anims = [];
    ANIMATION_RE.lastIndex = 0;
    let am;
    while ((am = ANIMATION_RE.exec(text))) {
      const tokens = am[1].trim().split(/\s+/).filter((t) => /^[a-zA-Z]/.test(t));
      if (tokens.length) anims.push(tokens[tokens.length - 1]);
    }
    rules.push({ start: blk.start, end: blk.end, text, keyframes: null, classes: [...classes], anims });
  }
  // Conservative per-rule classification: a rule moves only when ALL its
  // classes are marketing-used and none app-used. `unknown` (no group uses a
  // class — dynamic class construction, markdown-rendered markup) stays.
  for (const r of rules) {
    if (r.keyframes) continue;
    if (!r.classes.length) {
      r.group = "shared"; // element selectors, :root tokens, @font-face …
      continue;
    }
    const inApp = r.classes.some((c) => usedBy.app.has(c));
    const inMkt = r.classes.some((c) => usedBy.marketing.has(c));
    if (inApp && inMkt) r.group = "shared";
    else if (inApp) r.group = "app";
    else if (inMkt) r.group = "marketing";
    else r.group = "unknown";
  }
  // @keyframes follow their referencing rules: move only when every rule that
  // animates them is itself moving to marketing.css.
  const kfRefs = new Map();
  for (const r of rules) {
    for (const a of r.anims) {
      if (!kfRefs.has(a)) kfRefs.set(a, new Set());
      kfRefs.get(a).add(r.group);
    }
  }
  for (const r of rules) {
    if (!r.keyframes) continue;
    const refs = kfRefs.get(r.keyframes);
    r.group = refs && refs.size === 1 && refs.has("marketing") ? "marketing" : "shared";
  }
  // Cascade safety: a marketing rule that a retained root rule could override
  // (any class overlap, appearing later in the original file) stays in root.
  // Moving it would invert the cascade on marketing pages, where the moved
  // block now lands after every root rule.
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.group !== "marketing" || !r.classes.length) continue;
    for (let j = i + 1; j < rules.length; j++) {
      if (rules[j].group === "marketing") continue;
      if (rules[j].classes.some((c) => r.classes.includes(c))) {
        r.group = "shared"; // cascade-risky: keep in root
        break;
      }
    }
  }
  return rules;
}

/** Group reachability + className usage for the repo's two route groups. */
export function classifySurfaces(rootDir, appDirName = APP_DIR_DEFAULT) {
  const appRoot = path.join(rootDir, appDirName);
  const routesDir = path.join(appRoot, "routes");
  const routeFiles = fs
    .readdirSync(routesDir)
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => path.join(routesDir, f));
  // `app-layout.tsx` is the workspace shell's layout route — app group despite
  // not carrying the `app.` prefix. Top-level `app.*` routes are the rest of
  // the authed product; everything else (marketing landing, public content,
  // share, auth documents) is the marketing group.
  const isAppRoute = (f) => {
    const b = path.basename(f);
    return b.startsWith("app.") || b === "app-layout.tsx";
  };
  const groups = {
    app: reachableFiles(appRoot, routeFiles.filter((f) => isAppRoute(f))),
    marketing: reachableFiles(appRoot, routeFiles.filter((f) => !isAppRoute(f))),
  };
  const usedBy = {};
  for (const [group, files] of Object.entries(groups)) {
    const used = new Set();
    for (const f of files) {
      if (!/\.(tsx|jsx)$/.test(f)) continue;
      for (const c of classNamesInSource(fs.readFileSync(f, "utf8"))) used.add(c);
    }
    usedBy[group] = used;
  }
  const cssPath = path.join(appRoot, "app.css");
  const css = fs.readFileSync(cssPath, "utf8");
  const rules = parseCssRules(css, usedBy);
  return { appRoot, groups, usedBy, css, rules, cssPath };
}

/** Which of the two css files each route module loads (root css is global). */
export function routeLoadsMarketingCss(classification, routeFile) {
  // A route loads marketing.css when itself or any module in its import
  // closure imports it. The closure is exactly `reachableFiles`.
  const appRoot = classification.appRoot;
  const marker = "styles/marketing.css";
  const start = [routeFile];
  const seen = new Set();
  const queue = [...start];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (f.endsWith(".css")) continue;
    const src = fs.readFileSync(f, "utf8");
    if (src.includes(marker) && f !== routeFile) return true;
    if (f === routeFile && src.includes(marker)) return true;
    for (const dep of importsOf(f)) queue.push(dep);
  }
  void appRoot;
  return false;
}
