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
import { parse, stringify } from "yaml";

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
    // Auto-deploy on green (Nish, 2026-08-25): push to main triggers the same
    // exact-SHA deploy as a manual workflow_dispatch. The authorize job's
    // `push)` branch (already wired before this trigger was added) pins
    // GITHUB_SHA and requires empty dispatch inputs, so no gate is weakened.
    expect(Object.keys(workflow.on).sort()).toEqual([
      "push",
      "workflow_dispatch",
    ]);
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    expect(workflow.on.workflow_dispatch?.inputs?.expected_sha).toEqual({
      description: "Exact main commit authorized for production deployment",
      required: true,
      type: "string",
    });
    expect(workflow.permissions).toEqual({});

    const authorize = workflow.jobs.authorize_release;
    expect(authorize?.["runs-on"]).toEqual("ubuntu-latest");
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
      'test "$GITHUB_REPOSITORY" = "Nishfleet/0509"',
    );
    expect(authorizeStep?.run).toContain(
      'test "$GITHUB_REF" = "refs/heads/main"',
    );
    expect(authorizeStep?.run).toContain(
      'test "$GITHUB_RUN_ATTEMPT" = "1"',
    );
    expect(authorizeStep?.run).toContain("workflow_dispatch)");
    // Dispatch resolution: authorize pins the exact dispatched candidate, not
    // the run head - GITHUB_SHA may be a newer main tip if main advanced
    // between dispatch and run start (2026-08-13: 2c6cc3eb dispatched, run
    // created on 0932e554). pin_candidate's CAS confirms the candidate is
    // still reachable from live main before anything ships.
    expect(authorizeStep?.env).not.toHaveProperty("GITHUB_TOKEN");
    expect(authorizeStep?.run).toContain('GITHUB_SHA="$EXPECTED_SHA"');

    const pin = workflow.jobs.pin_candidate;
    expect(pin?.needs).toBe("authorize_release");
    expect(pin?.["runs-on"]).toEqual("ubuntu-latest");
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
    // The initial pin stays fail-closed: drift tolerance is granted only to
    // post-pin steps that re-verify the already-pinned SHA after the gate
    // validated it. If main moved before the pin, no candidate has been
    // verified yet, so the run must stop.
    expect(steps[verifyIndex]?.env).not.toHaveProperty("TOLERATE_MAIN_DRIFT");
  });

  it("offers the chain bootstrap as an optional dispatch input wired only to the release gate", () => {
    // The repository rename (nish3451/0509 -> Nishfleet/0509) reset GitHub's
    // deploy-production run history to zero, which deadlocked the
    // last-successful-deploy chain: no deploy could succeed without a prior
    // success, and no prior success could exist without a successful deploy.
    // The input exists to break that deadlock exactly once.
    expect(
      workflow.on.workflow_dispatch?.inputs?.bootstrap_previous_success_sha,
    ).toEqual({
      description:
        "One-time chain bootstrap; empty unless GitHub has zero successful deploys",
      required: false,
      default: "",
      type: "string",
    });

    // Optional by construction: a push-triggered or plain dispatch run must
    // stay byte-identical to today's behaviour, which means the env resolves
    // to the empty string and the verifier keeps failing closed.
    const deploy = workflow.jobs.deploy;
    const deployStep = deploy?.steps?.[stepIndex(deploy, "Deploy")];
    expect(deployStep?.env?.BOOTSTRAP_PREVIOUS_SUCCESS_SHA).toBe(
      "${{ inputs.bootstrap_previous_success_sha || '' }}",
    );

    // Blast radius: only the two steps that actually run
    // verify-remote-restore-evidence.mjs may read it. No authorizing,
    // pinning, evidence-generating, or provider-mutating step may, and no
    // job-level env may leak it to every step in a job.
    const consumers: string[] = [];
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      for (const key of Object.keys(job.env ?? {})) {
        if (key === "BOOTSTRAP_PREVIOUS_SUCCESS_SHA") {
          consumers.push(`${jobName}:<job env>`);
        }
      }
      for (const step of job.steps ?? []) {
        for (const key of Object.keys(step.env ?? {})) {
          if (key === "BOOTSTRAP_PREVIOUS_SUCCESS_SHA") {
            consumers.push(`${jobName}:${step.name ?? step.uses ?? "<step>"}`);
          }
        }
      }
    }
    expect(consumers).toEqual([
      "prepare_remote_restore_evidence:Verify pre-generated exact R2 restore evidence",
      "deploy:Deploy",
    ]);

    // Both consumers are exactly the steps that invoke the verifier: the
    // pre-generated-artifact check and the release gate. Without the anchor
    // the first one exits 2 on every attempt and hard-stops the run before
    // the gate is ever reached (run 32232488597).
    const prepareVerify =
      workflow.jobs.prepare_remote_restore_evidence?.steps?.[
        stepIndex(
          workflow.jobs.prepare_remote_restore_evidence,
          "Verify pre-generated exact R2 restore evidence",
        )
      ];
    expect(prepareVerify?.run).toContain(
      "ci-prepare-remote-restore-evidence.sh",
    );
    expect(prepareVerify?.env?.BOOTSTRAP_PREVIOUS_SUCCESS_SHA).toBe(
      "${{ inputs.bootstrap_previous_success_sha || '' }}",
    );

    // The input is inert everywhere else in the file, including the
    // authorizer's dispatch validation, which must not start treating it as
    // an authorization token.
    expect(
      workflowSource.match(/inputs\.bootstrap_previous_success_sha/g),
    ).toHaveLength(2);
    const authorizeStep = workflow.jobs.authorize_release?.steps?.[0];
    expect(JSON.stringify(authorizeStep)).not.toContain("bootstrap");
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
        "./scripts/ci-verify-production-candidate.sh",
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
      // Post-pin drift tolerance: every downstream verify re-checks the exact
      // SHA pin_candidate already pinned, and the job works on exactly that
      // SHA, so a mid-run move of main must not fail the run (same rationale
      // as the deploy job's post-gate reconfirm). Every other CAS failure
      // stays fail-closed; only the initial pin is fail-closed on drift.
      expect(steps[verifyIndex]?.env).toMatchObject({
        TOLERATE_MAIN_DRIFT: "1",
      });
    }

    // The evidence-generation job's reconfirm runs directly before the fresh
    // backup + isolated remote restore mutation and tolerates drift for the
    // same reason: it publishes evidence for the already-pinned exact SHA.
    const generate = workflow.jobs.generate_restore_evidence;
    const generateCas = stepIndex(
      generate,
      "Reconfirm frozen main before evidence mutation",
    );
    const generateMutation = stepIndex(
      generate,
      "Create fresh backup and prove an isolated remote restore",
    );
    expect(generateCas).toBeGreaterThanOrEqual(0);
    expect(generateMutation).toBe(generateCas + 1);
    expect(generate?.steps?.[generateCas]).toMatchObject({
      run: "./scripts/ci-verify-provider-main-cas.sh",
      env: {
        GH_TOKEN: "${{ github.token }}",
        TOLERATE_MAIN_DRIFT: "1",
      },
    });

    const deploySteps = deploy?.steps ?? [];
    const finalCas = stepIndex(deploy, "Reconfirm frozen main before provider mutation");
    const firstProviderMutation = stepIndex(deploy, "Deploy");
    expect(finalCas).toBeGreaterThan(stepIndex(deploy, "Verify and extract private remote-restore evidence"));
    expect(firstProviderMutation).toBe(finalCas + 1);
    expect(deploySteps[finalCas]?.run).toBe("./scripts/ci-verify-production-candidate.sh");
    // The post-gate reconfirm tolerates a mid-run move of main: the deploy
    // ships exactly the verified pinned SHA, so drift must not kill the run
    // after a fully green gate. The pre-gate verification stays fail-closed.
    expect(deploySteps[finalCas]?.env).toMatchObject({
      TOLERATE_MAIN_DRIFT: "1",
    });
    const preGateVerify = stepIndex(
      deploy,
      "Verify pinned candidate before repository and secret work",
    );
    // This step re-verifies the pinned SHA before any repository or secret
    // work in the deploy job. pin_candidate already validated this exact SHA,
    // so a mid-run move of main must not kill the deploy: the run ships the
    // verified pinned SHA, matching the post-gate reconfirm rationale.
    expect(deploySteps[preGateVerify]?.env).toMatchObject({
      TOLERATE_MAIN_DRIFT: "1",
    });
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

  it("references only direct needs in the deploy workflow", () => {
    // GitHub Actions exposes only the jobs listed in a job's `needs` key to
    // its `needs` context; a transitive reference (e.g. an ancestor job that
    // is not a declared dependency) silently evaluates to an empty string at
    // runtime. That would disable the generate/cleanup wiring below while all
    // checks still pass, so every `needs.<job>.` reference must name a
    // declared direct dependency.
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      const declaredNeeds = new Set(
        Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [],
      );
      const jobText = stringify(job) ?? "";
      const referencedNeeds = new Set(
        [...(jobText.match(/needs\.([A-Za-z0-9_-]+)\./g) ?? [])].map((ref) =>
          ref.slice("needs.".length, -1),
        ),
      );
      const undeclared = [...referencedNeeds].filter(
        (ref) => !declaredNeeds.has(ref),
      );
      expect(
        undeclared,
        `${jobName} may reference only direct needs; undeclared: ${undeclared.join(", ")}`,
      ).toEqual([]);
    }
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
    }

    // Standalone authorizer jobs survive only where the consuming job is not
    // itself a required context. The CI and secret-scan required jobs fold
    // their authorizer into the first STEP instead: a required job must be
    // structurally incapable of concluding SKIPPED, so it carries no `if:`
    // and no `needs` (both would let it skip - GitHub counts a skipped
    // required context as satisfied). required-context-no-skip.test.ts pins
    // that shape for the required jobs.
    for (const name of ["d1-backup-r2.yml", "d1-remote-restore-evidence.yml"]) {
      const { parsed } = readWorkflow(name);
      const authorize = parsed.jobs.authorize_release;
      expect(authorize?.["runs-on"], `${name} authorizer runner`).toEqual(
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
        'test "$GITHUB_REPOSITORY" = "Nishfleet/0509"',
      );
    }

    for (const [name, jobName] of [
      ["ci.yml", "codex-node-checks"],
      ["secret-scan.yml", "gitleaks"],
    ] as const) {
      const job = readWorkflow(name).parsed.jobs[jobName];
      expect(job?.needs, `${name} required job must not need a job`).toBeUndefined();
      const steps = job?.steps ?? [];
      expect(steps[0]?.id, `${name} in-job authorizer is step 1`).toBe(
        "authorize",
      );
      const checkout = steps.findIndex((step) =>
        step.uses?.startsWith("actions/checkout@"),
      );
      expect(steps[checkout]?.with, `${name} pinned checkout`).toMatchObject({
        ref: "${{ steps.authorize.outputs.sha }}",
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
    expect(backup?.needs, "d1-backup authorization dependency").toBe(
      "authorize_release",
    );
    const backupSteps = backup?.steps ?? [];
    const backupCheckout = backupSteps.findIndex((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(
      backupSteps[backupCheckout]?.with,
      "d1-backup pinned checkout",
    ).toMatchObject({
      ref: "${{ needs.authorize_release.outputs.sha }}",
      "fetch-depth": 0,
      clean: true,
      "persist-credentials": false,
    });
    expect(
      backupSteps[backupCheckout + 1]?.name,
      "d1-backup immediate verification",
    ).toMatch(/Verify (?:authorized|pinned)/);
    const backupCas = stepIndex(backup, "Reconfirm frozen main before backup mutation");
    expect(backupCas).toBeGreaterThanOrEqual(0);
    expect(stepIndex(backup, "Run approved D1-to-R2 backup")).toBe(backupCas + 1);
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
    expect(restoreMutation).toBe(restoreCas + 1);
    expect(restore.restore?.steps?.[restoreCas]).toMatchObject({
      run: "./scripts/ci-verify-provider-main-cas.sh",
      env: { GH_TOKEN: "${{ github.token }}" },
    });

    const cleanupMutation = stepIndex(
      restore.cleanup,
      "Delete every exact scratch database from this run",
    );
    expect(cleanupMutation).toBeGreaterThanOrEqual(0);
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

    for (const job of [restore.restore, restore.cleanup]) {
      expect(job?.env).not.toHaveProperty("GH_TOKEN");
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
    expect(providerCas).toContain("TOLERATE_MAIN_DRIFT");
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
grep -Fq 'url = "https://api.github.com/repos/Nishfleet/0509/git/ref/heads/main"' <<< "$config"
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
        GITHUB_REPOSITORY: "Nishfleet/0509",
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
      // Dispatch resolution: authorize pins the exact dispatched candidate,
      // so a run created on a newer main tip (main advanced between dispatch
      // and run start) still pins and deploys the CI-verified dispatched
      // commit. The pin CAS confirms the candidate is an ancestor of live
      // main via the provider CAS.
      writeFileSync(join(work, "descendant.txt"), "descendant\n");
      git(work, "add", "descendant.txt");
      git(work, "commit", "-m", "descendant");
      const descendantSha = git(work, "rev-parse", "HEAD");
      // Pinned candidate equals dispatched candidate even though GITHUB_SHA
      // (run head) is newer; live main (FAKE_REMOTE_SHA) descends from it.
      // The pin job checks out the pinned candidate, mirroring the workflow's
      // checkout ref, so HEAD matches PINNED_SHA.
      git(work, "checkout", "--detach", candidateSha);
      expect(run({
        GITHUB_EVENT_NAME: "workflow_dispatch",
        EXPECTED_SHA: candidateSha,
        GITHUB_SHA: descendantSha,
        PINNED_SHA: candidateSha,
        FAKE_REMOTE_SHA: descendantSha,
      }).status).toBe(0);
      // A rewind/rewrite (pinned candidate not an ancestor of live main)
      // stays fail-closed even when both SHAs are syntactically valid.
      expect(run({
        GITHUB_EVENT_NAME: "workflow_dispatch",
        EXPECTED_SHA: descendantSha,
        GITHUB_SHA: candidateSha,
        PINNED_SHA: descendantSha,
        FAKE_REMOTE_SHA: candidateSha,
      }).status).not.toBe(0);
      expect(run({
        GITHUB_EVENT_NAME: "workflow_dispatch",
        EXPECTED_SHA: candidateSha,
        GITHUB_SHA: "f".repeat(40),
        PINNED_SHA: candidateSha,
        FAKE_REMOTE_SHA: "f".repeat(40),
      }).status).not.toBe(0);
      // Scheduled unattended runs pin main tip with empty expected_sha (same
      // contract as authorize in d1-backup-r2.yml / restore-evidence).
      git(work, "checkout", "--detach", candidateSha);
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
      // Post-gate drift tolerance is opt-in and downgrades ONLY drift: with
      // TOLERATE_MAIN_DRIFT=1 the run deploys the verified pinned SHA even
      // though main moved, printing the explicit "behind main" note; without
      // the flag drift still fails closed. Non-drift remote failures (e.g. a
      // malformed provider SHA) stay hard even with the flag set.
      const tolerated = run({
        FAKE_REMOTE_SHA: "f".repeat(40),
        TOLERATE_MAIN_DRIFT: "1",
      });
      expect(tolerated.status).toBe(0);
      expect(tolerated.stderr).toContain("Deploying pinned SHA");
      expect(tolerated.stderr).toContain(candidateSha);
      expect(tolerated.stderr).toContain("f".repeat(40));
      expect(
        run({
          FAKE_REMOTE_SHA: "not-a-sha",
          TOLERATE_MAIN_DRIFT: "1",
        }).status,
      ).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
