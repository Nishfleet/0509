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

  it("installs browsers with system deps on hosted runners", () => {
    // PR #902 moved this workflow from self-hosted runners (which pre-install
    // WebKit's GTK-4 / GStreamer / flite system libraries) to ubuntu-latest.
    // The hosted ubuntu-24.04 image does not ship those libs, so the install
    // step must use --with-deps or every firefox/webkit/mobile launch fails
    // with "Host system is missing dependencies to run browsers". This
    // regressed nightly on 2026-08-24 and 2026-08-25.
    const browserInstall = parsed.jobs.matrix.steps.find(
      (step) => step.name === "Install Playwright browsers",
    );
    expect(browserInstall).toMatchObject({
      run: "npx playwright install --with-deps chromium firefox webkit",
    });
    expect(browserInstall?.run).toContain("--with-deps");

    const proof = parsed.jobs.matrix.steps.find(
      (step) => step.name === "Run cross-browser risk proof",
    );
    expect(proof?.run).toBe(
      "node scripts/run-cross-browser-risk-proof.mjs",
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
