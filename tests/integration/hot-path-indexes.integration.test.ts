import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { DELETE_EXPIRED_SESSIONS, DELETE_EXPIRED_VERIFICATIONS } from "../../app/lib/data/auth_expiry.server";
import { SELECT_HIRING_SIGNAL_STATES } from "../../app/lib/data/signal.server";
import { SELECT_RUN } from "../../app/lib/workspace.server";
import { SELECT_LATEST_ATTEMPT_ERROR } from "../../workers/delivery/dlq-consumer";
import { SELECT_STALE_PENDING_DIGESTS } from "../../workers/delivery/sweeper";

/**
 * 0509#5755, audit §V26: five hot or scheduled statements full-scanned their
 * table because the column they filter on had no child index. The setup file
 * applies migrations/ to this D1, so what is checked here is the chain the
 * deploy ships, not a fixture.
 *
 * This is the class gate. Every statement below is imported from the module
 * that runs it, so a rewrite that drops an indexed predicate turns the row red
 * here; a migration that drops or never writes the index turns it red too. A
 * new scheduled or request-path statement gets a row naming the covering index
 * it must read through.
 */
interface HotStatement {
  readonly source: string;
  readonly sql: string;
  readonly binds: readonly unknown[];
  readonly index: string;
  readonly columns: readonly string[];
}

const HOT_STATEMENTS: readonly HotStatement[] = [
  {
    source: "app/lib/workspace.server.ts SELECT_RUN",
    sql: SELECT_RUN,
    binds: ["ws_onboarding"],
    index: "idx_onboarding_run_workspace",
    columns: ["workspace_id", "started_at"],
  },
  {
    source: "app/lib/data/signal.server.ts SELECT_HIRING_SIGNAL_STATES",
    sql: SELECT_HIRING_SIGNAL_STATES,
    binds: ["watch_hiring"],
    index: "idx_signal_watch_kind",
    columns: ["watch_id", "kind"],
  },
  {
    source: "workers/delivery/dlq-consumer.ts SELECT_LATEST_ATTEMPT_ERROR",
    sql: SELECT_LATEST_ATTEMPT_ERROR,
    binds: ["digest_queued"],
    index: "idx_send_attempt_digest",
    columns: ["digest_id", "attempted_at"],
  },
  {
    source: "app/lib/data/auth_expiry.server.ts DELETE_EXPIRED_SESSIONS",
    sql: DELETE_EXPIRED_SESSIONS,
    binds: ["2026-01-01T00:00:00.000Z"],
    index: "idx_session_expires",
    columns: ["expiresAt"],
  },
  {
    source: "app/lib/data/auth_expiry.server.ts DELETE_EXPIRED_VERIFICATIONS",
    sql: DELETE_EXPIRED_VERIFICATIONS,
    binds: ["2026-01-01T00:00:00.000Z"],
    index: "idx_verification_expires",
    columns: ["expiresAt"],
  },
  {
    source: "workers/delivery/sweeper.ts SELECT_STALE_PENDING_DIGESTS",
    sql: SELECT_STALE_PENDING_DIGESTS,
    binds: ["2026-09-28T00:00:00.000Z", "2026-09-21T00:00:00.000Z"],
    index: "idx_digest_status_period",
    columns: ["status", "period_end"],
  },
];

async function liveIndexColumns(name: string): Promise<string[]> {
  const index = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?1",
  )
    .bind(name)
    .first<{ name: string }>();
  expect(index, `${name} is not in the applied migration chain`).not.toBeNull();
  const columns = await env.DB.prepare("SELECT name FROM pragma_index_info(?1) ORDER BY seqno")
    .bind(name)
    .all<{ name: string }>();
  return (columns.results ?? []).map((row) => row.name);
}

describe("0026_hot_path_indexes_and_sweep_run.sql", () => {
  it("gives every hot or scheduled statement an index starting with its columns", async () => {
    for (const statement of HOT_STATEMENTS) {
      expect(
        (await liveIndexColumns(statement.index)).slice(0, statement.columns.length),
        `${statement.source} has no index starting with ${statement.columns.join(", ")}`,
      ).toEqual([...statement.columns]);
    }
  });

  it("searches instead of scanning every hot or scheduled statement", async () => {
    const seen: string[] = [];
    for (const statement of HOT_STATEMENTS) {
      const result = await env.DB.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
        .bind(...statement.binds)
        .all<{ detail: string }>();
      const details = (result.results ?? []).map((row) => row.detail);
      const picked = new RegExp(`USING (?:COVERING )?INDEX ${statement.index}`);
      expect(
        details.some((detail) => picked.test(detail)),
        `${statement.source} did not read through ${statement.index}: ${details.join(" | ")}`,
      ).toBe(true);
      expect(
        details.filter((detail) => detail.startsWith("SCAN ")),
        `${statement.source} still scans: ${details.join(" | ")}`,
      ).toEqual([]);
      expect(
        details.filter((detail) => detail.includes("USE TEMP B-TREE")),
        `${statement.source} sorts through a temp B-tree: ${details.join(" | ")}`,
      ).toEqual([]);
      seen.push(`EXPLAIN QUERY PLAN ${statement.source}: ${details.join(" | ")}`);
    }
    console.log(`hot-path-indexes explain utc=${new Date().toISOString()} ${seen.join(" ;; ")}`);
  });
});
