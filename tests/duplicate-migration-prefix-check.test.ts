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

  it("the 0067 legacy pair is recorded verbatim in the production ledger baseline so renaming stays impossible", () => {
    // 0067 is fully covered by the append-only production baseline captured
    // 2026-07-30; 0087/0090 applied after the capture and are frozen via the
    // explicit allowlist, so only 0067 has a ledger-provable pair to assert.
    const filesInProd = PRODUCTION_MIGRATION_LEDGER_BASELINE.filter((name) =>
      name.startsWith("0067_"),
    );
    expect(filesInProd.length).toBe(2);
    expect(filesInProd.sort()).toEqual([
      "0067_delivery_recovery_and_digest_jobs.sql",
      "0067_workspace_member_invariants.sql",
    ]);
  });

  it("the real migrations directory passes the gate: every surviving duplicate is a frozen legacy prefix", () => {
    const migrationsDir = join(
      dirname(dirname(fileURLToPath(import.meta.url))),
      "migrations",
    );
    const names = migrationFileNames(migrationsDir);
    expect(names.length).toBeGreaterThan(50);
    const { duplicatePrefixes, offenders } = duplicateMigrationPrefixes(names);
    // The historical pairs must stay frozen and never renumbered: 0067/0087/0090
    // were applied under both spellings before any guard; 0096 was a same-day
    // double-merge (error_reports #2988 + email_suppression #2983, independent
    // tables) frozen at the gate's landing to keep the apply ledger provable.
    expect(duplicatePrefixes.sort()).toEqual(["0067", "0087", "0090", "0096"]);
    expect(offenders.size).toBe(0);
    expect(duplicatePrefixViolation(migrationsDir)).toBeNull();
  });
});
