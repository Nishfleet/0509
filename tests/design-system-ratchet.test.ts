import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

/**
 * Colour / typography / radius rules (P10-A).
 *
 * These are regex-counted rather than substring-counted, which makes them the
 * part of the ratchet most able to be wrong while looking right: a rule that
 * silently matches nothing passes CI forever and protects nothing. Every rule
 * below is therefore exercised end-to-end through the real CLI against a
 * fixture tree it MUST flag and a fixture tree it MUST NOT.
 *
 * `--root=PATH` points the scanner at the fixture; `--ceilings=PATH` supplies
 * the ceilings. Both flags exist only for this file — CI always scans the repo
 * against the checked-in ceilings.
 */
describe("colour, font and radius rules", () => {
  const script = join(root, "scripts", "design-system-ratchet.mjs");
  const source = readFileSync(script, "utf8");

  const PATTERN_RULES = [
    "raw-hex-color",
    "non-token-font-family",
    "non-token-border-radius",
    "css-gradient",
    "css-important",
    "tailwind-arbitrary-value",
  ] as const;

  const checkedInCeilings = JSON.parse(
    readFileSync(join(root, "docs", "design-system-ratchet.json"), "utf8"),
  ) as Record<string, number>;

  /** Every ratcheted key at zero, so any occurrence shows up as a violation. */
  const zeroCeilings = Object.fromEntries(
    Object.keys(checkedInCeilings).map((key) => [key, 0]),
  );

  // A minimal repo shaped like the real one: app/ exists for the marker scan,
  // and every design surface exists for the pattern scan.
  const CLEAN_TREE: Record<string, string> = {
    "app/app.css": ":root { color: var(--f9-ink); border-radius: var(--f9-radius); }\n",
    "app/components/thing.tsx": "export const Thing = () => null;\n",
    "app/routes/page.tsx": "export default function Page() { return null; }\n",
  };

  function runFixture(
    files: Record<string, string>,
    ceilings: Record<string, number> = zeroCeilings,
  ) {
    const dir = mkdtempSync(join(tmpdir(), "ratchet-fixture-"));
    try {
      for (const [relativePath, contents] of Object.entries({ ...CLEAN_TREE, ...files })) {
        const target = join(dir, relativePath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, contents);
      }
      const ceilingFile = join(dir, "ceilings.json");
      writeFileSync(ceilingFile, JSON.stringify(ceilings));
      const result = spawnSync(
        process.execPath,
        [script, `--root=${dir}`, `--ceilings=${ceilingFile}`],
        { encoding: "utf8" },
      );
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * The count the CLI actually reported for one rule, read back off the
   * violation line. With every ceiling at zero, "no line" means zero.
   */
  function ruleCount(rule: string, files: Record<string, string>): number {
    const { stderr } = runFixture(files);
    const match = stderr.match(new RegExp(`${rule}: count (\\d+) !== ceiling 0`));
    return match ? Number(match[1]) : 0;
  }

  it("is clean on a fixture with zero debt and zero ceilings", () => {
    const result = runFixture({});
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("Ratchet clean");
  });

  describe("raw-hex-color", () => {
    it("counts shorthand, full and alpha hex literals", () => {
      expect(ruleCount("raw-hex-color", { "app/app.css": "a { color: #fff; }" })).toBe(1);
      expect(ruleCount("raw-hex-color", { "app/app.css": "a { color: #0e0d0a; }" })).toBe(1);
      expect(ruleCount("raw-hex-color", { "app/app.css": "a { color: #0e0d0a80; }" })).toBe(1);
      expect(
        ruleCount("raw-hex-color", {
          "app/app.css": "a { border: 1px solid #16c47f; background: #061629; }",
        }),
      ).toBe(2);
    });

    it("does not fire on a token or on a non-hex URL fragment", () => {
      expect(ruleCount("raw-hex-color", { "app/app.css": "a { color: var(--f9-ink); }" })).toBe(0);
      expect(
        ruleCount("raw-hex-color", {
          "app/routes/page.tsx": 'export default () => <a href="#pricing">p</a>;',
        }),
      ).toBe(0);
    });
  });

  describe("non-token-font-family", () => {
    it("counts a font stack chosen at the call site", () => {
      expect(
        ruleCount("non-token-font-family", {
          "app/app.css": 'body { font-family: ui-sans-serif, "Segoe UI"; }',
        }),
      ).toBe(1);
    });

    it("does NOT count a token or `inherit`", () => {
      // The backtracking trap: `font-family\s*:\s*(?!var\()` matches this,
      // because `\s*` gives back the space and the lookahead then passes. If
      // this ever reads 1, the rule is counting its own allowlist and every
      // ceiling in the file is fiction.
      expect(
        ruleCount("non-token-font-family", { "app/app.css": "body { font-family: var(--f9-font); }" }),
      ).toBe(0);
      expect(
        ruleCount("non-token-font-family", { "app/app.css": "body { font-family:var(--f9-font); }" }),
      ).toBe(0);
      expect(
        ruleCount("non-token-font-family", { "app/app.css": "body { font-family: inherit; }" }),
      ).toBe(0);
    });
  });

  describe("non-token-border-radius", () => {
    it("counts literal radii, including the per-corner longhands", () => {
      expect(
        ruleCount("non-token-border-radius", { "app/app.css": "a { border-radius: 8px; }" }),
      ).toBe(1);
      expect(
        ruleCount("non-token-border-radius", {
          "app/app.css": "a { border-top-left-radius: 8px; }",
        }),
      ).toBe(1);
      expect(
        ruleCount("non-token-border-radius", {
          "app/app.css": "a { border-radius: 8px; border-bottom-right-radius: 2px; }",
        }),
      ).toBe(2);
    });

    it("does not fire on a token radius", () => {
      expect(
        ruleCount("non-token-border-radius", {
          "app/app.css": "a { border-radius: var(--f9-radius); }",
        }),
      ).toBe(0);
      expect(
        ruleCount("non-token-border-radius", {
          "app/app.css": "a { border-top-left-radius: var(--f9-radius); }",
        }),
      ).toBe(0);
    });
  });

  describe("css-gradient", () => {
    it("counts every gradient function", () => {
      expect(ruleCount("css-gradient", { "app/app.css": "a { background: linear-gradient(#fff, #000); }" })).toBe(1);
      expect(ruleCount("css-gradient", { "app/app.css": "a { background: radial-gradient(circle, red, blue); }" })).toBe(1);
      expect(ruleCount("css-gradient", { "app/app.css": "a { background: conic-gradient(red, blue); }" })).toBe(1);
      expect(
        ruleCount("css-gradient", {
          "app/routes/page.tsx": 'export default () => <div data-bg="linear-gradient(red, blue)" />;',
        }),
      ).toBe(1);
    });

    it("does not fire on a token background", () => {
      expect(ruleCount("css-gradient", { "app/app.css": "a { background: var(--f9-surface); }" })).toBe(0);
    });
  });

  describe("css-important", () => {
    it("counts every !important", () => {
      expect(ruleCount("css-important", { "app/app.css": "a { color: red !important; }" })).toBe(1);
      expect(
        ruleCount("css-important", {
          "app/app.css": "a { color: red !important; border: 0 !important; }",
        }),
      ).toBe(2);
    });

    it("does not fire on ordinary declarations", () => {
      expect(ruleCount("css-important", { "app/app.css": "a { color: var(--f9-ink); }" })).toBe(0);
    });
  });

  describe("tailwind-arbitrary-value", () => {
    it("counts arbitrary colour and radius utilities", () => {
      expect(
        ruleCount("tailwind-arbitrary-value", {
          "app/routes/page.tsx": 'export default () => <div className="bg-[#0e0d0a]" />;',
        }),
      ).toBe(1);
      expect(
        ruleCount("tailwind-arbitrary-value", {
          "app/routes/page.tsx": 'export default () => <div className="rounded-[7px]" />;',
        }),
      ).toBe(1);
    });

    it("does not fire on ordinary token-backed utilities", () => {
      expect(
        ruleCount("tailwind-arbitrary-value", {
          "app/routes/page.tsx":
            'export default () => <div className="rounded-md bg-surface text-ink" />;',
        }),
      ).toBe(0);
    });
  });

  describe("the gate actually blocks new debt", () => {
    it("FAILS when one new raw hex is added to a clean tree", () => {
      const result = runFixture({
        "app/components/thing.tsx":
          'export const Thing = () => <div className="c">{"#0e0d0a"}</div>;\n',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("raw-hex-color: count 1 !== ceiling 0");
    });

    it("FAILS at a NON-zero seeded ceiling — 1 is fine, 2 is not", () => {
      // The real ceilings are not zero, so this is the shape the gate has to
      // catch in practice: 258 passes, 259 fails.
      const oneHex = { "app/app.css": ":root { color: #0e0d0a; }\n" };
      const seeded = { ...zeroCeilings, "raw-hex-color": 1 };
      expect(runFixture(oneHex, seeded).status).toBe(0);

      const result = runFixture(
        {
          ...oneHex,
          "app/routes/page.tsx": 'export default () => <div>{"#16c47f"}</div>;\n',
        },
        seeded,
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("raw-hex-color: count 2 !== ceiling 1");
    });

    it("FAILS on a non-token font, a literal radius and an arbitrary utility together", () => {
      const result = runFixture({
        "app/app.css": "body { font-family: ui-sans-serif; border-radius: 8px; }\n",
        "app/routes/page.tsx": 'export default () => <div className="rounded-[7px]" />;\n',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("non-token-font-family: count 1 !== ceiling 0");
      expect(result.stderr).toContain("non-token-border-radius: count 1 !== ceiling 0");
      expect(result.stderr).toContain("tailwind-arbitrary-value: count 1 !== ceiling 0");
    });

    it("FAILS on a new gradient and a new !important", () => {
      const result = runFixture({
        "app/app.css": "a { background: linear-gradient(red, blue); color: red !important; }\n",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("css-gradient: count 1 !== ceiling 0");
      expect(result.stderr).toContain("css-important: count 1 !== ceiling 0");
    });

    it("does not reach app/lib — email and PDF templates are outside the design surface", () => {
      // Those files build email/PDF HTML, where CSS custom properties are not
      // reliably supported, so a literal colour there is correct, not debt.
      const result = runFixture({
        "app/lib/email.server.ts":
          'export const html = `<td style="color:#ffffff;font-family:Arial;border-radius:4px">x</td>`;\n',
      });
      expect(result.status, result.stdout + result.stderr).toBe(0);
    });

    it("a deleted pattern ceiling key fails, exactly like a marker key", () => {
      const { "raw-hex-color": _dropped, ...rest } = zeroCeilings;
      const result = runFixture({}, rest as Record<string, number>);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("disagree");
    });
  });

  it("the rule list and its scan scope are pinned — narrowing either is a reviewed act", () => {
    const names = [...source.matchAll(/^\s{4}name: "([^"]+)",$/gm)].map((match) => match[1]);
    expect(names).toEqual([...PATTERN_RULES]);
    expect(source).toContain(
      'export const DESIGN_SURFACE_PATHS = ["app/app.css", "app/components", "app/routes"]',
    );
  });

  it("every rule has a checked-in ceiling, and the zero-tolerance rule is really zero", () => {
    for (const rule of PATTERN_RULES) {
      expect(Number.isInteger(checkedInCeilings[rule]), rule).toBe(true);
    }
    // Seeded at 0 today: the first arbitrary Tailwind value to land fails CI.
    expect(checkedInCeilings["tailwind-arbitrary-value"]).toBe(0);
  });
});
