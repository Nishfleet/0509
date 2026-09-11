import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Migration lint for issue #2774 (fleet-ops#4999).
 *
 * `PRAGMA foreign_keys = OFF` is a no-op inside the transaction D1 wraps each
 * migration in, so a migration that carries it LOOKS protected but is not —
 * a `DROP TABLE` of a parented table then fires its implicit `DELETE FROM`
 * with enforcement ON and cascades into every `ON DELETE CASCADE` child.
 * That exact shape emptied 57 production tables on 2026-09-09.
 *
 * The class fix: no migration file may contain `PRAGMA foreign_keys = OFF`.
 * Rebuilds that need foreign-key slack inside the transaction use
 * `PRAGMA defer_foreign_keys = ON` plus a stage-and-restore of the affected
 * cascade closure — see migrations/0087_signup_source_open_allowlist.sql.
 *
 * The eight files in GRANDFATHERED predate this lint and are already applied
 * to production (a migration can never re-run on a database that has it in
 * d1_migrations, so their dead pragmas are inert history). They are exempt
 * by exact name only — any other file carrying the pragma fails the suite.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

const GRANDFATHERED = new Set([
  "0002_monitoring_trust.sql",
  "0007_proof_first_change_alerts.sql",
  "0008_commercial_ad_ingestion_replacement.sql",
  "0009_discovery_query_leases.sql",
  "0019_slack_delivery.sql",
  "0077_competitor_site_monitoring.sql",
  "0082_website_page_kind_careers_legal.sql",
  "0090_event_type_free_text.sql",
]);

// `\b` before `foreign_keys` keeps `defer_foreign_keys` from matching: the
// underscore in `defer_foreign_keys` is a word character, so there is no
// boundary ahead of `foreign_keys` inside that pragma name.
const FOREIGN_KEYS_OFF = /pragma\s+foreign_keys\s*=\s*off/i;

// Scan statements only — a `--` comment documenting the incident must not
// trip the lint.
function statementsOnly(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

describe("migration lint — PRAGMA foreign_keys = OFF is banned (issue #2774)", () => {
  it("no non-grandfathered migration disables foreign keys", () => {
    const offenders = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .filter(
        (name) =>
          !GRANDFATHERED.has(name) &&
          FOREIGN_KEYS_OFF.test(
            statementsOnly(readFileSync(join(MIGRATIONS_DIR, name), "utf8")),
          ),
      );
    expect(
      offenders,
      `migrations containing PRAGMA foreign_keys = OFF: ${offenders.join(", ")} — ` +
        "the pragma is a no-op inside D1's per-migration transaction and hides " +
        "cascade-on-drop wipes; see issue #2774 / fleet-ops#4999",
    ).toEqual([]);
  });

  it("the grandfather set only names files that still carry the pragma", () => {
    // Keeps the exemption honest: a grandfathered file that no longer contains
    // the pragma must leave the set, so the allowlist can only shrink.
    const stale = [...GRANDFATHERED].filter((name) => {
      try {
        return !FOREIGN_KEYS_OFF.test(
          statementsOnly(readFileSync(join(MIGRATIONS_DIR, name), "utf8")),
        );
      } catch {
        return true; // file gone — exemption is stale
      }
    });
    expect(stale).toEqual([]);
  });
});
