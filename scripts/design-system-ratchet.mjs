#!/usr/bin/env node
/**
 * Design-system ratchet (tri-audit F1, landed early by plan-review consensus).
 *
 * Counts occurrences of banned legacy design-system markers across app/ and
 * compares them against the frozen ceilings in
 * docs/design-system-ratchet.json. Any INCREASE fails. When a sweep lowers a
 * count, run with --update to tighten the ceiling to the new reality — the
 * ceiling only ever goes down. The program is done when every ceiling is 0,
 * and after that this gate makes a fourth design era structurally
 * impossible to ship.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ceilingArg = process.argv.find((arg) => arg.startsWith("--ceilings="));
// --ceilings=PATH exists ONLY so the test suite can prove tampered ceiling
// files fail; CI always runs against the checked-in file.
const CEILING_PATH = ceilingArg
  ? ceilingArg.slice("--ceilings=".length)
  : join(ROOT, "docs", "design-system-ratchet.json");

// Every marker of a retired design era or a per-package namespace. The v4
// system (`f9-wk-*`) and true page-scoped semantics are not listed — they
// are the destination, not debt.
export const BANNED_MARKERS = [
  "f9-ed-",
  "f9-app-",
  "f9-work-",
  "f9-dashboard-grid",
  "f9-muted-copy",
  "f9-secondary-button",
  "f9-primary-button",
  "f9-text-link",
  "f9-message",
  "f9-bl0",
  "f9-pr-",
  "f9-nt-",
  "f9-col-",
  "f9-clients-",
  "f9-search-page",
  "DashboardPageHeader",
  "EmptyState",
  "style={",
];

const SCAN_DIRS = ["app"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
// The ratchet measures product surfaces. Staff-only ops (outside the
// customer design system per G4) still counts — its debt must trend to
// zero too, it just isn't customer-facing.

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      yield* walk(full);
    } else if (SCAN_EXTENSIONS.has(full.slice(full.lastIndexOf(".")))) {
      yield full;
    }
  }
}

export function countMarkers() {
  const counts = Object.fromEntries(BANNED_MARKERS.map((marker) => [marker, 0]));
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const source = readFileSync(file, "utf8");
      for (const marker of BANNED_MARKERS) {
        let index = source.indexOf(marker);
        while (index !== -1) {
          counts[marker] += 1;
          index = source.indexOf(marker, index + marker.length);
        }
      }
    }
  }
  return counts;
}

export function readCeilings() {
  return JSON.parse(readFileSync(CEILING_PATH, "utf8"));
}

const invokedDirectly = process.argv[1]?.endsWith("design-system-ratchet.mjs");
if (invokedDirectly) {
  const counts = countMarkers();
  if (process.argv.includes("--update")) {
    const previous = (() => {
      try {
        return readCeilings();
      } catch {
        return {};
      }
    })();
    const next = {};
    let raised = [];
    for (const marker of BANNED_MARKERS) {
      const prior = previous[marker];
      next[marker] = prior === undefined ? counts[marker] : Math.min(prior, counts[marker]);
      if (prior !== undefined && counts[marker] > prior) raised.push(marker);
    }
    writeFileSync(CEILING_PATH, `${JSON.stringify(next, null, 2)}\n`);
    if (raised.length > 0) {
      console.error(
        `--update tightens; it never raises. Over-ceiling markers kept at their old ceiling: ${raised.join(", ")}`,
      );
      process.exit(2);
    }
    console.log(`Ceilings written to ${relative(ROOT, CEILING_PATH)}`);
    process.exit(0);
  }

  const ceilings = readCeilings();
  const violations = [];
  const ceilingKeys = Object.keys(ceilings).sort();
  const markerKeys = [...BANNED_MARKERS].sort();
  if (JSON.stringify(ceilingKeys) !== JSON.stringify(markerKeys)) {
    violations.push(
      `ceiling keys and BANNED_MARKERS disagree — a marker cannot be exempted by deleting its key`,
    );
  }
  for (const marker of BANNED_MARKERS) {
    const ceiling = ceilings[marker] ?? 0;
    // Exact match: an increase is new debt; a decrease without --update is a
    // silent slack refill waiting to happen; a hand-raised ceiling fails
    // because the count no longer equals it.
    if (counts[marker] !== ceiling) {
      violations.push(`${marker}: count ${counts[marker]} !== ceiling ${ceiling} (run --update in this PR)`);
    }
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (violations.length > 0) {
    console.error("Design-system ratchet violations (new legacy debt):");
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
  }
  console.log(`Ratchet clean. Remaining legacy markers: ${total}.`);
}
