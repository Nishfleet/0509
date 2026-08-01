import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("manual D1 backup workflow", () => {
  const workflow = readFileSync(".github/workflows/d1-backup-r2.yml", "utf8");
  const parsed = parse(workflow) as {
    on: {
      workflow_dispatch?: unknown;
      schedule?: Array<{ cron?: string }>;
    };
    jobs: {
      backup?: {
        if?: string;
        needs?: string;
        environment?: string;
        env?: Record<string, string>;
        steps?: Array<{ name?: string; run?: string; env?: Record<string, string> }>;
      };
    };
  };

  it("runs the existing D1-to-R2 backup script only after exact authorization", () => {
    expect(parsed.on.workflow_dispatch).toBeDefined();
    expect(parsed.on.schedule).toBeUndefined();
    expect(parsed.jobs.backup?.if).toBe(
      "needs.authorize_release.result == 'success'",
    );
    expect(parsed.jobs.backup?.needs).toBe("authorize_release");
    expect(parsed.jobs.backup?.environment).toBe("production");

    const backupSteps = parsed.jobs.backup?.steps
      ?.map((step) => step.run)
      .filter(Boolean);
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
