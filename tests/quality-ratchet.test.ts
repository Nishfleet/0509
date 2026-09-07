import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  measuredMaxFromValeJson,
  nextCeiling,
  readCeiling,
  writeCeiling,
} from "../scripts/quality-ratchet.mjs";

/**
 * The SentenceLength ratchet (issue #1728) lowers
 * `Std.Readability.SentenceLength[max]` in .vale.ini to the longest
 * sentence Vale 3.20.0 actually measures on the tree, and only ever lowers
 * it. These tests pin the monotone contract: a measurement above the
 * ceiling is a refused raise, never a silent rewrite, and the rewrite
 * touches the `[max]` line only.
 */
const root = join(__dirname, "..");
const script = join(root, "scripts", "quality-ratchet.mjs");

const SAMPLE_INI = `StylesPath = .vale/styles
Vocab = House

[*.md]
BasedOnStyles = Std, House

Std.AISlop = NO
Std.Readability.SentenceLength = error
Std.Readability.SentenceLength[max] = 176
`;

function valeReport(counts: number[]): string {
  return JSON.stringify({
    "doc.md": counts.map((n) => ({
      Check: "Std.Readability.SentenceLength",
      Severity: "error",
      Message: `Long sentence: ${n} words.`,
    })),
  });
}

let tmp: string | null = null;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

function runUpdate(ini: string, counts: number[]) {
  tmp = mkdtempSync(join(tmpdir(), "quality-ratchet-"));
  const iniPath = join(tmp, ".vale.ini");
  const jsonPath = join(tmp, "vale.json");
  writeFileSync(iniPath, ini);
  writeFileSync(jsonPath, valeReport(counts));
  const result = spawnSync(
    process.execPath,
    [script, "--update", `--ini=${iniPath}`, `--vale-json=${jsonPath}`],
    { encoding: "utf8" },
  );
  return { result, iniPath };
}

describe("quality ratchet pure functions", () => {
  it("reads the bracketed [max] parameter from .vale.ini", () => {
    expect(readCeiling(SAMPLE_INI)).toBe(176);
  });

  it("fails when the ceiling key is absent — no silent default", () => {
    expect(() => readCeiling("StylesPath = .vale\n")).toThrow(/SentenceLength\[max\]/);
  });

  it("rewrites only the [max] line", () => {
    const out = writeCeiling(SAMPLE_INI, 120);
    expect(out).toContain("Std.Readability.SentenceLength[max] = 120");
    expect(out.replace("= 120", "= 176")).toBe(SAMPLE_INI);
  });

  it("extracts the maximum word count from a Vale JSON report", () => {
    const report = JSON.parse(valeReport([42, 7, 176, 99]));
    expect(measuredMaxFromValeJson(report)).toBe(176);
  });

  it("ignores alerts from other checks", () => {
    const report = {
      "doc.md": [
        { Check: "House.AISlop", Message: "AI-slop: 'delve'. 999 words." },
      ],
    };
    expect(measuredMaxFromValeJson(report)).toBe(0);
  });

  it("never tightens below the 30-word asymptote", () => {
    expect(nextCeiling(50, 12)).toBe(30);
    expect(nextCeiling(176, 120)).toBe(120);
    expect(nextCeiling(176, 176)).toBe(176);
  });
});

describe("quality ratchet --update", () => {
  it("tightens the ceiling to the measured maximum", () => {
    const { result, iniPath } = runUpdate(SAMPLE_INI, [30, 120, 55]);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(iniPath, "utf8")).toContain(
      "Std.Readability.SentenceLength[max] = 120",
    );
  });

  it("is a no-op when the ceiling already matches reality", () => {
    const { result, iniPath } = runUpdate(SAMPLE_INI, [10, 176]);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(iniPath, "utf8")).toBe(SAMPLE_INI);
  });

  it("refuses to raise the ceiling when reality exceeds it", () => {
    const { result, iniPath } = runUpdate(SAMPLE_INI, [176, 300]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("never raises");
    expect(readFileSync(iniPath, "utf8")).toBe(SAMPLE_INI);
  });
});
