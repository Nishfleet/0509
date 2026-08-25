#!/usr/bin/env node
/**
 * Design-system ratchet (tri-audit F1, landed early by plan-review consensus,
 * extended in packet P10-A for colour / font / radius / gradient / !important).
 *
 * Counts occurrences of banned legacy design-system markers across app/ and
 * compares them against the frozen ceilings in
 * docs/design-system-ratchet.json. Any INCREASE fails. When a sweep lowers a
 * count, run with --update to tighten the ceiling to the new reality — the
 * ceiling only ever goes down. The program is done when every ceiling is 0,
 * and after that this gate makes a fourth design era structurally
 * impossible to ship.
 *
 * Markers fall in two classes:
 *   1. BANNED_MARKERS  — literal substrings of a retired design era.
 *   2. PATTERN_MARKERS — regex-based tokens for the colour/font/radius
 *      contract (raw hex outside the :root token block, gradients,
 *      border-radius non-zero, non-token font-family, !important).
 *
 * Both classes share the same ceiling / --update / exact-match discipline.
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
  "components/empty-state",
  "style={",
];

// The :root token block in CSS files is the only place raw hex literals are
// allowed — those definitions ARE the token system. Everything else (other
// CSS, all TS/TSX) is counted.
const ROOT_TOKEN_BLOCK_RE = /:root\s*\{[\s\S]*?\}/g;
// 6-digit hex is the canonical raw colour literal. 8-digit is also caught by
// the 6-digit pattern since \b stops at word boundaries. 3-digit (#rgb) is
// intentionally excluded — too rare to be worth the noise today and easy
// to add if agents start writing them.
const RAW_HEX_RE = /#[0-9a-fA-F]{6}\b/g;
const GRADIENT_RE = /\b(?:linear|radial|conic)-gradient\s*\(/g;
const IMPORTANT_RE = /!important\b/g;
const RADIUS_RE = /border-radius\s*:\s*([^;]+);/g;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;]+);/g;

// The approved face list matches the brand spec
// (docs/design/BRAND-SHORT.md §2): Bricolage Grotesque for display,
// IBM Plex Mono for code, Inter (and the OS system stack it falls back
// through) for body. Anything else is non-token drift.
const APPROVED_FONT_FACES = new Set([
  "Bricolage Grotesque",
  "IBM Plex Mono",
  "Inter",
  "ui-monospace",
  "monospace",
  "sans-serif",
  "system-ui",
  "ui-sans-serif",
  "-apple-system",
  "BlinkMacSystemFont",
  "Segoe UI",
  "Helvetica",
  "Roboto",
  "Arial",
  "inherit",
]);

const ZERO_RADIUS_VALUES = new Set([
  "0",
  "0px",
  "0em",
  "0rem",
  "0%",
  "0deg",
  "initial",
  "inherit",
  "unset",
]);

/**
 * @typedef {{
 *   name: string,
 *   count: (text: string, isCss: boolean) => number,
 * }} PatternMarker
 */

/** @type {PatternMarker[]} */
export const PATTERN_MARKERS = [
  {
    name: "raw-hex-outside-token-block",
    count(text, isCss) {
      const scanText = isCss ? text.replace(ROOT_TOKEN_BLOCK_RE, "") : text;
      let n = 0;
      let m;
      RAW_HEX_RE.lastIndex = 0;
      while ((m = RAW_HEX_RE.exec(scanText)) !== null) n += 1;
      return n;
    },
  },
  {
    name: "gradient",
    count(text) {
      let n = 0;
      let m;
      GRADIENT_RE.lastIndex = 0;
      while ((m = GRADIENT_RE.exec(text)) !== null) n += 1;
      return n;
    },
  },
  {
    name: "border-radius-nonzero",
    count(text) {
      let n = 0;
      let m;
      RADIUS_RE.lastIndex = 0;
      while ((m = RADIUS_RE.exec(text)) !== null) {
        const raw = m[1].trim();
        const parts = raw.split(/\s+/);
        const allZero = parts.every((p) => ZERO_RADIUS_VALUES.has(p));
        if (!allZero) n += 1;
      }
      return n;
    },
  },
  {
    name: "font-family-non-token",
    count(text) {
      let n = 0;
      let m;
      FONT_FAMILY_RE.lastIndex = 0;
      while ((m = FONT_FAMILY_RE.exec(text)) !== null) {
        const raw = m[1].trim();
        // Token references are fine — they resolve through the design
        // system, so a brand sweep still reaches them.
        if (raw.includes("var(--")) continue;
        // Templated stacks defer the actual face list to a module
        // constant (see app/lib/email-template.server.ts).
        if (raw.includes("EMAIL_FONT_STACK")) continue;
        const faces = raw
          .split(",")
          .map((f) => f.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
        const primary = faces[0] ?? "";
        if (!APPROVED_FONT_FACES.has(primary)) n += 1;
      }
      return n;
    },
  },
  {
    name: "important",
    count(text) {
      let n = 0;
      let m;
      IMPORTANT_RE.lastIndex = 0;
      while ((m = IMPORTANT_RE.exec(text)) !== null) n += 1;
      return n;
    },
  },
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

function isCssPath(path) {
  return path.endsWith(".css");
}

export function countMarkers() {
  const counts = Object.fromEntries(BANNED_MARKERS.map((marker) => [marker, 0]));
  for (const marker of PATTERN_MARKERS) counts[marker.name] = 0;
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
      const isCss = isCssPath(file);
      for (const marker of PATTERN_MARKERS) {
        counts[marker.name] += marker.count(source, isCss);
      }
    }
  }
  return counts;
}

export function readCeilings() {
  return JSON.parse(readFileSync(CEILING_PATH, "utf8"));
}

const ALL_MARKER_NAMES = [
  ...BANNED_MARKERS,
  ...PATTERN_MARKERS.map((m) => m.name),
];

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
    const raised = [];
    for (const marker of ALL_MARKER_NAMES) {
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
  const markerKeys = [...ALL_MARKER_NAMES].sort();
  if (JSON.stringify(ceilingKeys) !== JSON.stringify(markerKeys)) {
    violations.push(
      `ceiling keys and marker list disagree — a marker cannot be exempted by deleting its key`,
    );
  }
  for (const marker of ALL_MARKER_NAMES) {
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