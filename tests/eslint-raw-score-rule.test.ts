import { describe, expect, it } from "vitest";

import { lintTextAt } from "./eslint-lint-text";

const MESSAGE = "prints binary floating point to people";

const PROBE = "app/lib/cadence.ts";

const flagged = {
  "String(points)": `export const shown = (points: number): string => String(points);\n`,
  "String(move.weight)": `export const shown = (move: { weight: number }): string => String(move.weight);\n`,
  "String(a * b)": `export const shown = (a: number, b: number): string => String(a * b);\n`,
  "score.toString()": `export const shown = (score: number): string => score.toString();\n`,
  "line.multiplier.toString()": `export const shown = (line: { multiplier: number }): string => line.multiplier.toString();\n`,
};

const allowed = {
  "String(count)": `export const shown = (count: number): string => String(count);\n`,
  "String(a / b)": `export const shown = (a: number, b: number): string => String(a / b);\n`,
  "formatScore(points)": `import { formatScore } from "./score-format";\nexport const shown = (points: number): string => formatScore(points);\n`,
};

describe("eslint raw score String() rule (docs/incidents/2026-10-06-raw-float-in-biggest-move.md)", () => {
  it.each(Object.entries(flagged))("rejects %s under app/", { timeout: 60_000 }, async (_, code) => {
    const result = await lintTextAt(PROBE, code);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(true);
  });

  it.each(Object.entries(allowed))("allows %s", { timeout: 60_000 }, async (_, code) => {
    const result = await lintTextAt(PROBE, code);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(false);
  });
});
