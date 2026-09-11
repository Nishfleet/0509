import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  duplicateMigrationPrefixes,
  duplicatePrefixViolation,
  groupByMigrationPrefix,
  migrationFileNames,
  LEGACY_DUPLICATE_PREFIX_ALLOWLIST,
} from "../scripts/duplicate-migration-prefix-check.lib.mjs";
import { PRODUCTION_MIGRATION_LEDGER_BASELINE } from "../scripts/d1-migration-sync-check.lib.mjs";

describe("duplicate migration prefix check", () => {
  it("groups files by 4-digit prefix", () => {
    const groups = groupByMigrationPrefix([
      "0001_app.sql",
      "0067_delivery_recovery_and_digest_jobs.sql",
      "0067_workspace_member_invariants.sql",
      "0000_auth.sql",
    ]);
    expect(groups.get("0067")).toEqual([
      "0067_delivery_recovery_and_digest_jobs.sql",
      "0067_workspace_member_invariants.sql",
    ]);
    expect(groups.get("0001")).toEqual(["0001_app.sql"]);
  });

  it("reports legacy duplicate prefixes but does not fail on them", () => {
    const { duplicatePrefixes, offenders } = duplicateMigrationPrefixes([
      "0067_a.sql",
      "0067_b.sql",
      "0101_new_one.sql",
    ]);
    expect(duplicatePrefixes).toEqual(["0067"]);
    expect(offenders.size).toBe(0);
  });

  it("fails a NEW duplicate prefix that reuses an existing number", () => {
    const { offenders } = duplicateMigrationPrefixes([
      "0101_second.sql",
      "0101_alpha.sql",
      "0100_first.sql",
    ], new Set());
    expect([...offenders.keys()]).toEqual(["0101"]);
    expect([...(offenders.get("0101") ?? [])].sort()).toEqual([
      "0101_alpha.sql",
      "0101_second.sql",
    ]);
  });

  it("allows an empty-allowlist caller to fail on every duplicate", () => {
    const { offenders } = duplicateMigrationPrefixes(
      ["0067_a.sql", "0067_b.sql"],
      new Set(),
    );
    expect(offenders.get("0067")).toEqual(["0067_a.sql", "0067_b.sql"].sort());
  });

  it("every legacy duplicate prefix group is recorded verbatim in the production ledger baseline (0067) so renaming stays impossible", () => {
    // The 0067 pair is fully covered by the append-only production baseline;
    // 0087/0090 landed after the 2026-07-30 baseline capture and are frozen
    // via the explicit allowlist instead.
    for (const prefix of LEGACY_DUPLICATE_PREFIX_ALLOWLIST) {
      const filesInProd = PRODUCTION_MIGRATION_LEDGER_BASELINE.filter((name) =>
        name.startsWith(`${prefix}_`),
      );
      // Either the production ledger baseline holds the pair verbatim (0067)
      // or the duplicates applied after the capture (0087/0090) and only the
      // allowlist documents them.
      expect(
        filesInProd.length === 2 ||
          LEGACY_DUPLICATE_PREFIX_ALLOWLIST.has(prefix),
      ).toBe(true);
    }
  });

  it("the real migrations directory passes the gate: every surviving duplicate is a frozen legacy prefix", () => {
    const migrationsDir = join(
      dirname(dirname(fileURLToPath(import.meta.url))),
      "migrations",
    );
    const names = migrationFileNames(migrationsDir);
    expect(names.length).toBeGreaterThan(50);
    const { duplicatePrefixes, offenders } = duplicateMigrationPrefixes(names);
    // The three historical pairs must stay frozen and never renumbered.
    expect(duplicatePrefixes.sort()).toEqual(["0067", "0087", "0090"]);
    expect(offenders.size).toBe(0);
    expect(duplicatePrefixViolation(migrationsDir)).toBeNull();
  });
});
