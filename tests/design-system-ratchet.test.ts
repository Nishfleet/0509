import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * F1 — the design-system ratchet (tri-audit; landed early by plan-review
 * consensus: "without this, same mid-flight death as eras A-C").
 *
 * `scripts/design-system-ratchet.mjs` counts every marker of a retired
 * design era across app/ and fails when any count exceeds the frozen
 * ceilings in docs/design-system-ratchet.json. Landing NEW legacy debt
 * fails CI here. Sweeps that lower a count tighten the ceiling via
 * `node scripts/design-system-ratchet.mjs --update` in the same PR — the
 * ceiling only ever goes down. The program's terminal condition includes
 * every ceiling at zero, after which a fourth design era is structurally
 * impossible to ship.
 */
describe("design-system ratchet", () => {
  const root = join(__dirname, "..");

  it("no banned legacy marker grows beyond its frozen ceiling", () => {
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "design-system-ratchet.mjs")],
      { encoding: "utf8" },
    );
    expect(result.stderr).toBe("");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("Ratchet clean");
  });

  it("every ceiling is a finite number — a marker cannot be exempted", () => {
    const ceilings = JSON.parse(
      readFileSync(join(root, "docs", "design-system-ratchet.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(ceilings).length).toBeGreaterThanOrEqual(20);
    for (const [marker, ceiling] of Object.entries(ceilings)) {
      expect(Number.isFinite(ceiling), marker).toBe(true);
    }
  });
});
