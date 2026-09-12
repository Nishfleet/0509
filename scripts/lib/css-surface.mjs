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

function importsOf(appRoot, file) {
  const src = fs.readFileSync(file, "utf8");
  const out = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    const r = resolveImport(appRoot, file, spec);
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
    for (const dep of importsOf(appRoot, f)) queue.push(dep);
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
  // Only strict class-name tokens count. Template literals carry `${expr}`
  // code that must be stripped before splitting, and conditional strings like
  // `" is-on"` keep their leading space — whitespace-split handles both.
  const push = (s) => {
    const noInterp = s.replace(/\$\{[^{}]*\}/g, " ");
    for (const t of noInterp.split(/\s+/)) {
      // No trailing dash: `is-${tone}` leaves an `is-` fragment that is a
      // dynamic prefix, not a class name.
      if (/^[a-zA-Z](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/.test(t)) out.add(t);
    }
  };
  let m;
  const lit = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;
  while ((m = lit.exec(src))) push(m[1] ?? m[2] ?? m[3] ?? "");
  // className={<expr>}: brace-balance the expression so a template literal's
  // own `}` (closing `${…}`) cannot truncate it, then take the string
  // literals inside — those are the candidate class names.
  const braceStart = /className\s*=\s*\{/g;
  while ((m = braceStart.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    const expr = src.slice(start, i - 1);
    for (const sm of expr.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
      push(sm[1] ?? sm[2] ?? sm[3] ?? "");
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
  let inComment = false;
  let inStr = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === inStr && src[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (inComment) {
      // Braces inside /* … */ must not move the block boundary — a comment
      // showing `.foo { … }` otherwise severs mid-comment and strands a `*/`.
      if (c === "*" && src[i + 1] === "/") {
        inComment = false;
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      inComment = true;
      i++;
      continue;
    }
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
    // Strip comments before extracting class tokens — a comment mentioning
    // `.foo` or `file.ts` before a rule must not leak into the selector set.
    const selector = (selIdx === -1 ? text : text.slice(0, selIdx)).replace(
      /\/\*[\s\S]*?\*\//g,
      " ",
    );
    // Container at-rules (@media/@supports/@layer/@container) wrap inner
    // rules whose classes never appear in the prelude. Classify the whole
    // container by the union of its inner classes: it moves only when EVERY
    // class inside is provably marketing-only; a mixed container stays whole
    // in root (conservative — splitting one would risk cascade order).
    const isContainer = /^\s*@(media|supports|layer|container)\b/.test(selector);
    const scanText = isContainer
      ? text
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/url\([^)]*\)/g, " ")
          .replace(/"[^"]*"|'[^']*'/g, " ")
      : selector;
    const classes = new Set();
    CLASS_IN_SELECTOR_RE.lastIndex = 0;
    let cm;
    while ((cm = CLASS_IN_SELECTOR_RE.exec(scanText))) classes.add(cm[1]);
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
    // A rule moves only when EVERY class it selects is provably
    // marketing-used — a compound selector like `.ld-reveal.is-seen` where
    // `is-seen` is applied via classList (invisible to this extractor) must
    // stay in root, not be dragged to marketing.css by its visible half.
    const allMkt = r.classes.every((c) => usedBy.marketing.has(c));
    if (inApp && inMkt) r.group = "shared";
    else if (inApp) r.group = "app";
    else if (inMkt && allMkt) r.group = "marketing";
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
  // root.tsx is the document shell (Layout + ErrorBoundary) rendered on EVERY
  // surface — dashboard error pages included — but it is not a route file, so
  // without this its classes (f9-error-*, f9-container) would classify as
  // marketing-only wherever not-found.tsx also uses them, and the split would
  // strip error styling from authed surfaces.
  const shellFiles = [path.join(appRoot, "root.tsx")].filter((f) => fs.existsSync(f));
  const groups = {
    app: reachableFiles(appRoot, [...routeFiles.filter((f) => isAppRoute(f)), ...shellFiles]),
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
    for (const dep of importsOf(appRoot, f)) queue.push(dep);
  }
  return false;
}
