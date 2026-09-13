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
    const { offenders } = duplicateMigrationPrefixes(
      [
        "0101_second.sql",
        "0101_alpha.sql",
        "0100_first.sql",
      ],
      new Map(),
    );
    expect([...offenders.keys()]).toEqual(["0101"]);
    expect([...(offenders.get("0101") ?? [])].sort()).toEqual([
      "0101_alpha.sql",
      "0101_second.sql",
    ]);
  });

  it("allows an empty-allowlist caller to fail on every duplicate", () => {
    const { offenders } = duplicateMigrationPrefixes(
      ["0067_a.sql", "0067_b.sql"],
      new Map(),
    );
    expect(offenders.get("0067")).toEqual(["0067_a.sql", "0067_b.sql"].sort());
  });

  it("a frozen legacy prefix exceeding its frozen count fails — a 3rd 0067 or a 4th 0098 is a NEW duplicate, the cap keeps the gate's teeth", () => {
    // 0067 is frozen at exactly its two applied files: a third file sharing
    // the prefix would be a new ambiguous-apply-order duplicate, not history.
    const { offenders } = duplicateMigrationPrefixes([
      "0067_delivery_recovery_and_digest_jobs.sql",
      "0067_workspace_member_invariants.sql",
      "0067_third_arrival.sql",
    ]);
    expect(offenders.get("0067")).toEqual([
      "0067_delivery_recovery_and_digest_jobs.sql",
      "0067_third_arrival.sql",
      "0067_workspace_member_invariants.sql",
    ].sort());
    // And the 0098 trio is frozen at exactly three — a 4th fails the same way.
    expect(
      duplicateMigrationPrefixes([
        "0098_email_delivery_canary.sql",
        "0098_widen_source_target_connector_bluesky.sql",
        "0098_widen_source_target_connector_gdelt.sql",
        "0098_fourth.sql",
      ]).offenders.get("0098"),
    ).toHaveLength(4);
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
    // The historical duplicates must stay frozen and never renumbered:
    // 0067/0087/0090 were applied under both spellings before any guard; 0096
    // was a same-day double-merge (error_reports #2988 + email_suppression
    // #2983, independent tables); 0098 is a trio (email_delivery_canary, plus
    // the bluesky/gdelt same-table source_target widen pair #3252/#3251 whose
    // surviving CHECK is whichever applies LAST) frozen at the count this
    // guard adopted — see migrations/README.md.
    expect(duplicatePrefixes.sort()).toEqual(["0067", "0087", "0090", "0096", "0098"]);
    expect(offenders.size).toBe(0);
    expect(duplicatePrefixViolation(migrationsDir)).toBeNull();
    // The 0098 freeze is count-aware, not a blanket pass: exactly three files.
    expect(LEGACY_DUPLICATE_PREFIX_ALLOWLIST.get("0098")).toBe(3);
    expect(LEGACY_DUPLICATE_PREFIX_ALLOWLIST.get("0096")).toBe(2);
  });
});
