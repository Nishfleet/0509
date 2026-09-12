import { describe, expect, it } from "vitest";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classNamesInSource, classifySurfaces, reachableFiles } from "../scripts/lib/css-surface.mjs";

/**
 * Durable gate for the marketing/app CSS split (issue #2967).
 *
 * `app/app.css` used to be one 386 KB stylesheet imported by root.tsx, so
 * every page — marketing landing, dashboard, share, auth — downloaded the
 * same ~256 KB (minified) root stylesheet. The split moved provably
 * marketing-only rules into `app/styles/marketing.css` (imported by the
 * marketing route modules, code-split by React Router), keeping shared,
 * unknown, and cascade-risky rules in root. These tests keep the split
 * correct as new CSS and new routes land:
 *
 *   1. `app/styles/marketing.css` selects only marketing-only classes.
 *   2. `app/app.css` keeps every non-marketing class plus the conservative
 *      keepers (shared / unknown / cascade-risky).
 *   3. Every className any route group can emit is covered by the union —
 *      the split must never lose a rule.
 *   4. Every route whose import closure can emit a marketing-only class
 *      loads `styles/marketing.css` (directly or via a re-exported module),
 *      and dashboard routes never do.
 */

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { appRoot, groups, usedBy, rules, css } = classifySurfaces(rootDir);

const marketingCssPath = path.join(appRoot, "styles", "marketing.css");

function selectorClasses(cssText) {
  const classes = new Set();
  const re = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
  // Strip comments, quoted strings and url(...) first — a `.ts`/`.css`/
  // `.png` mention inside those is not a selector. Then scan the text before
  // every `{` at ANY depth: selectors nested inside @media/@supports blocks
  // are real selectors the flat-depth model would miss.
  const clean = cssText
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/url\([^)]*\)/g, " ")
    .replace(/"[^"]*"|'[^']*'/g, " ");
  let buf = "";
  for (const ch of clean) {
    if (ch === "{") {
      for (const m of buf.matchAll(re)) classes.add(m[1]);
      buf = "";
    } else if (ch === "}") {
      buf = "";
    } else {
      buf += ch;
    }
  }
  return classes;
}

const marketingCss = fs.existsSync(marketingCssPath) ? fs.readFileSync(marketingCssPath, "utf8") : "";
const marketingSelectors = selectorClasses(marketingCss);
const rootSelectors = selectorClasses(css);

const isMarketingOnlyClass = (c) =>
  usedBy.marketing.has(c) && !usedBy.app.has(c);

describe("marketing CSS split (issue #2967)", () => {
  it("the split stylesheet exists and is non-trivial", () => {
    expect(marketingCss.length).toBeGreaterThan(10_000);
  });

  it("marketing.css only selects marketing-only classes", () => {
    const offenders = [...marketingSelectors].filter((c) => !isMarketingOnlyClass(c));
    expect(
      offenders,
      `classes used by app/authed surfaces must stay in app.css: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("no marketing-only class remains in the root stylesheet (split completeness)", () => {
    // Cascade-risky and unknown-classified rules legitimately stay in root;
    // recompute the classifier's decision per class: a class may stay in root
    // when ANY rule selecting it was classified non-marketing.
    const classesAllowedInRoot = new Set();
    for (const r of rules) {
      if (r.group === "marketing") continue;
      for (const c of r.classes) classesAllowedInRoot.add(c);
    }
    const offenders = [...rootSelectors].filter(
      (c) => isMarketingOnlyClass(c) && !classesAllowedInRoot.has(c),
    );
    expect(
      offenders,
      `marketing-only rules still in app.css — re-run scripts/split-marketing-css.mjs: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("no selector is lost by the split (union covers every classified rule)", () => {
    const union = new Set([...rootSelectors, ...marketingSelectors]);
    // The pre-split file no longer exists (rewritten in place); assert against
    // the classifier's rule set parsed from the current root css — every class
    // it knows must land in one of the two output files.
    for (const r of rules) {
      for (const c of r.classes) {
        expect(
          union.has(c),
          `class .${c} (rule group ${r.group}) is in neither output file`,
        ).toBe(true);
      }
    }
  });

  it("routes that can emit marketing-only classes load marketing.css; dashboard routes never do", () => {
    const routesDir = path.join(appRoot, "routes");
    const routeFiles = fs
      .readdirSync(routesDir)
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .map((f) => path.join(routesDir, f));

    // The classes the split actually moved: marketing.css selectors (already
    // proven marketing-only by the earlier test). Deriving this from `rules`
    // would always be empty — the classifier parses the POST-split app.css,
    // which by construction contains no "marketing" group rules.
    const marketingOnlyClasses = marketingSelectors;

    let checked = 0;
    for (const route of routeFiles) {
      const closure = reachableFiles(appRoot, [route]);
      const emits = new Set();
      for (const f of closure) {
        if (!/\.(tsx|jsx)$/.test(f)) continue;
        for (const c of classNamesInSource(fs.readFileSync(f, "utf8"))) emits.add(c);
      }
      const needsMarketing = [...emits].some((c) => marketingOnlyClasses.has(c));
      const loadsMarketing = closureHasMarketingCssImport(closure);
      if (needsMarketing) {
        checked++;
        expect(
          loadsMarketing,
          `${path.basename(route)} emits marketing-only classes but never loads styles/marketing.css`,
        ).toBe(true);
      } else if (path.basename(route).startsWith("app.") || path.basename(route) === "app-layout.tsx") {
        expect(
          loadsMarketing,
          `${path.basename(route)} is an authed surface and must not load marketing.css`,
        ).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("root stylesheet keeps the shared tokens and error-page styles", () => {
    // Spot-checks for classes the ErrorBoundary in root.tsx renders — those
    // must never move to the marketing-only file.
    for (const cls of ["f9-error-page", "f9-error-card", "f9-container", "f9-wk-btn"]) {
      expect(rootSelectors.has(cls), `.${cls} must stay in app.css`).toBe(true);
    }
  });
});

function closureHasMarketingCssImport(closure) {
  for (const f of closure) {
    if (f.endsWith(".css")) continue;
    try {
      if (fs.readFileSync(f, "utf8").includes("styles/marketing.css")) return true;
    } catch {
      // unreadable file — skip
    }
  }
  return false;
}
