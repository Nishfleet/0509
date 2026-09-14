import { describe, expect, it } from "vitest";

import {
  POST_DEPLOY_CLEANUP_MIGRATIONS,
  PRODUCTION_MIGRATION_LEDGER_BASELINE,
  PRODUCTION_MIGRATION_LEDGER_BASELINE_SHA256,
  RETIRED_PRODUCTION_MIGRATIONS,
  allowedRemoteMigrationLedgers,
  blockingPendingMigrationNames,
  hasOnlyPostDeployCleanupMigrations,
  inspectProductionMigrationLedger,
  migrationLedgerNamesSha256,
  pendingMigrationNames,
  productionMigrationLedgerRule,
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

  it("derives the production ledger contract from baseline, repository, and retire list", () => {
    const repositoryBaseline = PRODUCTION_MIGRATION_LEDGER_BASELINE.filter(
      (name) => !RETIRED_PRODUCTION_MIGRATIONS.has(name),
    );
    const next = "0071_next_migration.sql";
    const repository = [...repositoryBaseline, next];
    expect(
      inspectProductionMigrationLedger(
        [...PRODUCTION_MIGRATION_LEDGER_BASELINE, next],
        repository,
        new Set(),
      ),
    ).toEqual({ ok: true, pending: [], blockingPending: [] });
    expect(
      inspectProductionMigrationLedger(
        [...PRODUCTION_MIGRATION_LEDGER_BASELINE],
        repository,
        new Set(),
      ),
    ).toEqual({ ok: true, pending: [next], blockingPending: [next] });
    expect(PRODUCTION_MIGRATION_LEDGER_BASELINE_SHA256).toBe(
      migrationLedgerNamesSha256([...PRODUCTION_MIGRATION_LEDGER_BASELINE]),
    );
    expect(productionMigrationLedgerRule(repository, new Set())).toMatchObject({
      baselineSha256: PRODUCTION_MIGRATION_LEDGER_BASELINE_SHA256,
      baseline: [...PRODUCTION_MIGRATION_LEDGER_BASELINE],
      repositoryMigrations: repository,
      retiredMigrations: [...RETIRED_PRODUCTION_MIGRATIONS],
      cleanupMigrations: [],
    });
  });

  it("matches the production ledger exactly with no cleanup allowance", () => {
    const repositoryBaseline = PRODUCTION_MIGRATION_LEDGER_BASELINE.filter(
      (name) => !RETIRED_PRODUCTION_MIGRATIONS.has(name),
    );
    const repositorySuffix = [
      "0071_release_observation_redispatch_failures.sql",
      "0072_scheduled_observation_health_state.sql",
      "0073_cron_failure_alert_attempt_evidence.sql",
      "0074_provider_neutral_discovery_failures.sql",
      "0075_teams_delivery.sql",
      "0076_browser_job_telemetry.sql",
      "0077_competitor_site_monitoring.sql",
    ];
    const repository = [...repositoryBaseline, ...repositorySuffix];
    const productionLedger = [
      ...PRODUCTION_MIGRATION_LEDGER_BASELINE,
      ...repositorySuffix,
    ];
    // POST_DEPLOY_CLEANUP_MIGRATIONS is empty (2026-08-26 auditor fix):
    // 0077 was never a destructive cleanup — it is a live migration still
    // present in the repo and applied to production. With an empty set a
    // production ledger trailing 0077 is a genuine drift that must block
    // (the migration must be applied, not silently waved through as
    // "cleanup").
    expect(
      inspectProductionMigrationLedger(
        productionLedger,
        repository,
        POST_DEPLOY_CLEANUP_MIGRATIONS,
      ),
    ).toEqual({ ok: true, pending: [], blockingPending: [] });
    expect(
      inspectProductionMigrationLedger(
        productionLedger.slice(0, -1),
        repository,
        POST_DEPLOY_CLEANUP_MIGRATIONS,
      ),
    ).toEqual({
      ok: true,
      pending: ["0077_competitor_site_monitoring.sql"],
      blockingPending: ["0077_competitor_site_monitoring.sql"],
    });
    const output = `
Migrations to be applied:
┌────────────────────────────────────────────────────┐
│ Name                                               │
├────────────────────────────────────────────────────┤
│ 0077_competitor_site_monitoring.sql                │
└────────────────────────────────────────────────────┘
`;
    expect(hasOnlyPostDeployCleanupMigrations(output)).toBe(false);
    expect(blockingPendingMigrationNames(output)).toEqual([
      "0077_competitor_site_monitoring.sql",
    ]);
  });

  it("explains post-baseline names by membership, rename alias, or retire list and rejects the rest", () => {
    const baseline = ["0001_first.sql", "0002_second.sql"];
    const options = { baseline, retiredMigrations: new Set<string>() };
    const repository = [
      "0001_first.sql",
      "0002_second.sql",
      "0003_a.sql",
      "0004_b.sql",
      "0005_renamed.sql",
    ];
    // Production applied 0004_b before 0003_a landed — an order the sorted
    // repository cannot enumerate, explainable by membership alone. No
    // per-incident order declaration is needed.
    expect(
      inspectProductionMigrationLedger(
        [...baseline, "0004_b.sql", "0003_a.sql"],
        repository,
        new Set(),
        options,
      ),
    ).toEqual({
      ok: true,
      pending: ["0005_renamed.sql"],
      blockingPending: ["0005_renamed.sql"],
    });
    // A renumbered file explains its stale production name: 0004_renamed
    // was applied before the file shipped as 0005_renamed.
    expect(
      inspectProductionMigrationLedger(
        [...baseline, "0004_renamed.sql"],
        repository,
        new Set(),
        options,
      ),
    ).toEqual({
      ok: true,
      pending: ["0003_a.sql", "0004_b.sql", "0005_renamed.sql"],
      blockingPending: ["0003_a.sql", "0004_b.sql", "0005_renamed.sql"],
    });
    // An ambiguous name body (two repository files share it) explains
    // nothing — fail closed.
    expect(
      inspectProductionMigrationLedger(
        [...baseline, "0004_renamed.sql"],
        [...repository, "0006_renamed.sql"],
        new Set(),
        options,
      ),
    ).toEqual({
      ok: false,
      reason: "unexplained",
      unexplained: ["0004_renamed.sql"],
    });
    // A post-baseline name the repository deleted is explainable only while
    // the retire list declares it.
    expect(
      inspectProductionMigrationLedger(
        [...baseline, "0009_deleted.sql"],
        repository,
        new Set(),
        { baseline, retiredMigrations: new Set(["0009_deleted.sql"]) },
      ),
    ).toEqual({
      ok: true,
      pending: ["0003_a.sql", "0004_b.sql", "0005_renamed.sql"],
      blockingPending: ["0003_a.sql", "0004_b.sql", "0005_renamed.sql"],
    });
    expect(
      inspectProductionMigrationLedger(
        [...baseline, "0009_deleted.sql"],
        repository,
        new Set(),
        options,
      ),
    ).toEqual({
      ok: false,
      reason: "unexplained",
      unexplained: ["0009_deleted.sql"],
    });
  });

  it("fails closed on a reordered baseline prefix, duplicates, and invalid retired names", () => {
    const baseline = ["0001_first.sql", "0002_retired.sql"];
    const retired = new Set(["0002_retired.sql"]);
    const options = { baseline, retiredMigrations: retired };
    const repository = ["0001_first.sql", "0003_next.sql"];
    expect(
      inspectProductionMigrationLedger(
        ["0001_first.sql", "0002_retired.sql"],
        repository,
        new Set(),
        options,
      ),
    ).toEqual({
      ok: true,
      pending: ["0003_next.sql"],
      blockingPending: ["0003_next.sql"],
    });
    // A reordered, truncated, or foreign recorded prefix is not explainable.
    expect(
      inspectProductionMigrationLedger(
        ["0002_retired.sql", "0001_first.sql", "0003_next.sql"],
        repository,
        new Set(),
        options,
      ),
    ).toEqual({ ok: false, reason: "baseline_prefix" });
    expect(
      inspectProductionMigrationLedger(
        ["0001_first.sql"],
        repository,
        new Set(),
        options,
      ),
    ).toEqual({ ok: false, reason: "baseline_prefix" });
    expect(
      inspectProductionMigrationLedger(
        ["0001_first.sql", "0002_retired.sql", "0002_retired.sql"],
        repository,
        new Set(),
        options,
      ),
    ).toEqual({ ok: false, reason: "invalid" });
    // A retired name still shipping in the repository is a stale declaration.
    expect(() =>
      inspectProductionMigrationLedger(
        [...baseline],
        ["0001_first.sql", "0002_retired.sql"],
        new Set(),
        options,
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
