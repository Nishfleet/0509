import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflowsDirectory = ".github/workflows";
const hostedRunner = "ubuntu-latest";
const fullSha = /@[a-f0-9]{40}(?:\s|#|$)/;

type Step = { uses?: string; run?: string; env?: Record<string, string> };
type Job = {
  "runs-on"?: string | string[];
  environment?: string | { name?: string };
  steps?: Step[];
};
type Workflow = {
  concurrency?: { group?: string; "cancel-in-progress"?: boolean; queue?: string };
  jobs?: Record<string, Job>;
};

function workflow(name: string) {
  const source = readFileSync(join(workflowsDirectory, name), "utf8");
  return { source, parsed: parse(source) as Workflow };
}

function job(name: string, id: string) {
  const parsed = workflow(name).parsed;
  const job = parsed.jobs?.[id];
  if (!job) throw new Error(`${name} is missing ${id}`);
  return job;
}

describe("workflow routing hardening", () => {
  it("pins every remote action or reusable workflow to a full commit SHA", () => {
    for (const filename of readdirSync(workflowsDirectory).filter((name) => /\.ya?ml$/.test(name))) {
      const { source } = workflow(filename);
      for (const reference of source.matchAll(/^\s*(?:uses:)\s*([^\s]+).*$/gm)) {
        expect(reference[1], `${filename}: ${reference[1]}`).toMatch(fullSha);
      }
    }
  });

  it("keeps production secrets and production environments out of verification jobs", () => {
    for (const [file, id] of [
      ["ci.yml", "codex-node-checks"],
      ["cross-browser-matrix.yml", "matrix"],
      ["d1-backup-validate.yml", "validate"],
      ["deploy-production.yml", "prepare_remote_restore_evidence"],
      ["secret-scan.yml", "gitleaks"],
    ] as const) {
      const candidate = job(file, id);
      expect(candidate.environment, `${file}:${id} environment`).not.toBe("production");
      expect(JSON.stringify(candidate.steps), `${file}:${id} secrets`).not.toMatch(
        /secrets\.(?:CLOUDFLARE|CANARY_BYPASS_TOKEN|DODO)/,
      );
    }
  });

  it("keeps the typecheck heap inside an explicit budget", () => {
    const typecheck = job("ci.yml", "codex-node-checks").steps?.find(
      (step) => step.run === "npm run typecheck",
    );
    expect(typecheck?.env?.NODE_OPTIONS).toBe("--max-old-space-size=2048");
  });

  it("serializes every provider mutation without cancelling running work", () => {
    // Backup, restore, and soak workflows keep `queue: max` so every queued
    // run eventually executes — none are superseded or cancelled.
    for (const filename of [
      "d1-backup-r2.yml",
      "d1-remote-restore-evidence.yml",
      "finalize-production-soak.yml",
    ]) {
      const concurrency = workflow(filename).parsed.concurrency;
      expect(concurrency, filename).toEqual({
        group: "0509-production-provider-mutations",
        "cancel-in-progress": false,
        queue: "max",
      });
    }
    // Deploy production uses deploy-latest semantics (Nish, 2026-08-25):
    // cancel-in-progress: false (a running deploy is never interrupted) but
    // no `queue: max`, so superseded queued deploys are cancelled and only
    // the newest queued deploy runs after the current one finishes. This
    // does not weaken any gate — the deploy that proceeds runs the full
    // release gate at full strength.
    const deployConcurrency =
      workflow("deploy-production.yml").parsed.concurrency;
    expect(deployConcurrency).toEqual({
      group: "0509-production-provider-mutations",
      "cancel-in-progress": false,
    });
    for (const filename of ["ci.yml", "cross-browser-matrix.yml", "d1-backup-validate.yml", "secret-scan.yml"]) {
      expect(workflow(filename).parsed.concurrency?.["cancel-in-progress"], filename).toBe(true);
    }
  });

  it("limits manual privileged and cross-browser work to trusted main provenance", () => {
    const deploy = workflow("deploy-production.yml").source;
    const finalize = workflow("finalize-production-soak.yml").source;
    const crossBrowser = workflow("cross-browser-matrix.yml").source;
    expect(deploy).toContain('test "$GITHUB_REF" = "refs/heads/main"');
    expect(finalize).toContain("run.head_branch === \"main\"");
    expect(finalize).toContain("run.head_sha === expectedSha");
    expect(crossBrowser).toContain("github.ref == 'refs/heads/main'");
  });

});
