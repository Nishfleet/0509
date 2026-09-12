// Duplicate migration prefix detector (issue #2984).
//
// Two migration files sharing a 4-digit prefix have an ambiguous apply order:
// `wrangler d1 migrations apply` orders by file name, so on a tie the ordering
// depends on lexicographic filename tiebreaks rather than the intended
// sequence. Three such pairs already exist (0067 x2, 0087 x2, 0090 x2) and are
// deliberately NOT renumbered: D1's migration ledger is append-only and keyed
// by exact filename, so renaming an already-applied file makes wrangler see a
// brand-new unapplied migration and either blocks every deploy on
// `migration_repository_baseline_drift` or re-runs the SQL against tables that
// already exist. Those prefixes are frozen in
// LEGACY_DUPLICATE_PREFIX_ALLOWLIST; every NEW migration must take the next
// unused number (max existing prefix + 1) and may never reuse one.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PREFIX_PATTERN = /^(\d{4})_[A-Za-z0-9_]+\.sql$/u;

/**
 * Prefixes that were already applied to production D1 under both spellings
 * before this guard existed. See the header comment: these cannot be renamed
 * without desyncing the production migration ledger.
 * @type {Set<string>}
 */
export const LEGACY_DUPLICATE_PREFIX_ALLOWLIST = new Set([
  // 0067_delivery_recovery_and_digest_jobs.sql + 0067_workspace_member_invariants.sql
  // (both recorded verbatim in PRODUCTION_MIGRATION_LEDGER_BASELINE).
  "0067",
  // 0087_cta_pipeline_bail_reason_counts.sql + 0087_signup_source_open_allowlist.sql
  // (the latter is itself a historical-file rebuild migration).
  "0087",
  // 0090_competitor_source_fields.sql + 0090_event_type_free_text.sql
  "0090",
]);

/**
 * @param {string[]} names migration file names (sorted or not)
 * @returns {Map<string, string[]>} 4-digit prefix -> file names
 */
export function groupByMigrationPrefix(names) {
  const groups = new Map();
  for (const name of names) {
    const match = PREFIX_PATTERN.exec(name);
    if (!match) continue;
    const list = groups.get(match[1]) ?? [];
    list.push(name);
    groups.set(match[1], list);
  }
  return groups;
}

/**
 * @param {string[]} names
 * @param {Set<string>} [allowlist] prefixes already applied to production
 * @returns {{ duplicatePrefixes: string[], offenders: Map<string, string[]> }}
 *   `duplicatePrefixes` is every prefix with more than one file;
 *   `offenders` only holds the failed-on groups (duplicates NOT in the allowlist).
 */
export function duplicateMigrationPrefixes(
  names,
  allowlist = LEGACY_DUPLICATE_PREFIX_ALLOWLIST,
) {
  const offenders = new Map();
  const duplicatePrefixes = [];
  for (const [prefix, files] of groupByMigrationPrefix(names)) {
    if (files.length < 2) continue;
    duplicatePrefixes.push(prefix);
    // Frozen legacy duplicates are capped at their historical two files; a
    // third file reusing a frozen prefix is a NEW duplicate and fails.
    if (!allowlist.has(prefix) || files.length > 2) {
      offenders.set(prefix, files);
    }
  }
  duplicatePrefixes.sort();
  return { duplicatePrefixes, offenders };
}

/**
 * @param {string} migrationsDir
 * @returns {string[]} sorted migration file names in the directory
 */
export function migrationFileNames(migrationsDir) {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && PREFIX_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Run the check over a directory. Returns exit-message or null when clean.
 * @param {string} migrationsDir
 */
export function duplicatePrefixViolation(migrationsDir) {
  const names = migrationFileNames(migrationsDir);
  // A .sql file the pattern cannot parse must never pass silently: it is the
  // same apply-order ambiguity under a malformed name.
  const malformed = readdirSync(migrationsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && entry.name.endsWith(".sql") && !PREFIX_PATTERN.test(entry.name),
    )
    .map((entry) => entry.name);
  if (malformed.length > 0) {
    return `migration file names outside the required /^\\d{4}_[A-Za-z0-9_]+\\.sql$/ pattern: ${malformed.join(", ")}`;
  }
  const { offenders } = duplicateMigrationPrefixes(names);
  if (offenders.size === 0) return null;
  const lines = ["duplicate migration prefixes detected:"];
  for (const [prefix, files] of offenders) lines.push(`  ${prefix}: ${files.join(", ")}`);
  lines.push(
    "New migrations must take the next unused number (max existing prefix + 1);",
    "legacy duplicates above are frozen — never rename an applied migration file.",
  );
  return lines.join("\n");
}

/** CLI entrypoint. */
/**
 * CLI entry: run against argv[0] (or default migrations path). Exits 1 with a
 * message on violation.
 * @param {string[]} [argv]
 * @returns {void}
 */
export function main(argv = process.argv.slice(2)) {
  const migrationsDir = argv[0] ?? join(process.cwd(), "migrations");
  const violation = duplicatePrefixViolation(migrationsDir);
  if (violation) {
    console.error(violation);
    process.exit(1);
  }
  console.log("duplicate migration prefix check passed.");
}
