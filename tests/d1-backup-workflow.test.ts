import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("manual D1 backup workflow", () => {
  const workflow = readFileSync(".github/workflows/d1-backup-r2.yml", "utf8");
  const parsed = parse(workflow) as {
    on: {
      workflow_dispatch?: {
        inputs?: Record<string, {
          required?: boolean;
          type?: string;
        }>;
      };
      schedule?: Array<{ cron?: string }>;
    };
    jobs: {
      authorize_release?: {
        permissions?: Record<string, string>;
        outputs?: Record<string, string>;
        steps?: Array<{
          name?: string;
          run?: string;
          env?: Record<string, string>;
          uses?: string;
        }>;
      };
      backup?: {
        if?: string;
        needs?: string;
        permissions?: Record<string, string>;
        environment?: string;
        env?: Record<string, string>;
        steps?: Array<{
          name?: string;
          if?: string;
          run?: string;
          env?: Record<string, string>;
          uses?: string;
          with?: Record<string, unknown>;
        }>;
      };
    };
  };

  it("runs the existing D1-to-R2 backup script only after exact authorization", () => {
    expect(parsed.on.workflow_dispatch?.inputs?.expected_sha).toMatchObject({
      required: true,
      type: "string",
    });
    // Nightly, from 2026-08-07. This previously asserted NO schedule, which is
    // why the repo went a week with no automated backup at all: the workflow
    // ran on push, failed at startup every time because the authorization below
    // demands workflow_dispatch, and the push trigger was removed to stop the
    // noise. Nothing then took its place. Pinned exactly, so the hour cannot
    // drift out of the low-traffic window unnoticed.
    expect(parsed.on.schedule).toEqual([{ cron: "7 20 * * *" }]);
    const authorize = parsed.jobs.authorize_release;
    expect(authorize?.permissions).toEqual({});
    expect(authorize?.outputs?.sha).toBe("${{ steps.authorize.outputs.sha }}");
    expect(JSON.stringify(authorize)).not.toMatch(
      /actions\/checkout|secrets\.|wrangler|cloudflare/i,
    );
    const authorizeScript = authorize?.steps?.[0]?.run;
    expect(authorizeScript).toBe([
      "set -euo pipefail",
      "sha_pattern='^[a-f0-9]{40}$'",
      'test "$GITHUB_REPOSITORY" = "Nishfleet/0509"',
      'test "$GITHUB_REF" = "refs/heads/main"',
      'test "$GITHUB_RUN_ATTEMPT" = "1"',
      '[[ "$GITHUB_SHA" =~ $sha_pattern ]]',
      '# Same shape as d1-remote-restore-evidence.yml: a scheduled run backs',
      '# up whatever main is and must NOT carry an expected_sha, so nothing',
      '# can smuggle a chosen commit into an unattended run. A manual run',
      '# still has to name the exact commit and have it match.',
      // Scheduled runs back up whatever main is and must carry NO expected_sha,
      // so nothing can smuggle a chosen commit into an unattended run. Manual
      // runs still have to name the exact commit and have it match. Same shape
      // as d1-remote-restore-evidence.yml, which has always had both triggers.
      'case "$GITHUB_EVENT_NAME" in',
      '  schedule)',
      '    test -z "$EXPECTED_SHA"',
      '    ;;',
      '  workflow_dispatch)',
      '    [[ "$EXPECTED_SHA" =~ $sha_pattern ]]',
      '    test "$EXPECTED_SHA" = "$GITHUB_SHA"',
      '    ;;',
      '  *)',
      '    exit 1',
      '    ;;',
      'esac',
      "printf 'sha=%s\\n' \"$GITHUB_SHA\" >> \"$GITHUB_OUTPUT\"",
      "",
    ].join("\n"));
    expect(parsed.jobs.backup?.if).toBe(
      "needs.authorize_release.result == 'success'",
    );
    expect(parsed.jobs.backup?.needs).toBe("authorize_release");
    expect(parsed.jobs.backup?.permissions).toEqual({ contents: "read" });
    expect(parsed.jobs.backup?.environment).toBe("production");

    const steps = parsed.jobs.backup?.steps ?? [];
    const checkouts = steps.filter((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkouts).toHaveLength(1);
    const checkoutIndex = steps.indexOf(checkouts[0]);
    expect(steps[checkoutIndex]?.with).toMatchObject({
      ref: "${{ needs.authorize_release.outputs.sha }}",
      "fetch-depth": 0,
      clean: true,
      "persist-credentials": false,
    });

    const backupSteps = steps.map((step) => step.run).filter(Boolean);
    expect(backupSteps?.some((run) =>
      run?.includes("node scripts/d1-backup-to-r2.mjs")
    ))
      .toBe(true);
  });

  it("keeps backup auth scoped to the approved backup step and validates before upload", () => {
    expect(parsed.jobs.backup?.env?.CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
    expect(parsed.jobs.backup?.env?.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(parsed.jobs.backup?.env?.D1_BACKUP_LOCAL_DIRECTORY).toBeUndefined();

    const steps = parsed.jobs.backup?.steps ?? [];
    const bindingIndex = steps.findIndex(
      (step) => step.name === "Bind run-scoped backup directory",
    );
    expect(bindingIndex).toBeGreaterThanOrEqual(0);
    const bindingStep = steps[bindingIndex];
    expect(bindingStep?.run).toContain("D1_BACKUP_LOCAL_DIRECTORY=%s");
    expect(bindingStep?.run).toContain(
      "$RUNNER_TEMP/0509-d1-backups-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}",
    );
    expect(bindingStep?.run).toContain('>> "$GITHUB_ENV"');
    expect(steps).toContainEqual(expect.objectContaining({
      run: "./scripts/deploy-window-lock.sh run -- npm ci --ignore-scripts",
    }));
    const backupStep = steps.find(
      (step) => step.name === "Run approved D1-to-R2 backup",
    );
    const acquireIndex = steps.findIndex(
      (step) => step.name === "Acquire provider lane",
    );
    const casIndex = steps.findIndex(
      (step) => step.name === "Reconfirm frozen main before backup mutation",
    );
    const backupStepIndex = steps.findIndex(
      (step) => step.name === "Run approved D1-to-R2 backup",
    );
    const providerSecretSteps = steps.filter(
      (step) =>
        step.env?.CLOUDFLARE_ACCOUNT_ID !== undefined ||
        step.env?.CLOUDFLARE_API_TOKEN !== undefined,
    );
    expect(providerSecretSteps).toHaveLength(1);
    expect(providerSecretSteps[0]).toBe(backupStep);
    for (const step of steps.slice(0, acquireIndex)) {
      expect(step.run ?? "").not.toMatch(/\bwrangler\b|d1-backup-to-r2\.mjs/);
    }
    expect(casIndex).toBe(acquireIndex + 1);
    expect(backupStepIndex).toBe(casIndex + 1);
    expect(steps[casIndex]).toMatchObject({
      run: "./scripts/ci-verify-production-candidate.sh",
      env: { GH_TOKEN: "${{ github.token }}" },
    });
    expect(backupStep?.run).toBe("node scripts/d1-backup-to-r2.mjs");
    expect(backupStep?.env?.CLOUDFLARE_ACCOUNT_ID).toBe("${{ secrets.CLOUDFLARE_ACCOUNT_ID }}");
    expect(backupStep?.env?.CLOUDFLARE_API_TOKEN).toBe("${{ secrets.CLOUDFLARE_API_TOKEN }}");
    expect(backupStep?.env?.D1_BACKUP_AUTOMATION_APPROVED).toBe("0509-weekly-d1-to-r2");

    const backupSteps = steps.map((step) => step.run).filter(Boolean);
    const validationCommand =
      "./scripts/deploy-window-lock.sh run -- node scripts/validate-d1-backup.mjs";
    expect(backupSteps.indexOf(validationCommand)).toBeGreaterThanOrEqual(0);
    const backupIndex = backupSteps.findIndex((run) =>
      run?.includes("node scripts/d1-backup-to-r2.mjs"),
    );
    expect(
      steps.findIndex((step) =>
        step.run?.includes("node scripts/d1-backup-to-r2.mjs")
      ),
    ).toBeGreaterThan(bindingIndex);
    expect(backupIndex).toBeGreaterThan(
      backupSteps.indexOf(validationCommand),
    );
    expect(
      steps.find((step) => step.name === "Release provider lane"),
    ).toMatchObject({
      if: "always()",
      run: "./scripts/deploy-window-lock.sh release",
    });
    expect(
      steps.find((step) => step.name === "Remove provider-lane capability file"),
    ).toMatchObject({ if: "always()" });
    expect(workflow).not.toMatch(/api[_-]?token:\s*['\"]/i);
  });

  it("revalidates when the lifecycle canary or committed retention policy changes", () => {
    const validationWorkflow = readFileSync(".github/workflows/d1-backup-validate.yml", "utf8");
    expect(validationWorkflow).toContain('"scripts/d1-backup*.mjs"');
    expect(validationWorkflow).toContain('"config/r2-retention-policy.json"');
  });

  it("documents that Actions backups are proven end-to-end since 2026-07-13", () => {
    const opsDoc = readFileSync("docs/ops-backup-uptime.md", "utf8");
    expect(opsDoc).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(opsDoc).toContain("CLOUDFLARE_API_TOKEN");
    expect(opsDoc).toContain("workflow_dispatch");
    expect(opsDoc).toContain("Unblocked 2026-07-13");
    expect(opsDoc).toContain("first successful Actions backup end-to-end");
  });
});
