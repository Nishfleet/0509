import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
const root = join(__dirname, "..");

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

describe("the marker list itself is pinned (Sol wave-2)", () => {
  it("BANNED_MARKERS matches the canonical manifest — silent source edits fail", () => {
    const source = readFileSync(
      join(root, "scripts", "design-system-ratchet.mjs"),
      "utf8",
    );
    const listMatch = source.match(/BANNED_MARKERS = \[([^\]]+)\]/);
    expect(listMatch).not.toBeNull();
    const markers = [...(listMatch?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    // The canonical manifest. Changing the banned list is a reviewed act:
    // update BOTH places deliberately or this fails.
    expect(markers).toEqual([
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
    ]);
    // The scan scope is part of the contract too.
    expect(source).toContain('const SCAN_DIRS = ["app"]');
  });

  it("--update obeys both laws: tightens on decrease, refuses to raise", () => {
    const dir = mkdtempSync(join(tmpdir(), "ratchet-update-"));
    const file = join(dir, "ceilings.json");
    const realCeilings = JSON.parse(
      readFileSync(join(root, "docs", "design-system-ratchet.json"), "utf8"),
    ) as Record<string, number>;
    const inflated = Object.fromEntries(
      Object.entries(realCeilings).map(([key, value]) => [key, (value as number) + 5]),
    );
    writeFileSync(file, JSON.stringify(inflated));
    const tighten = spawnSync(
      process.execPath,
      [join(root, "scripts", "design-system-ratchet.mjs"), "--update", `--ceilings=${file}`],
      { encoding: "utf8" },
    );
    expect(tighten.status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(realCeilings);

    // The refuse-to-raise law needs a ceiling BELOW reality; with the
    // program at zero, synthesize one by setting a ceiling to -1 (below
    // any possible count).
    const deflated = { ...realCeilings, [Object.keys(realCeilings)[0]]: -1 };
    writeFileSync(file, JSON.stringify(deflated));
    const refuse = spawnSync(
      process.execPath,
      [join(root, "scripts", "design-system-ratchet.mjs"), "--update", `--ceilings=${file}`],
      { encoding: "utf8" },
    );
    expect(refuse.status).toBe(2);
    const kept = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
    expect(kept[Object.keys(realCeilings)[0]]).toBe(-1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("P10-A colour / font / radius extension", () => {
  const root = join(__dirname, "..");
  const script = join(root, "scripts", "design-system-ratchet.mjs");
  const fixtureDir = join(root, "app", "__ratchet_fixture_p10a__");

  afterEach(() => {
    if (existsSync(fixtureDir)) {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("passes at the seeded counts for raw hex / gradient / radius / font / !important", () => {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Ratchet clean");
  });

  it("fails when a new raw hex literal is added to app/", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      join(fixtureDir, "tmp.css"),
      ".ratchet-fixture-tmp { color: #deadbe; }\n",
    );

    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/raw-hex-outside-token-block/);
    // Today's seeded ceiling is 374; a new literal nudges it to 375.
    expect(result.stderr).toMatch(/count 375 !== ceiling 374/);
  });

  it("fails when a new gradient is added to app/", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      join(fixtureDir, "tmp.css"),
      ".ratchet-fixture-tmp { background: linear-gradient(red, blue); }\n",
    );

    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/gradient: count 23 !== ceiling 22/);
  });

  it("fails when a non-token font-family is added to app/", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      join(fixtureDir, "tmp.css"),
      ".ratchet-fixture-tmp { font-family: 'Comic Sans MS'; }\n",
    );

    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/font-family-non-token: count 1 !== ceiling 0/);
  });

  it("fails when a non-zero border-radius is added to app/", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      join(fixtureDir, "tmp.css"),
      ".ratchet-fixture-tmp { border-radius: 7px; }\n",
    );

    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/border-radius-nonzero: count 116 !== ceiling 115/);
  });

  it("fails when a new !important is added to app/", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      join(fixtureDir, "tmp.css"),
      ".ratchet-fixture-tmp { color: red !important; }\n",
    );

    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/important: count 27 !== ceiling 26/);
  });

  it("re-adds the new BANNED_MARKERS-and-PATTERN_MARKERS manifest, with no exemption by omission", () => {
    const source = readFileSync(
      join(root, "scripts", "design-system-ratchet.mjs"),
      "utf8",
    );
    // Legacy markers
    const bannedMatch = source.match(/BANNED_MARKERS = \[([^\]]+)\]/);
    expect(bannedMatch).not.toBeNull();
    const banned = [...(bannedMatch?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(banned).toEqual([
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
    ]);
    // Pattern markers
    expect(source).toContain('"raw-hex-outside-token-block"');
    expect(source).toContain('"gradient"');
    expect(source).toContain('"border-radius-nonzero"');
    expect(source).toContain('"font-family-non-token"');
    expect(source).toContain('"important"');
  });
});
