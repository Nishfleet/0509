import {
  chmodSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  if?: string;
  "runs-on"?: string | string[];
  needs?: string | string[];
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  environment?: unknown;
  env?: Record<string, string>;
  steps?: WorkflowStep[];
};

type ControlWorkflow = {
  on: {
    pull_request?: unknown;
    push?: { branches?: string[] };
    schedule?: unknown;
    workflow_dispatch?: {
      inputs?: Record<string, { required?: boolean; type?: string }>;
    };
  };
  permissions?: Record<string, string>;
  concurrency?: {
    group?: string;
    "cancel-in-progress"?: boolean;
    queue?: string;
  };
  jobs: Record<string, WorkflowJob>;
};

const workflowSource = readFileSync(
  ".github/workflows/deploy-production.yml",
  "utf8",
);
const workflow = parse(workflowSource) as ControlWorkflow;

function readWorkflow(name: string) {
  const source = readFileSync(`.github/workflows/${name}`, "utf8");
  return { source, parsed: parse(source) as ControlWorkflow };
}

function stepIndex(job: WorkflowJob | undefined, name: string) {
  return (job?.steps ?? []).findIndex((step) => step.name === name);
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("exact production candidate workflow", () => {
  it("authorizes a pinned main SHA before any privileged runner or secret", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch?.inputs?.expected_sha).toEqual({
      description: "Exact main commit authorized for production deployment",
      required: true,
      type: "string",
    });
    expect(workflow.permissions).toEqual({});

    const authorize = workflow.jobs.authorize_release;
    expect(authorize?.["runs-on"]).toBe("ubuntu-latest");
    expect(authorize?.permissions).toEqual({});
    expect(authorize?.environment).toBeUndefined();
    expect(authorize?.outputs?.sha).toBe("${{ steps.authorize.outputs.sha }}");
    expect(authorize?.steps).toHaveLength(1);
    expect(JSON.stringify(authorize)).not.toMatch(
      /actions\/checkout|secrets\.|wrangler|cloudflare/i,
    );
    const authorizeStep = authorize?.steps?.[0];
    expect(authorizeStep?.name).toBe("Authorize release request");
    expect(authorizeStep?.run).toContain(
      'test "$GITHUB_REPOSITORY" = "nish3451/0509"',
    );
    expect(authorizeStep?.run).toContain(
      'test "$GITHUB_REF" = "refs/heads/main"',
    );
    expect(authorizeStep?.run).toContain(
      'test "$GITHUB_RUN_ATTEMPT" = "1"',
    );
    expect(authorizeStep?.run).toContain("workflow_dispatch)");

    const pin = workflow.jobs.pin_candidate;
    expect(pin?.needs).toBe("authorize_release");
    expect(pin?.["runs-on"]).toBe("ubuntu-latest");
    expect(pin?.permissions).toEqual({ contents: "read" });
    expect(pin?.environment).toBeUndefined();
    expect(pin?.outputs?.sha).toBe("${{ steps.pin.outputs.sha }}");
    expect(JSON.stringify(pin)).not.toMatch(/secrets\.|wrangler|cloudflare/i);

    const steps = pin?.steps ?? [];
    const checkoutIndex = steps.findIndex((step) => step.uses?.startsWith("actions/checkout@"));
    const verifyIndex = stepIndex(pin, "Verify and pin exact main candidate");
    expect(checkoutIndex).toBe(0);
    expect(verifyIndex).toBeGreaterThan(checkoutIndex);
    expect(steps[checkoutIndex]?.with).toMatchObject({
      ref: "${{ needs.authorize_release.outputs.sha }}",
      "fetch-depth": 0,
      clean: true,
      "persist-credentials": false,
    });
    expect(steps[verifyIndex]).toMatchObject({
      id: "pin",
      run: "./scripts/ci-verify-production-candidate.sh",
    });
  });

  it("pins every downstream checkout and rechecks main at each mutation boundary", () => {
    const prepare = workflow.jobs.prepare_remote_restore_evidence;
    const deploy = workflow.jobs.deploy;
    expect(prepare?.needs).toBe("pin_candidate");
    expect(prepare?.permissions).toEqual({ contents: "read", actions: "read" });
    expect(deploy?.needs).toEqual([
      "pin_candidate",
      "prepare_remote_restore_evidence",
      "generate_restore_evidence",
      "cleanup_restore_evidence",
    ]);
    expect(deploy?.permissions).toEqual({
      contents: "read",
      actions: "read",
      deployments: "write",
    });

    for (const [candidate, verifier] of [
      [
        prepare,
        "./scripts/deploy-window-lock.sh run -- ./scripts/ci-verify-production-candidate.sh",
      ],
      [deploy, "./scripts/ci-verify-production-candidate.sh"],
    ] as const) {
      const steps = candidate?.steps ?? [];
      const checkoutIndex = steps.findIndex((step) => step.uses?.startsWith("actions/checkout@"));
      const verifyIndex = steps.findIndex(
        (step) => step.run === verifier,
      );
      expect(checkoutIndex).toBeGreaterThanOrEqual(0);
      expect(verifyIndex).toBe(checkoutIndex + 1);
      expect(steps[checkoutIndex]?.with).toMatchObject({
        ref: "${{ needs.pin_candidate.outputs.sha }}",
        "fetch-depth": 0,
        clean: true,
        "persist-credentials": false,
      });
    }

    const deploySteps = deploy?.steps ?? [];
    const finalCas = stepIndex(deploy, "Reconfirm frozen main before provider mutation");
    const firstProviderMutation = stepIndex(deploy, "Synchronize private canary token");
    expect(finalCas).toBeGreaterThan(stepIndex(deploy, "Verify and extract private remote-restore evidence"));
    expect(firstProviderMutation).toBe(finalCas + 1);
    expect(deploySteps[finalCas]?.run).toBe("./scripts/ci-verify-production-candidate.sh");
    const deployMutation = deploySteps[stepIndex(deploy, "Deploy")];
    expect(deployMutation?.env).toMatchObject({
      GH_TOKEN: "${{ github.token }}",
    });
    expect(workflowSource).toContain(
      "production-release-evidence-${{ needs.pin_candidate.outputs.sha }}-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(workflowSource).toContain(
      "d1-remote-restore-evidence-${{ github.sha }}-${{ github.run_id }}",
    );
    expect(workflowSource).not.toContain(
      "d1-remote-restore-evidence-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(workflowSource).toContain("overwrite: true");
  });

  it("guards exact-SHA CI, secret scan, backup, and restore entrypoints", () => {
    for (const name of [
      "ci.yml",
      "secret-scan.yml",
      "d1-backup-r2.yml",
      "d1-remote-restore-evidence.yml",
    ]) {
      const { parsed } = readWorkflow(name);
      expect(
        parsed.on.workflow_dispatch?.inputs?.expected_sha,
        `${name} expected_sha`,
      ).toMatchObject({ required: true, type: "string" });
      const authorize = parsed.jobs.authorize_release;
      expect(authorize?.["runs-on"], `${name} authorizer runner`).toBe(
        "ubuntu-latest",
      );
      expect(authorize?.permissions, `${name} authorizer permissions`).toEqual(
        {},
      );
      expect(authorize?.outputs?.sha, `${name} authorizer output`).toBe(
        "${{ steps.authorize.outputs.sha }}",
      );
      expect(JSON.stringify(authorize), `${name} authorizer isolation`).not.toMatch(
        /actions\/checkout|secrets\.|wrangler|cloudflare/i,
      );
      expect(authorize?.steps?.[0]?.run, `${name} canonical repository`).toContain(
        'test "$GITHUB_REPOSITORY" = "nish3451/0509"',
      );
    }

    for (const [name, jobName] of [
      ["ci.yml", "codex-node-checks"],
      ["secret-scan.yml", "gitleaks"],
      ["d1-backup-r2.yml", "backup"],
    ] as const) {
      const job = readWorkflow(name).parsed.jobs[jobName];
      expect(job?.needs, `${name} authorization dependency`).toBe(
        "authorize_release",
      );
      const steps = job?.steps ?? [];
      const checkout = steps.findIndex((step) =>
        step.uses?.startsWith("actions/checkout@"),
      );
      expect(steps[checkout]?.with, `${name} pinned checkout`).toMatchObject({
        ref: "${{ needs.authorize_release.outputs.sha }}",
        "fetch-depth": 0,
        clean: true,
        "persist-credentials": false,
      });
      expect(steps[checkout + 1]?.name, `${name} immediate verification`).toMatch(
        /Verify (?:authorized|pinned)/,
      );
    }

    const ci = readWorkflow("ci.yml").parsed;
    expect(ci.concurrency).not.toMatchObject({
      group: "0509-production-provider-mutations",
    });
    const ciSteps = ci.jobs["codex-node-checks"]?.steps ?? [];
    expect(stepIndex(ci.jobs["codex-node-checks"], "Verify authorized checkout")).toBeLessThan(
      ciSteps.findIndex((step) => step.uses?.startsWith("actions/setup-node@")),
    );
    expect(readWorkflow("ci.yml").source).not.toContain("git ls-remote");
    expect(readWorkflow("secret-scan.yml").source).not.toContain(
      "git ls-remote",
    );

    const backup = readWorkflow("d1-backup-r2.yml").parsed.jobs.backup;
    const backupAcquire = stepIndex(backup, "Acquire provider lane");
    const backupCas = stepIndex(backup, "Reconfirm frozen main before backup mutation");
    expect(backupAcquire).toBeGreaterThanOrEqual(0);
    expect(backupCas).toBe(backupAcquire + 1);
    expect(stepIndex(backup, "Run approved D1-to-R2 backup")).toBe(backupCas + 1);
    const backupRelease = stepIndex(backup, "Release provider lane");
    expect(backupRelease).toBeGreaterThan(
      stepIndex(backup, "Run approved D1-to-R2 backup"),
    );
    expect(backup?.steps?.[backupRelease]).toMatchObject({
      if: "always()",
      run: "./scripts/deploy-window-lock.sh release",
    });

    const restore = readWorkflow("d1-remote-restore-evidence.yml").parsed.jobs;
    expect(restore.apply_and_restore?.needs).toBe("authorize_release");
    expect(restore.restore?.needs).toEqual([
      "authorize_release",
      "apply_and_restore",
    ]);
    expect(restore.cleanup?.needs).toEqual([
      "authorize_release",
      "apply_and_restore",
      "restore",
    ]);
    for (const job of [
      restore.apply_and_restore,
      restore.restore,
      restore.cleanup,
    ]) {
      const steps = job?.steps ?? [];
      const checkout = steps.findIndex((step) =>
        step.uses?.startsWith("actions/checkout@"),
      );
      expect(steps[checkout]?.with).toMatchObject({
        ref: "${{ needs.authorize_release.outputs.sha }}",
        "fetch-depth": 0,
        clean: true,
        "persist-credentials": false,
      });
      expect(steps[checkout + 1]?.name).toMatch(/Verify authorized/);
    }
    const restoreCas = stepIndex(
      restore.restore,
      "Reconfirm frozen main before restore mutation",
    );
    const restoreMutation = stepIndex(
      restore.restore,
      "Create fresh backup and prove an isolated remote restore",
    );
    expect(stepIndex(restore.restore, "Acquire provider lane")).toBe(
      restoreCas - 1,
    );
    expect(restoreMutation).toBe(restoreCas + 1);
    expect(restore.restore?.steps?.[restoreCas]).toMatchObject({
      run: "./scripts/ci-verify-provider-main-cas.sh",
      env: { GH_TOKEN: "${{ github.token }}" },
    });

    const cleanupAcquire = stepIndex(restore.cleanup, "Acquire provider lane");
    const cleanupMutation = stepIndex(
      restore.cleanup,
      "Delete every exact scratch database from this run",
    );
    expect(cleanupMutation).toBe(cleanupAcquire + 1);
    const exactApplyRestoreGate =
      "always() && needs.authorize_release.result == 'success' && (github.event_name == 'schedule' || needs.apply_and_restore.result == 'success')";
    expect(restore.restore?.if).toBe(exactApplyRestoreGate);
    expect(restore.cleanup?.if).toBe(
      "always() && needs.authorize_release.result == 'success'",
    );
    expect(JSON.stringify(restore.cleanup)).not.toContain(
      "ci-verify-provider-main-cas.sh",
    );
    expect(restore.cleanup?.steps?.[cleanupMutation]?.run).toBe(
      "node scripts/d1-remote-restore-evidence.mjs --cleanup-only",
    );
    expect(restore.cleanup?.steps?.[cleanupMutation]?.run).not.toContain(
      "--sweep-stale",
    );

    for (const [job, mutationIndex] of [
      [restore.restore, restoreMutation],
      [restore.cleanup, cleanupMutation],
    ] as const) {
      expect(job?.env).not.toHaveProperty("GH_TOKEN");
      const releaseIndex = stepIndex(job, "Release provider lane");
      expect(releaseIndex).toBeGreaterThan(mutationIndex);
      expect(job?.steps?.[releaseIndex]).toMatchObject({
        if: "always()",
        run: "./scripts/deploy-window-lock.sh release",
      });
    }

    const verifier = readFileSync(
      "scripts/ci-verify-production-candidate.sh",
      "utf8",
    );
    const providerCas = readFileSync(
      "scripts/ci-verify-provider-main-cas.sh",
      "utf8",
    );
    expect(verifier).toContain("ci-verify-provider-main-cas.sh");
    // Nightly D1 backup (d1-backup-r2.yml schedule) uses this gate; schedule
    // must accept empty expected_sha and reject a smuggled one.
    expect(verifier).toContain("unexpected_schedule_expected_sha");
    expect(verifier).toMatch(/schedule\)\s*\n[\s\S]*unexpected_schedule_expected_sha/);
    expect(providerCas).toContain("curl --disable");
    expect(providerCas).toContain("command -v curl");
    expect(providerCas).toContain("command -v jq");
    expect(providerCas).toContain("--connect-timeout 10");
    expect(providerCas).toContain("--max-time 30");
    expect(providerCas).toContain("--proto '=https'");
    expect(providerCas).toContain("--proto-redir '=https'");
    expect(providerCas).toContain(
      'printf \'header = "Authorization: Bearer %s"\\n\' "$GH_TOKEN"',
    );
    expect(providerCas).not.toMatch(/curl[^\n]*GH_TOKEN/);
    expect(providerCas).toContain("jq -er '.object.sha'");
    expect(providerCas).toContain("X-GitHub-Api-Version: 2026-03-10");
    expect(verifier).not.toContain("git ls-remote");
    expect(providerCas).not.toContain("git ls-remote");
  });

  it("fails closed on invalid requests, checkout drift, branch checkout, and remote-main drift", () => {
    const root = mkdtempSync(join(tmpdir(), "0509-production-candidate-"));
    const work = join(root, "work");
    const fakeBin = join(root, "bin");
    mkdirSync(work);
    mkdirSync(fakeBin);
    try {
      git(work, "init", "-b", "main");
      git(work, "config", "user.name", "Test");
      git(work, "config", "user.email", "test@example.invalid");
      writeFileSync(join(work, "candidate.txt"), "candidate\n");
      git(work, "add", "candidate.txt");
      git(work, "commit", "-m", "candidate");
      const candidateSha = git(work, "rev-parse", "HEAD");
      const fakeCurl = join(fakeBin, "curl");
      writeFileSync(
        fakeCurl,
        `#!/usr/bin/env bash
set -euo pipefail
test "$GH_TOKEN" = "test-token"
args="$*"
[[ "$args" = *"--disable"* ]]
[[ "$args" = *"--connect-timeout 10"* ]]
[[ "$args" = *"--max-time 30"* ]]
[[ "$args" = *"--proto =https"* ]]
[[ "$args" = *"--proto-redir =https"* ]]
[[ "$args" = *"--config -"* ]]
config="$(cat)"
grep -Fq 'url = "https://api.github.com/repos/nish3451/0509/git/ref/heads/main"' <<< "$config"
grep -Fq 'header = "Authorization: Bearer test-token"' <<< "$config"
grep -Fq 'header = "X-GitHub-Api-Version: 2026-03-10"' <<< "$config"
printf '{"object":{"sha":"%s"}}\n' "$FAKE_REMOTE_SHA"
`,
      );
      chmodSync(fakeCurl, 0o755);
      git(work, "checkout", "--detach", candidateSha);

      const guard = resolve("scripts/ci-verify-production-candidate.sh");
      const output = join(root, "github-output");
      const baseEnv = {
        ...process.env,
        GITHUB_EVENT_NAME: "push",
        GITHUB_REPOSITORY: "nish3451/0509",
        GITHUB_REF: "refs/heads/main",
        GITHUB_SHA: candidateSha,
        GITHUB_RUN_ATTEMPT: "1",
        PINNED_SHA: candidateSha,
        EXPECTED_SHA: "",
        EMIT_PINNED_SHA: "1",
        GITHUB_OUTPUT: output,
        GH_TOKEN: "test-token",
        FAKE_REMOTE_SHA: candidateSha,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      };
      const run = (overrides: Record<string, string> = {}) =>
        spawnSync(guard, [], {
          cwd: work,
          env: { ...baseEnv, ...overrides },
          encoding: "utf8",
        });

      expect(run().status).toBe(0);
      expect(readFileSync(output, "utf8")).toContain(`sha=${candidateSha}`);
      expect(run({
        GITHUB_EVENT_NAME: "workflow_dispatch",
        EXPECTED_SHA: candidateSha,
      }).status).toBe(0);
      // Scheduled unattended runs pin main tip with empty expected_sha (same
      // contract as authorize in d1-backup-r2.yml / restore-evidence).
      expect(run({
        GITHUB_EVENT_NAME: "schedule",
        EXPECTED_SHA: "",
      }).status).toBe(0);
      const invalidOverrides: Array<Record<string, string>> = [
        { GITHUB_REPOSITORY: "fork/0509" },
        { GITHUB_REF: "refs/heads/feature" },
        { GITHUB_SHA: "not-a-sha" },
        { GITHUB_RUN_ATTEMPT: "2" },
        { GH_TOKEN: "" },
        { GITHUB_EVENT_NAME: "workflow_dispatch", EXPECTED_SHA: "f".repeat(40) },
        // Schedule must not accept a smuggled expected_sha.
        { GITHUB_EVENT_NAME: "schedule", EXPECTED_SHA: "f".repeat(40) },
        // Still reject unknown event names.
        { GITHUB_EVENT_NAME: "pull_request" },
      ];
      for (const overrides of invalidOverrides) {
        expect(run(overrides).status).not.toBe(0);
      }

      git(work, "checkout", "main");
      expect(run().status).not.toBe(0);
      git(work, "checkout", "--detach", candidateSha);
      expect(run({ FAKE_REMOTE_SHA: "f".repeat(40) }).status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
