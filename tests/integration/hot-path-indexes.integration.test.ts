import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * 0509#5755, audit §V26, in real workerd against real local D1 with the whole
 * migration chain applied: the five hot or scheduled statements the audit
 * measured as SCAN in production are SEARCH ... USING INDEX here, and none of
 * them sorts through a temp B-tree. The static class gate is
 * tests/hot-path-indexes.test.ts; this is the same claim proven by the planner.
 *
 * The SQL is the statement each source line runs, so a rewrite of any of them
 * that drops the indexed predicate shows up here.
 */
interface HotStatement {
  readonly source: string;
  readonly sql: string;
  readonly binds: readonly unknown[];
  readonly index: string;
}

const HOT_STATEMENTS: readonly HotStatement[] = [
  {
    source: "app/lib/workspace.server.ts:97",
    sql: "SELECT input_raw, watching_started_at FROM onboarding_run WHERE workspace_id = ?1 ORDER BY started_at ASC LIMIT 1",
    binds: ["ws_onboarding"],
    index: "idx_onboarding_run_workspace",
  },
  {
    source: "app/lib/data/signal.server.ts:109",
    sql: "SELECT id, dedup_key, last_seen_at, payload_json FROM signal WHERE kind = 'hiring' AND watch_id = ?1 AND is_tombstoned = 0",
    binds: ["watch_hiring"],
    index: "idx_signal_watch_kind",
  },
  {
    source: "workers/delivery/dlq-consumer.ts:54",
    sql: "SELECT error FROM send_attempt WHERE digest_id = ?1 ORDER BY attempted_at DESC LIMIT 1",
    binds: ["digest_queued"],
    index: "idx_send_attempt_digest",
  },
  {
    source: "app/lib/data/auth_expiry.server.ts:1",
    sql: 'DELETE FROM "session" WHERE "expiresAt" < ?1',
    binds: ["2026-01-01T00:00:00.000Z"],
    index: "idx_session_expires",
  },
  {
    source: "workers/delivery/sweeper.ts:20",
    sql: "SELECT id FROM digest WHERE status = 'pending' AND period_end < ?1 AND period_end >= ?2",
    binds: ["2026-09-28T00:00:00.000Z", "2026-09-21T00:00:00.000Z"],
    index: "idx_digest_status_period",
  },
];

async function plan(statement: HotStatement): Promise<string[]> {
  const result = await env.DB.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
    .bind(...statement.binds)
    .all<{ detail: string }>();
  return (result.results ?? []).map((row) => row.detail);
}

describe("0026_hot_path_indexes.sql", () => {
  it("searches instead of scanning every hot or scheduled statement", async () => {
    const seen: string[] = [];
    for (const statement of HOT_STATEMENTS) {
      const details = await plan(statement);
      const used = new RegExp(`USING (?:COVERING )?INDEX ${statement.index}`);
      const searched = details.some((detail) => used.test(detail));
      expect(searched, `${statement.source} did not use ${statement.index}: ${details.join(" | ")}`).toBe(
        true,
      );
      expect(
        details.filter((detail) => detail.startsWith("SCAN ")),
        `${statement.source} still scans: ${details.join(" | ")}`,
      ).toEqual([]);
      expect(
        details.filter((detail) => detail.includes("USE TEMP B-TREE")),
        `${statement.source} sorts through a temp B-tree: ${details.join(" | ")}`,
      ).toEqual([]);
      seen.push(`${statement.index} -> ${details.join(" | ")}`);
    }
    console.log(`hot-path-indexes explain utc=${new Date().toISOString()} ${seen.join(" ;; ")}`);
  });
});
