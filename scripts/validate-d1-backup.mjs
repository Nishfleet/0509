import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";

const requiredSupportFiles = [
  "scripts/d1-backup-to-r2.mjs",
  "scripts/d1-backup-local-cleanup.mjs",
  "scripts/d1-backup-local-storage.mjs",
  "scripts/d1-backup.mjs",
  "scripts/d1-backup-lifecycle-canary.mjs",
  "scripts/d1-restore-transform.mjs",
  "config/r2-retention-policy.json",
  "wrangler.jsonc",
];
const migrationsDir = resolve("migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error("No D1 migration files found.");
}

const requiredFiles = [
  ...requiredSupportFiles,
  ...migrationFiles.map((fileName) => join("migrations", fileName)),
];

for (const relativePath of requiredFiles) {
  const absolutePath = resolve(relativePath);
  readFileSync(absolutePath, "utf8");
}

const wrangler = readFileSync(resolve("wrangler.jsonc"), "utf8");
if (!wrangler.includes('"d1_databases"') || !wrangler.includes('"database_name": "0509"')) {
  throw new Error("wrangler.jsonc is missing the 0509 D1 database binding.");
}

const retentionPolicy = JSON.parse(readFileSync(resolve("config/r2-retention-policy.json"), "utf8"));
const expectedRetentionPolicy = {
  schemaVersion: 1,
  bucket: "0509-landing-page-artifacts",
  applicationManagedPrefixes: ["landing-pages/"],
  rules: [
    { id: "0509-d1-backups-90d", prefix: "backups/d1/", expireDays: 90 },
  ],
};
if (!isDeepStrictEqual(retentionPolicy, expectedRetentionPolicy)) {
  throw new Error("config/r2-retention-policy.json does not match the approved R2 retention policy.");
}

function applyMigrationsToScratchDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  const seededBillingRow = {
    userId: "migration-smoke-user",
    plan: "starter",
    dodoPaymentId: "dodo_payment_smoke",
    dodoProductId: "dodo_product_smoke",
    dodoStatus: "active",
    dodoSubscriptionId: "dodo_subscription_smoke",
    dodoCustomerId: "dodo_customer_smoke",
    dodoNextBillingAt: "2026-07-01T00:00:00.000Z",
    evidenceEntitlementAnchor: "subscription:dodo_subscription_smoke",
    evidenceEntitlementAnchorSource: "dodo_subscription",
  };

  try {
    sqlite.exec("PRAGMA foreign_keys = ON;");
    for (const fileName of migrationFiles) {
      if (fileName === "0060_remove_legacy_billing_provider.sql") {
        seedBillingRow(sqlite, seededBillingRow);
      }
      sqlite.exec(readFileSync(resolve("migrations", fileName), "utf8"));
    }

    const userPlanColumns = sqlite
      .prepare("PRAGMA table_info(user_plan)")
      .all()
      .map((row) => String(row.name));
    const expectedUserPlanColumns = [
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
    ];
    if (userPlanColumns.join(",") !== expectedUserPlanColumns.join(",")) {
      throw new Error(`user_plan schema mismatch after migration replay: ${userPlanColumns.join(",")}`);
    }

    const row = sqlite
      .prepare(
        `SELECT plan, dodo_payment_id, dodo_product_id, dodo_status, dodo_subscription_id,
                dodo_customer_id, dodo_next_billing_at, evidence_entitlement_anchor,
                evidence_entitlement_anchor_source
           FROM user_plan
         WHERE user_id = ?`,
      )
      .get(seededBillingRow.userId);
    if (!row) {
      throw new Error("seeded user_plan row was lost during migration replay.");
    }
    const dodoLinkagePreserved =
      row.plan === seededBillingRow.plan &&
      row.dodo_payment_id === seededBillingRow.dodoPaymentId &&
      row.dodo_product_id === seededBillingRow.dodoProductId &&
      row.dodo_status === seededBillingRow.dodoStatus &&
      row.dodo_subscription_id === seededBillingRow.dodoSubscriptionId &&
      row.dodo_customer_id === seededBillingRow.dodoCustomerId &&
      row.dodo_next_billing_at === seededBillingRow.dodoNextBillingAt &&
      row.evidence_entitlement_anchor === seededBillingRow.evidenceEntitlementAnchor &&
      row.evidence_entitlement_anchor_source === seededBillingRow.evidenceEntitlementAnchorSource;
    if (!dodoLinkagePreserved) {
      throw new Error("Dodo linkage or evidence entitlement anchor was not preserved during migration replay.");
    }

    return {
      migrationsApplied: migrationFiles.length,
      userPlanColumns,
      dodoLinkagePreserved: true,
    };
  } finally {
    sqlite.close();
  }
}

/**
 * @param {DatabaseSync} sqlite
 * @param {{
 *   userId: string,
 *   plan: string,
 *   dodoPaymentId: string,
 *   dodoProductId: string,
 *   dodoStatus: string,
 *   dodoSubscriptionId: string,
 *   dodoCustomerId: string,
 *   dodoNextBillingAt: string,
 *   evidenceEntitlementAnchor: string,
 *   evidenceEntitlementAnchorSource: string
 * }} input
 */
function seedBillingRow(sqlite, input) {
  sqlite
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .run(input.userId, "Migration Smoke", "migration-smoke@example.test", "2026-06-27", "2026-06-27");
  sqlite
    .prepare(
      `INSERT INTO user_plan (
        user_id, plan, stripe_customer_id, stripe_subscription_id, plan_updated_at,
        dodo_payment_id, dodo_product_id, dodo_status, dodo_subscription_id, dodo_customer_id,
        dodo_next_billing_at, evidence_entitlement_anchor, evidence_entitlement_anchor_source
      )
      VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.userId,
      input.plan,
      "2026-06-27T00:00:00.000Z",
      input.dodoPaymentId,
      input.dodoProductId,
      input.dodoStatus,
      input.dodoSubscriptionId,
      input.dodoCustomerId,
      input.dodoNextBillingAt,
      input.evidenceEntitlementAnchor,
      input.evidenceEntitlementAnchorSource,
    );
}

const migrationReplay = applyMigrationsToScratchDatabase();

console.log(
  JSON.stringify({
    ok: true,
    mode: "dry-run",
    checkedFiles: requiredFiles,
    retentionPolicy,
    latestMigration: migrationFiles.at(-1),
    migrationReplay,
    message: "Backup scripts and D1 binding are present. Remote export/upload was not executed.",
  }),
);
