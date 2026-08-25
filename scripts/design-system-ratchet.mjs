#!/usr/bin/env node
/**
 * Design-system ratchet (tri-audit F1, landed early by plan-review consensus).
 *
 * Counts occurrences of banned legacy design-system markers across app/, plus
 * the colour / typography / radius primitives that should come from a design
 * token (BANNED_PATTERNS, scanned over the design surfaces only), and compares
 * both against the frozen ceilings in docs/design-system-ratchet.json. Any
 * INCREASE fails. When a sweep lowers a
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

// --root=PATH exists ONLY so the test suite can point the scanner at a fixture
// tree and prove the ratchet actually fails on new debt; CI always scans the
// repo. Note it does not move CEILING_PATH — the two flags are independent.
const rootArg = process.argv.find((arg) => arg.startsWith("--root="));
const SCAN_ROOT = rootArg ? rootArg.slice("--root=".length) : ROOT;

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

const SCAN_DIRS = ["app"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
// The ratchet measures product surfaces. Staff-only ops (outside the
// customer design system per G4) still counts — its debt must trend to
// zero too, it just isn't customer-facing.

// The surfaces the design SYSTEM owns: the stylesheet plus every rendered
// component and route. `app/lib/**` is deliberately outside it — those files
// build email and PDF HTML, where CSS custom properties are not reliably
// supported (Outlook in particular), so a literal colour there is correct, not
// debt. Widening this scope later is a tightening move and always allowed; the
// counts below are seeded against exactly these paths.
export const DESIGN_SURFACE_PATHS = ["app/app.css", "app/components", "app/routes"];

function countRegex(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

/**
 * Count CSS declarations matched by `declaration` (which must capture the
 * value in group 1) whose value does not start with one of `allowedPrefixes`.
 *
 * The value is captured and inspected rather than excluded with a lookahead:
 * `prop\s*:\s*(?!var\()` looks correct and is not — the regex engine
 * backtracks `\s*` to zero width and the lookahead then passes on a leading
 * space, so `font-family: var(--f9-font)` counts as a violation. That bug
 * silently inflates every count and makes the ceiling meaningless.
 *
 * The patterns are regex literals rather than strings composed into
 * `new RegExp()`: nothing here is dynamic, so there is no reason to hand a
 * ReDoS surface to a future edit.
 */
function countNonTokenDeclaration(source, declaration, allowedPrefixes) {
  let count = 0;
  for (const match of source.matchAll(declaration)) {
    const value = match[1].trim();
    if (!allowedPrefixes.some((prefix) => value.startsWith(prefix))) {
      count += 1;
    }
  }
  return count;
}

/** `font-family: <value>`, value captured. */
const FONT_FAMILY_DECLARATION = /(?:^|[^-\w])font-family\s*:\s*([^;}\n]+)/g;
/** `border-radius` and every per-corner longhand, value captured. */
const BORDER_RADIUS_DECLARATION = /(?:^|[^-\w])border(?:-[a-z]+)*-radius\s*:\s*([^;}\n]+)/g;

/**
 * Regex-counted rules, ratcheted exactly like BANNED_MARKERS. These are the
 * colour / typography / radius primitives: every one of them is a value that
 * should come from a design token, and every occurrence is one more place a
 * theme change has to be made by hand.
 */
export const BANNED_PATTERNS = [
  {
    // #rgb / #rrggbb / #rrggbbaa written straight into a component, route or
    // the stylesheet instead of a token.
    //
    // Known floor: 19 of these are the custom-property definitions in
    // app.css's `:root` block — the token system itself has to spell its
    // colours somehow. This rule's terminal value is that floor, not 0.
    name: "raw-hex-color",
    count: (source) =>
      countRegex(
        source,
        /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g,
      ),
  },
  {
    // A font stack chosen at the call site. `inherit` is allowed: it defers to
    // whatever the system already decided, which is the point.
    name: "non-token-font-family",
    count: (source) =>
      countNonTokenDeclaration(source, FONT_FAMILY_DECLARATION, ["var(", "inherit"]),
  },
  {
    // A corner radius that is not a token — including the per-corner
    // longhands, which are the usual way one slips back in.
    name: "non-token-border-radius",
    count: (source) => countNonTokenDeclaration(source, BORDER_RADIUS_DECLARATION, ["var("]),
  },
  {
    // A gradient chosen at the call site. Gradients are the single loudest
    // way a page drifts out of the system — and per the house design rules,
    // the purple-blue gradient is the exact tell of a generated-looking
    // page. Any gradient that survives belongs in a token.
    name: "css-gradient",
    count: (source) => countRegex(source, /\b(?:linear|radial|conic)-gradient\s*\(/g),
  },
  {
    // `!important` is how a design system stops being enforceable: once one
    // rule wins by fiat, the next one has to as well. Every occurrence is a
    // specificity problem that was worked around rather than fixed.
    name: "css-important",
    count: (source) => countRegex(source, /!important\b/g),
  },
  {
    // Tailwind arbitrary values (`bg-[#0e0d0a]`, `rounded-[7px]`) route around
    // the token layer entirely. This one is seeded at zero, so it is a hard
    // ban from today: the first one to land fails CI.
    name: "tailwind-arbitrary-value",
    count: (source) =>
      countRegex(
        source,
        /\b(?:rounded|bg|text|border|ring|fill|stroke|shadow|outline|decoration|accent|from|to|via)-\[/g,
      ),
  },
];

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

function* walkPath(target) {
  const stats = statSync(target);
  if (stats.isDirectory()) {
    yield* walk(target);
  } else if (SCAN_EXTENSIONS.has(target.slice(target.lastIndexOf(".")))) {
    yield target;
  }
}

export function countMarkers() {
  const counts = Object.fromEntries(BANNED_MARKERS.map((marker) => [marker, 0]));
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(SCAN_ROOT, dir))) {
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

export function countPatterns() {
  const counts = Object.fromEntries(BANNED_PATTERNS.map((rule) => [rule.name, 0]));
  for (const target of DESIGN_SURFACE_PATHS) {
    for (const file of walkPath(join(SCAN_ROOT, target))) {
      const source = readFileSync(file, "utf8");
      for (const rule of BANNED_PATTERNS) {
        counts[rule.name] += rule.count(source);
      }
    }
  }
  return counts;
}

/** Every ratcheted key, markers and patterns alike. */
export function countAll() {
  return { ...countMarkers(), ...countPatterns() };
}

export const RATCHET_KEYS = [
  ...BANNED_MARKERS,
  ...BANNED_PATTERNS.map((rule) => rule.name),
];

export function readCeilings() {
  return JSON.parse(readFileSync(CEILING_PATH, "utf8"));
}

const invokedDirectly = process.argv[1]?.endsWith("design-system-ratchet.mjs");
if (invokedDirectly) {
  const counts = countAll();
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
    for (const key of RATCHET_KEYS) {
      const prior = previous[key];
      next[key] = prior === undefined ? counts[key] : Math.min(prior, counts[key]);
      if (prior !== undefined && counts[key] > prior) raised.push(key);
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
  const expectedKeys = [...RATCHET_KEYS].sort();
  if (JSON.stringify(ceilingKeys) !== JSON.stringify(expectedKeys)) {
    violations.push(
      `ceiling keys and BANNED_MARKERS disagree — a marker cannot be exempted by deleting its key`,
    );
  }
  for (const marker of RATCHET_KEYS) {
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
