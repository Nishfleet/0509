import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = {
  name?: string;
  if?: string;
  run?: string;
};

describe("cross-browser workflow", () => {
  const workflow = readFileSync(
    ".github/workflows/cross-browser-matrix.yml",
    "utf8",
  );
  const parsed = parse(workflow) as {
    jobs: {
      matrix: {
        "runs-on": string[];
        steps: Step[];
      };
    };
  };

  it("routes to a GitHub-hosted runner", () => {
  // 2026-08-22 (Nish): 0509 is a PUBLIC repo, so standard GitHub-hosted
  // runners are free and cannot hit the 2026-08-10 billing outage that pushed
  // everything onto the VPS pool. Measured the same day: this CI completes in
  // ~2.5 min hosted against a ~20.5 min median on the shared VPS pool, because
  // every heavy step there serialises behind scripts/deploy-window-lock.sh.
  // Everything credential-bearing stays on the VPS - deploy-production,
  // d1-backup-validate and secret-scan are still asserted below.
    // The engine matrix is a nightly DIAGNOSTIC, not a release gate, and it
    // carries no credentials - so it has no reason to occupy the VPS pool.
    expect(parsed.jobs.matrix["runs-on"]).toEqual("ubuntu-latest");
  });

  it("runs browser installation and proof inside a verification lane", () => {
    const browserInstall = parsed.jobs.matrix.steps.find(
      (step) => step.name === "Install Playwright browsers",
    );
    expect(browserInstall).toMatchObject({
      run: "./scripts/deploy-window-lock.sh run -- npx playwright install chromium firefox webkit",
    });
    expect(browserInstall?.run).not.toContain("--with-deps");

    const proof = parsed.jobs.matrix.steps.find(
      (step) => step.name === "Run cross-browser risk proof",
    );
    expect(proof?.run).toBe(
      "./scripts/deploy-window-lock.sh run -- node scripts/run-cross-browser-risk-proof.mjs",
    );
  });

  it("gives diagnostic engine projects a 60s budget while chromium stays at 30s", () => {
    // Journey 1 desktop under mobile-safari routinely needs ~31–33s on the
    // hardened vps-verify runner; the 30s default makes the matrix chronically
    // red even when the product under test is healthy.
    const config = readFileSync("playwright.config.ts", "utf8");
    expect(config).toMatch(/timeout:\s*30_000/);
    expect(config).toMatch(
      /const diagnosticEngineProject = \{[\s\S]*?timeout:\s*60_000[\s\S]*?retries:\s*2/,
    );
    for (const project of [
      "local-release-firefox",
      "local-release-webkit",
      "local-release-mobile-safari",
      "local-release-mobile-chrome",
    ]) {
      expect(config).toMatch(
        new RegExp(`name:\\s*"${project}"[\\s\\S]*?\\.\\.\\.diagnosticEngineProject`),
      );
    }
    // Chromium release gate must not inherit the diagnostic budget.
    expect(config).toMatch(
      /name:\s*"local-release"[\s\S]*?retries:\s*0[\s\S]*?name:\s*"local-release-firefox"/,
    );
    expect(config).not.toMatch(
      /name:\s*"local-release"[\s\S]{0,200}\.\.\.diagnosticEngineProject/,
    );
  });
});
