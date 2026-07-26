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
        "runs-on": string;
        steps: Step[];
      };
    };
  };

  it("routes to the monitoring runner with a hosted fallback", () => {
    expect(parsed.jobs.matrix["runs-on"]).toBe(
      "${{ vars.MONITORING_RUNNER || 'ubuntu-latest' }}",
    );
  });

  it("installs system packages only on GitHub-hosted runners", () => {
    const hostedInstall = parsed.jobs.matrix.steps.find(
      (step) =>
        step.name === "Install Playwright browsers with system dependencies",
    );
    expect(hostedInstall).toMatchObject({
      if: "runner.environment == 'github-hosted'",
      run: "npx playwright install chromium firefox webkit --with-deps",
    });

    const selfHostedInstall = parsed.jobs.matrix.steps.find(
      (step) => step.name === "Install Playwright browsers",
    );
    expect(selfHostedInstall).toMatchObject({
      if: "runner.environment == 'self-hosted'",
      run: "npx playwright install chromium firefox webkit",
    });
    expect(selfHostedInstall?.run).not.toContain("--with-deps");
  });
});
