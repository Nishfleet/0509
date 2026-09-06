import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("D1 backup validator", () => {
  it("covers the latest repo migration dynamically", () => {
    const migrationFiles = readdirSync("migrations")
      .filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName))
      .sort();
    const latestMigration = migrationFiles.at(-1);

    const output = execFileSync(process.execPath, ["scripts/validate-d1-backup.mjs"], {
      encoding: "utf8",
    });
    const payload = JSON.parse(output) as {
      ok: boolean;
      latestMigration: string;
      checkedFiles: string[];
      mode: string;
      retentionPolicy: unknown;
      migrationReplay: {
        migrationsApplied: number;
        userPlanColumns: string[];
        dodoLinkagePreserved: boolean;
      };
    };

    expect(payload.ok).toBe(true);
    expect(payload.mode).toBe("dry-run");
    expect(payload.latestMigration).toBe(latestMigration);
    expect(payload.checkedFiles).toContain(`migrations/${latestMigration}`);
    expect(payload.checkedFiles).toEqual(expect.arrayContaining([
      "scripts/d1-backup-lifecycle-canary.mjs",
      "config/r2-retention-policy.json",
    ]));
    expect(payload.retentionPolicy).toEqual({
      schemaVersion: 1,
      bucket: "0509-landing-page-artifacts",
      applicationManagedPrefixes: ["landing-pages/"],
      rules: [
        { id: "0509-d1-backups-90d", prefix: "backups/d1/", expireDays: 90 },
      ],
    });
    expect(payload.migrationReplay).toMatchObject({
      migrationsApplied: migrationFiles.length,
      dodoLinkagePreserved: true,
    });
    expect(payload.migrationReplay.userPlanColumns).toEqual([
      "user_id",
      "plan",
      "plan_updated_at",
      "dodo_payment_id",
      "dodo_product_id",
      "dodo_status",
      "dodo_subscription_id",
      "dodo_customer_id",
      "dodo_next_billing_at",
      "evidence_entitlement_anchor",
      "evidence_entitlement_anchor_source",
      "dodo_plan_change_product_id",
    ]);
  });
});
