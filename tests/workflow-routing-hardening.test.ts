import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflowsDirectory = ".github/workflows";
const verificationRunner = ["self-hosted", "linux", "x64", "vps-verify"];
const deployRunner = ["self-hosted", "linux", "x64", "vps-deploy"];
const monitoringRunner = ["self-hosted", "linux", "x64", "0509-monitoring-hardened"];
const fullSha = /@[a-f0-9]{40}(?:\s|#|$)/;

type Step = { uses?: string; run?: string; env?: Record<string, string> };
type Job = {
  "runs-on"?: string | string[];
  environment?: string | { name?: string };
  steps?: Step[];
};
type Workflow = {
  concurrency?: { group?: string; queue?: string; "cancel-in-progress"?: boolean };
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

  it("uses dedicated immutable runner labels for verification, production, and monitoring", () => {
    for (const [file, id] of [
      ["ci.yml", "codex-node-checks"],
      ["cross-browser-matrix.yml", "matrix"],
      ["d1-backup-validate.yml", "validate"],
      ["deploy-production.yml", "prepare_remote_restore_evidence"],
      ["secret-scan.yml", "gitleaks"],
    ] as const) {
      expect(job(file, id)["runs-on"]).toEqual(verificationRunner);
    }
    for (const [file, id] of [
      ["d1-backup-r2.yml", "backup"],
      ["d1-remote-restore-evidence.yml", "restore"],
      ["d1-remote-restore-evidence.yml", "cleanup"],
      ["deploy-production.yml", "deploy"],
      ["finalize-production-soak.yml", "finalize"],
    ] as const) {
      expect(job(file, id)["runs-on"]).toEqual(deployRunner);
    }
    expect(job("uptime-health.yml", "health")["runs-on"]).toEqual(monitoringRunner);
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

  it("serializes every heavyweight command through its runner lane", () => {
    for (const filename of readdirSync(workflowsDirectory).filter((name) => /\.ya?ml$/.test(name))) {
      const { parsed } = workflow(filename);
      for (const [id, candidate] of Object.entries(parsed.jobs ?? {})) {
        const holdsExclusiveDeployLock = candidate.steps?.some(
          (step) => step.run === "./scripts/deploy-window-lock.sh acquire",
        );
        for (const step of candidate.steps ?? []) {
          if (
            !step.run ||
            !/(?:\bnpm (?:ci|install|run)|\bnpx |\bplaywright |(?:validate-d1-backup|customer-readiness-candidate|build-remote-restore-candidate-manifest|verify-remote-restore-evidence|d1-remote-restore-evidence|d1-backup-to-r2|run-cross-browser-risk-proof)\.mjs)/.test(
              step.run,
            )
          ) {
            continue;
          }
          expect(
            step.run,
            `${filename}:${id} heavyweight command must use the shared lane or exclusive deploy lock`,
          ).toSatisfy(
            (command: string) =>
              holdsExclusiveDeployLock ||
              /\.\/scripts\/deploy-window-lock\.sh run --/.test(command),
          );
        }
      }
    }
  });

  it("preserves every deploy, backup, restore, and finalization run while allowing latest-only CI", () => {
    for (const filename of [
      "d1-backup-r2.yml",
      "d1-remote-restore-evidence.yml",
      "deploy-production.yml",
      "finalize-production-soak.yml",
    ]) {
      const concurrency = workflow(filename).parsed.concurrency;
      expect(concurrency?.queue, filename).toBe("max");
      expect(concurrency?.["cancel-in-progress"], filename).toBe(false);
    }
    for (const filename of ["ci.yml", "cross-browser-matrix.yml", "d1-backup-validate.yml", "secret-scan.yml"]) {
      expect(workflow(filename).parsed.concurrency?.["cancel-in-progress"], filename).toBe(true);
    }
  });

  it("limits manual privileged and cross-browser work to trusted main provenance", () => {
    const deploy = workflow("deploy-production.yml").source;
    const finalize = workflow("finalize-production-soak.yml").source;
    const crossBrowser = workflow("cross-browser-matrix.yml").source;
    expect(deploy).toContain("github.ref == 'refs/heads/main'");
    expect(finalize).toContain("run.head_branch === \"main\"");
    expect(finalize).toContain("run.head_sha === expectedSha");
    expect(crossBrowser).toContain("github.ref == 'refs/heads/main'");
  });

  it("keeps exclusive deploy capabilities private to their owning job", () => {
    for (const filename of ["deploy-production.yml", "finalize-production-soak.yml"]) {
      const { source } = workflow(filename);
      expect(source, filename).toContain("DEPLOY_WINDOW_CAPABILITY_FILE: ${{ runner.temp }}/deploy-window-");
      expect(source, filename).toContain("./scripts/deploy-window-lock.sh acquire");
      expect(source, filename).toContain("./scripts/deploy-window-lock.sh release");
      expect(source, filename).toContain('rm -f -- "$DEPLOY_WINDOW_CAPABILITY_FILE"');
      expect(source, filename).not.toMatch(/DEPLOY_WINDOW_RELEASE_TOKEN=.*GITHUB_ENV/);
      expect(source, filename).not.toMatch(/DEPLOY_WINDOW_CAPABILITY_FILE=.*GITHUB_ENV/);
    }
  });

  it("keeps blue-green runner proof jobs read-only and isolated by lane", () => {
    const { source, parsed } = workflow("runner-hardening-proof.yml");
    expect(parsed.jobs?.verify?.["runs-on"]).toEqual(verificationRunner);
    expect(parsed.jobs?.deploy?.["runs-on"]).toEqual(deployRunner);
    expect(parsed.jobs?.monitor?.["runs-on"]).toEqual(monitoringRunner);
    expect(source).toContain("github.ref == 'refs/heads/main'");
    expect(source).toContain("/run/lock/0509/deploy-window.lock");
    expect(source).toContain("/home/nish");
    expect(source).toContain("sudo -n true");
    expect(source).toContain("github-0509.slice");
    expect(source).not.toMatch(/secrets\.|wrangler|cloudflare|dodo|npm |npx /i);
  });
});
