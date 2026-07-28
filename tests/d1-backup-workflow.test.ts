import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("scheduled D1 backup workflow", () => {
  const workflow = readFileSync(".github/workflows/d1-backup-r2.yml", "utf8");
  const parsed = parse(workflow) as {
    on: {
      workflow_dispatch?: unknown;
      schedule?: Array<{ cron?: string }>;
    };
    jobs: {
      backup?: {
        if?: string;
        environment?: string;
        env?: Record<string, string>;
        steps?: Array<{ name?: string; run?: string; env?: Record<string, string> }>;
      };
    };
  };

  it("runs the existing D1-to-R2 backup script on a weekly schedule", () => {
    expect(parsed.on.workflow_dispatch).toBeDefined();
    expect(parsed.on.schedule).toEqual([{ cron: "17 22 * * SUN" }]);
    expect(parsed.jobs.backup?.if).toBe(
      "github.repository == 'nish3451/0509' && github.ref == 'refs/heads/main'",
    );
    expect(parsed.jobs.backup?.environment).toBe("d1-backup-r2");

    const backupSteps = parsed.jobs.backup?.steps?.map((step) => step.run).filter(Boolean);
    expect(backupSteps).toContain("npm run backup:d1:r2");
  });

  it("keeps backup auth scoped to the approved backup step and validates before upload", () => {
    expect(parsed.jobs.backup?.env?.CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
    expect(parsed.jobs.backup?.env?.CLOUDFLARE_API_TOKEN).toBeUndefined();

    const steps = parsed.jobs.backup?.steps ?? [];
    expect(steps).toContainEqual(expect.objectContaining({ run: "npm ci --ignore-scripts" }));
    const backupStep = steps.find((step) => step.run === "npm run backup:d1:r2");
    expect(backupStep?.env?.CLOUDFLARE_ACCOUNT_ID).toBe("${{ secrets.CLOUDFLARE_ACCOUNT_ID }}");
    expect(backupStep?.env?.CLOUDFLARE_API_TOKEN).toBe("${{ secrets.CLOUDFLARE_API_TOKEN }}");
    expect(backupStep?.env?.D1_BACKUP_AUTOMATION_APPROVED).toBe("0509-weekly-d1-to-r2");

    const backupSteps = steps.map((step) => step.run).filter(Boolean);
    expect(backupSteps.indexOf("node scripts/validate-d1-backup.mjs")).toBeGreaterThanOrEqual(0);
    expect(backupSteps.indexOf("npm run backup:d1:r2")).toBeGreaterThan(
      backupSteps.indexOf("node scripts/validate-d1-backup.mjs"),
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
