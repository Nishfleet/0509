import { describe, expect, it } from "vitest";

import {
  PRODUCTION_MIGRATION_LEDGER_BASELINE,
  PRODUCTION_MIGRATION_LEDGER_BASELINE_SHA256,
  RETIRED_PRODUCTION_MIGRATIONS,
  allowedProductionMigrationLedgers,
  allowedRemoteMigrationLedgers,
  blockingPendingMigrationNames,
  hasOnlyPostDeployCleanupMigrations,
  migrationLedgerNamesSha256,
  pendingMigrationNames,
} from "../scripts/d1-migration-sync-check.lib.mjs";

describe("D1 migration sync check", () => {
  it("blocks the retired-provider cleanup migration after release closeout", () => {
    const output = `
Migrations to be applied:
┌─────────────────────────────────────────┐
│ Name                                    │
├─────────────────────────────────────────┤
│ 0060_remove_legacy_billing_provider.sql │
└─────────────────────────────────────────┘
`;

    expect(pendingMigrationNames(output)).toEqual(["0060_remove_legacy_billing_provider.sql"]);
    expect(blockingPendingMigrationNames(output)).toEqual(["0060_remove_legacy_billing_provider.sql"]);
    expect(hasOnlyPostDeployCleanupMigrations(output)).toBe(false);
  });

  it("continues to block ordinary unapplied migrations", () => {
    const output = `
Migrations to be applied:
┌─────────────────────────────────────────┐
│ Name                                    │
├─────────────────────────────────────────┤
│ 0061_add_new_runtime_table.sql          │
└─────────────────────────────────────────┘
`;

    expect(pendingMigrationNames(output)).toEqual(["0061_add_new_runtime_table.sql"]);
    expect(blockingPendingMigrationNames(output)).toEqual(["0061_add_new_runtime_table.sql"]);
    expect(hasOnlyPostDeployCleanupMigrations(output)).toBe(false);
  });

  it("allows only a contiguous post-deploy cleanup suffix to remain pending", () => {
    const repository = [
      "0001_first.sql",
      "0002_compatible.sql",
      "0003_destructive_cleanup.sql",
      "0004_final_cleanup.sql",
    ];
    expect(
      allowedRemoteMigrationLedgers(
        repository,
        new Set([
          "0003_destructive_cleanup.sql",
          "0004_final_cleanup.sql",
        ]),
      ),
    ).toEqual([repository, repository.slice(0, 2)]);
    expect(() =>
      allowedRemoteMigrationLedgers(
        repository,
        new Set(["0002_compatible.sql"]),
      ),
    ).toThrow("post_deploy_cleanup_migration_allowlist_invalid");
    expect(() =>
      allowedRemoteMigrationLedgers(
        repository,
        new Set(["9999_missing.sql"]),
      ),
    ).toThrow("post_deploy_cleanup_migration_allowlist_invalid");
  });

  it("reconciles the immutable production baseline with retired files and new suffixes", () => {
    const repositoryBaseline = PRODUCTION_MIGRATION_LEDGER_BASELINE.filter(
      (name) => !RETIRED_PRODUCTION_MIGRATIONS.has(name),
    );
    const next = "0071_next_migration.sql";
    expect(
      allowedProductionMigrationLedgers([...repositoryBaseline, next]),
    ).toEqual([[...PRODUCTION_MIGRATION_LEDGER_BASELINE, next]]);
    expect(PRODUCTION_MIGRATION_LEDGER_BASELINE_SHA256).toBe(
      migrationLedgerNamesSha256([...PRODUCTION_MIGRATION_LEDGER_BASELINE]),
    );
  });

  it("fails closed on baseline drift, duplicates, and invalid retired names", () => {
    const baseline = ["0001_first.sql", "0002_retired.sql"];
    const retired = new Set(["0002_retired.sql"]);
    expect(
      allowedProductionMigrationLedgers(
        ["0001_first.sql", "0003_next.sql"],
        new Set(),
        baseline,
        retired,
      ),
    ).toEqual([["0001_first.sql", "0002_retired.sql", "0003_next.sql"]]);
    expect(() =>
      allowedProductionMigrationLedgers(
        ["0000_reordered.sql", "0001_first.sql"],
        new Set(),
        baseline,
        retired,
      ),
    ).toThrow("migration_repository_baseline_drift");
    expect(() =>
      allowedProductionMigrationLedgers(
        ["0001_first.sql", "0002_retired.sql"],
        new Set(),
        baseline,
        retired,
      ),
    ).toThrow("retired_production_migration_set_invalid");
    expect(() =>
      migrationLedgerNamesSha256([
        "0001_first.sql",
        "0001_first.sql",
      ]),
    ).toThrow("migration_ledger_names_invalid");
  });
});
