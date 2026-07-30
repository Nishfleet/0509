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

  it("routes only to a hardened verification runner", () => {
    expect(parsed.jobs.matrix["runs-on"]).toEqual([
      "self-hosted",
      "linux",
      "x64",
      "vps-verify",
    ]);
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
});
