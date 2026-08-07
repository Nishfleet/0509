import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
    expect(Object.keys(ceilings).length).toBeGreaterThanOrEqual(17);
    for (const [marker, ceiling] of Object.entries(ceilings)) {
      expect(Number.isFinite(ceiling), marker).toBe(true);
    }
  });
});

describe("the ratchet cannot be gamed", () => {
  const root = join(__dirname, "..");
  const script = join(root, "scripts", "design-system-ratchet.mjs");
  const realCeilings = JSON.parse(
    readFileSync(join(root, "docs", "design-system-ratchet.json"), "utf8"),
  ) as Record<string, number>;

  function runWithCeilings(ceilings: Record<string, number>): {
    status: number | null;
    stderr: string;
  } {
    const dir = mkdtempSync(join(tmpdir(), "ratchet-"));
    const file = join(dir, "ceilings.json");
    writeFileSync(file, JSON.stringify(ceilings));
    const result = spawnSync(process.execPath, [script, `--ceilings=${file}`], {
      encoding: "utf8",
    });
    rmSync(dir, { recursive: true, force: true });
    return { status: result.status, stderr: result.stderr };
  }

  it("a hand-raised ceiling fails — exact match means every sweep must --update", () => {
    const firstKey = Object.keys(realCeilings)[0];
    const tampered = { ...realCeilings, [firstKey]: realCeilings[firstKey] + 50 };
    const result = runWithCeilings(tampered);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("!== ceiling");
  });

  it("deleting a marker's ceiling key fails — no exemption by omission", () => {
    const { [Object.keys(realCeilings)[0]]: _dropped, ...rest } = realCeilings;
    const result = runWithCeilings(rest);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("disagree");
  });

  it("the real checked-in ceilings match reality exactly", () => {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });
});
