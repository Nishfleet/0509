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
  concurrency?: { group?: string; "cancel-in-progress"?: boolean; queue?: string };
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
      ["deploy-production.yml", "verify"],
      ["secret-scan.yml", "gitleaks"],
    ] as const) {
      const candidate = job(file, id);
      expect(candidate.environment, `${file}:${id} environment`).not.toBe("production");
      expect(JSON.stringify(candidate.steps), `${file}:${id} secrets`).not.toMatch(
        /secrets\.(?:CLOUDFLARE|CANARY_BYPASS_TOKEN|DODO)/,
      );
    }
  });

  it("keeps the typecheck heap inside an explicit, uniform budget", () => {
    // 4096 MB everywhere (0509#3303): `tsc -b` peaked at ~2030 MB against the
    // old 2048 MB pin and exited 134 probabilistically (run 34693260245;
    // the identical head passed unchanged on retrigger, run 34698175521).
    // The three workflows that share the deploy verification shape must
    // carry the SAME budget — that parity is what lets one of them pass
    // predict what the others will do. deploy-production.yml carries it on
    // the `deploy` job's Deploy step, whose in-script typecheck
    // (scripts/deploy-production.mjs -> `npm run typecheck`) previously ran
    // on the runner's implicit ~2.0 GB default instead of a pin.
    const typecheck = job("ci.yml", "codex-node-checks").steps?.find(
      (step) => step.run === "npm run typecheck",
    );
    expect(typecheck?.env?.NODE_OPTIONS).toBe("--max-old-space-size=4096");
    const previewTypecheck = job(
      "preview-assert.yml",
      "preview-assert",
    ).steps?.find((step) => step.run === "npm run typecheck");
    expect(previewTypecheck?.env?.NODE_OPTIONS).toBe(
      "--max-old-space-size=4096",
    );
    const deploy = job("deploy-production.yml", "deploy").steps?.find(
      (step) => step.run === "npm run deploy",
    );
    expect(deploy?.env?.NODE_OPTIONS).toBe("--max-old-space-size=4096");
  });

  it("serializes every provider mutation without cancelling running work", () => {
    for (const filename of ["deploy-production.yml", "d1-backup-weekly.yml"]) {
      expect(workflow(filename).parsed.concurrency, filename).toEqual({
        group: "0509-production-provider-mutations",
        "cancel-in-progress": false,
      });
    }
    for (const filename of ["ci.yml", "secret-scan.yml"]) {
      expect(workflow(filename).parsed.concurrency?.["cancel-in-progress"], filename).toBe(true);
    }
  });

  it("limits manual privileged work to trusted main provenance", () => {
    const deploy = workflow("deploy-production.yml").source;
    expect(deploy).toContain('test "$GITHUB_REF" = "refs/heads/main"');
  });

});
