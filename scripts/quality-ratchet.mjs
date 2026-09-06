#!/usr/bin/env node
/**
 * Content-quality ratchet for the Vale SentenceLength ceiling.
 *
 * `.vale.ini` carries the whole-tree sentence-length gate as
 * `Std.Readability.SentenceLength[max] = <ceiling>` at `error` level
 * (see .github/workflows/content-quality.yml). The ceiling is seeded at
 * the tree's measured maximum so the gate is green on day one, and this
 * script is the only writer that moves it afterwards: it re-measures the
 * longest sentence in the content tree with the real Vale binary and, under
 * `--update`, lowers the ceiling to the new measurement. It never raises —
 * a measurement ABOVE the current ceiling means an over-ceiling sentence
 * reached main past the PR gate; the file is left untouched and the run
 * fails loudly instead of absorbing the regression.
 *
 * Exit contract (mirrors scripts/design-system-ratchet.mjs):
 *   bare run  — verify: 0 when the measured maximum is at or below the
 *               ceiling, 1 when it exceeds it (or the measurement fails).
 *   --update  — tighten: 0 on a lower ceiling written or a no-op, 2 when
 *               the measurement would force a raise and the write is
 *               refused.
 *
 * The floor is 30, the asymptote the tracking issue sets for the content
 * tree: once the tree's longest sentence fits in 30 words the ceiling
 * stays at 30 and does not tighten further.
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const iniArg = process.argv.find((arg) => arg.startsWith("--ini="));
// --ini=PATH exists ONLY so the test suite can exercise the ceiling rewrite
// against a fixture; CI always runs against the checked-in .vale.ini.
const INI_PATH = iniArg ? iniArg.slice("--ini=".length) : join(ROOT, ".vale.ini");

// --vale-json=PATH exists ONLY so the test suite can feed a canned Vale JSON
// report instead of running the binary; CI always measures the real tree.
const valeJsonArg = process.argv.find((arg) => arg.startsWith("--vale-json="));
const VALE_JSON_PATH = valeJsonArg ? valeJsonArg.slice("--vale-json=".length) : null;

const CEILING_RE = /^Std\.Readability\.SentenceLength\[max\][ \t]*=[ \t]*(\d+)[ \t]*$/m;
const FLOOR = 30;

export function readCeiling(iniText) {
  const match = iniText.match(CEILING_RE);
  if (!match) {
    throw new Error(
      "Std.Readability.SentenceLength[max] not found in .vale.ini — the ratchet has nothing to tighten",
    );
  }
  return Number(match[1]);
}

export function writeCeiling(iniText, next) {
  return iniText.replace(CEILING_RE, `Std.Readability.SentenceLength[max] = ${next}`);
}

export function nextCeiling(current, measured) {
  return Math.max(FLOOR, Math.min(current, measured));
}

export function measuredMaxFromValeJson(report) {
  let measured = 0;
  for (const alerts of Object.values(report)) {
    if (!Array.isArray(alerts)) continue;
    for (const alert of alerts) {
      if (!alert || typeof alert.Check !== "string") continue;
      if (!alert.Check.endsWith("Readability.SentenceLength")) continue;
      const m = /(\d+) words/.exec(alert.Message ?? "");
      if (m) measured = Math.max(measured, Number(m[1]));
    }
  }
  return measured;
}

function measureTreeMax() {
  if (VALE_JSON_PATH) {
    return measuredMaxFromValeJson(JSON.parse(readFileSync(VALE_JSON_PATH, "utf8")));
  }
  // Vale resolves StylesPath relative to the config file's directory, so the
  // measuring copy has to sit next to .vale.ini rather than in a temp dir.
  // A `max` of 1 makes the rule report every multi-word sentence, and the
  // alert message carries the real word count — the largest one reported is
  // the tree's true maximum.
  const measureIni = join(ROOT, `.vale-ratchet-measure-${process.pid}.ini`);
  try {
    writeFileSync(measureIni, writeCeiling(readFileSync(INI_PATH, "utf8"), 1));
    const out = execFileSync(
      "vale",
      ["--config", measureIni, "--output=JSON", "--no-exit", "."],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
    );
    return measuredMaxFromValeJson(JSON.parse(out));
  } finally {
    try {
      unlinkSync(measureIni);
    } catch {
      /* measurement config is best-effort cleanup */
    }
  }
}

const invokedDirectly = process.argv[1]?.endsWith("quality-ratchet.mjs");
if (invokedDirectly) {
  let current;
  let measured;
  try {
    current = readCeiling(readFileSync(INI_PATH, "utf8"));
    measured = measureTreeMax();
  } catch (err) {
    console.error(`quality-ratchet: measurement failed — ${err.message}`);
    process.exit(1);
  }
  if (measured < 1) {
    console.error("quality-ratchet: Vale reported no sentences over 1 word — the measurement is broken, refusing to act on it");
    process.exit(1);
  }

  if (process.argv.includes("--update")) {
    if (measured > current) {
      console.error(
        `--update tightens; it never raises. Measured maximum ${measured} words exceeds the ceiling ${current} — the file was left untouched. Find the sentence that slipped past the gate.`,
      );
      process.exit(2);
    }
    const next = nextCeiling(current, measured);
    if (next === current) {
      console.log(`Ceiling already matches reality at ${INI_PATH} (max ${current} words, measured ${measured}).`);
      process.exit(0);
    }
    writeFileSync(INI_PATH, writeCeiling(readFileSync(INI_PATH, "utf8"), next));
    console.log(`Ceiling tightened at ${INI_PATH}: SentenceLength[max] ${current} -> ${next} (measured ${measured}).`);
    process.exit(0);
  }

  if (measured > current) {
    console.error(
      `SentenceLength: measured maximum ${measured} words exceeds ceiling ${current}`,
    );
    process.exit(1);
  }
  console.log(`SentenceLength ceiling ${current} holds; measured maximum ${measured}.`);
  process.exit(0);
}
