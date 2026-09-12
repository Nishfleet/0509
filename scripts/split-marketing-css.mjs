#!/usr/bin/env node
/**
 * One-time partitioner for issue #2967: moves marketing-only rules out of
 * `app/app.css` into `app/styles/marketing.css` so the root stylesheet stops
 * shipping marketing bytes to the dashboard (and vice versa once the
 * workspace styles split lands).
 *
 * The classification is conservative — see scripts/lib/css-surface.mjs. Only
 * rules whose every class is provably marketing-only (and not cascade-risky)
 * move; everything else stays in `app.css`.
 *
 * Idempotent: re-running on an already-split tree moves nothing.
 *
 * Usage:
 *   node scripts/split-marketing-css.mjs            # perform the split
 *   node scripts/split-marketing-css.mjs --dry-run  # report only
 *   node scripts/split-marketing-css.mjs --help
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifySurfaces } from "./lib/css-surface.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv.includes("--help")) {
  console.log(`Usage: node scripts/split-marketing-css.mjs [--dry-run]

Moves marketing-only CSS rules from app/app.css to app/styles/marketing.css
(issue #2967). Conservative classification: shared, unknown, and
cascade-risky rules always stay in app.css. Idempotent.`);
  process.exit(0);
}

const dryRun = process.argv.includes("--dry-run");
const { css, rules, cssPath, appRoot } = classifySurfaces(rootDir);

const moving = rules.filter((r) => r.group === "marketing");
const staying = rules.filter((r) => r.group !== "marketing");

const movedBytes = moving.reduce((n, r) => n + (r.end - r.start), 0);
const stayedBytes = staying.reduce((n, r) => n + (r.end - r.start), 0);

if (moving.length === 0) {
  console.log("split-marketing-css: nothing to move (already split or no marketing-only rules).");
  process.exit(0);
}

// Preserve the original relative order inside each output file so cascade
// order among the moved rules (and among the kept rules) is unchanged.
const marketingCss = `/*
 * Marketing-only styles (issue #2967).
 *
 * Split out of app/app.css by scripts/split-marketing-css.mjs so the root
 * stylesheet stops shipping marketing bytes to authed surfaces. Imported by
 * the marketing route modules; React Router code-splits it per route group,
 * so dashboard pages never download it.
 *
 * Rules are classified conservatively (scripts/lib/css-surface.mjs): shared,
 * unknown, and cascade-risky rules stay in app/app.css. Keep the split in
 * step with new CSS — tests/css-surface-split.test.ts gates it.
 */

${moving.map((r) => r.text.trim()).join("\n\n")}\n`;

const appCss = `${staying.map((r) => r.text.trim()).join("\n\n")}\n`;

console.log(
  `split-marketing-css: ${moving.length} rules move (${movedBytes} source bytes), ` +
    `${staying.length} stay (${stayedBytes} source bytes).`,
);

if (dryRun) {
  console.log("dry run: no files written.");
  process.exit(0);
}

const stylesDir = path.join(appRoot, "styles");
fs.mkdirSync(stylesDir, { recursive: true });
fs.writeFileSync(path.join(stylesDir, "marketing.css"), marketingCss);
fs.writeFileSync(cssPath, appCss);
console.log(`wrote ${path.join(appRoot, "styles", "marketing.css")} and rewrote ${cssPath}`);
