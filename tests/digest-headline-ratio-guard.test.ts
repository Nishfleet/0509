import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "canary-digest-headline-ratio.mjs");
const script2 = (name: string) => join(here, "..", "scripts", name);

/**
 * Finding M56: `--input <fixture> --file-issue` must never file (or even
 * dry-run-print) a production regression issue from pure fixture data.
 * The fixture-poisoning guard protects history.json; it must also protect
 * the issue-filing path.
 */
describe("canary-digest-headline-ratio — fixture cannot file an incident", () => {
  it("does not fire the filing path on fixture input without --record", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "f56-state-"));
    const fixtureDir = mkdtempSync(join(tmpdir(), "f56-fixture-"));
    const fixture = join(fixtureDir, "fixture.json");
    // All-churn fixture day -> rollingRatio 0 -> guard would fire.
    writeFileSync(fixture, JSON.stringify(["landing_page_offer_changed", ...Array(9).fill("mystery_event")]));

    const result = spawnSync(
      process.execPath,
      [script, "--input", fixture, "--file-issue", "--dry-run"],
      {
        env: { ...process.env, DIGEST_HEADLINE_STATE_DIR: stateDir },
        encoding: "utf8",
      },
    );

    const output = result.stdout + result.stderr;
      expect(output).not.toContain(
      "[dry-run] would run",
    );
  });

  it("still files when the guard fires on an explicitly recorded run", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "f56-state2-"));
    const fixtureDir = mkdtempSync(join(tmpdir(), "f56-fixture2-"));
    const fixture = join(fixtureDir, "fixture.json");
    writeFileSync(fixture, JSON.stringify(["landing_page_offer_changed", ...Array(9).fill("mystery_event")]));

    const result = spawnSync(
      process.execPath,
      [script, "--input", fixture, "--record", "--file-issue", "--dry-run"],
      {
        env: { ...process.env, DIGEST_HEADLINE_STATE_DIR: stateDir },
        encoding: "utf8",
      },
    );

    const output = result.stdout + result.stderr;
      expect(output).toContain(
      "[dry-run] would run",
    );
  });
});

describe("sibling canaries — --local fixture mode cannot file an incident", () => {
  const cases: Array<[string, string[]]> = [
    ["canary-demo-brand-timeline.mjs", ["--local", "--file-issue", "--dry-run"]],
    ["canary-proof-screenshot-rate.mjs", ["--local", "--file-issue", "--dry-run"]],
  ];

  for (const [name, args] of cases) {
    it(`${name}: no filing path on --local fixture data`, () => {
      const result = spawnSync(process.execPath, [script2(name), ...args], {
        encoding: "utf8",
        timeout: 60_000,
      });
      // The script may exit non-zero (probe verdict fail); we only assert the
      // fixture run never opens a production incident path.
      const output = result.stdout + result.stderr;
      expect(output).not.toContain(
        "[dry-run] would run",
      );
    });
  }
});
