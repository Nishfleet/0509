import { describe, expect, it } from "vitest";

import {
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
});
