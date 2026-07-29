import { describe, expect, it } from "vitest";

import {
  allowedRemoteMigrationLedgers,
  blockingPendingMigrationNames,
  hasOnlyPostDeployCleanupMigrations,
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
});
