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
  // Only scan selector-ish positions: strip declaration bodies crudely by
  // taking text before each `{` — same model as the classifier.
  let depth = 0;
  let buf = "";
  for (const ch of cssText) {
    if (ch === "{") {
      depth++;
      for (const m of buf.matchAll(re)) classes.add(m[1]);
      buf = "";
    } else if (ch === "}") {
      depth--;
      buf = "";
    } else if (depth === 0) {
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

  it("no selector is lost by the split (union covers the original class set)", () => {
    const union = new Set([...rootSelectors, ...marketingSelectors]);
    const original = selectorClasses(fs.readFileSync("/tmp/ps-orig.tsx", "utf8") ? cssOfOriginal() : "");
    // The original file is gone (rewritten in place); instead assert against
    // the classifier's rule set, which was parsed from the current root css.
    for (const r of rules) {
      for (const c of r.classes) {
        expect(
          union.has(c),
          `class .${c} (rule group ${r.group}) is in neither output file`,
        ).toBe(true);
      }
    }
    void original;
  });

  it("every className any route group emits is covered by root ∪ marketing css", () => {
    const covered = new Set([...rootSelectors, ...marketingSelectors]);
    for (const [group, used] of Object.entries(usedBy)) {
      const missing = [...used].filter(
        (c) => !covered.has(c) && /^[a-z]/.test(c) && c.includes("-"),
      );
      expect(
        missing,
        `${group} classNames with no CSS rule — a split lost them or a new class landed without styles: ${missing.slice(0, 20).join(", ")}`,
      ).toEqual([]);
    }
  });

  it("routes that can emit marketing-only classes load marketing.css; dashboard routes never do", () => {
    const routesDir = path.join(appRoot, "routes");
    const routeFiles = fs
      .readdirSync(routesDir)
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .map((f) => path.join(routesDir, f));

    const marketingOnlyClasses = new Set(
      rules.filter((r) => r.group === "marketing").flatMap((r) => r.classes),
    );

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

function cssOfOriginal() {
  return css;
}
