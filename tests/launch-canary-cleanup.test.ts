import { afterEach, describe, expect, it } from "vitest";

import { createSqliteD1 } from "./helpers/sqlite-d1";
import { cleanupLaunchReadinessCanary } from "~/lib/data/launch-canary-cleanup.server";

const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

function createHarness() {
  const harness = createSqliteD1();
  fixtures.push(harness);
  harness.sqlite.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE watchlist (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE watchlist_run (
      id TEXT PRIMARY KEY NOT NULL,
      watchlist_id TEXT NOT NULL REFERENCES watchlist(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL,
      baseline_from_run_id TEXT REFERENCES watchlist_run(id) ON DELETE SET NULL,
      summary_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE proof_target (
      id TEXT PRIMARY KEY NOT NULL,
      watchlist_id TEXT NOT NULL REFERENCES watchlist(id) ON DELETE CASCADE,
      last_successful_capture_id TEXT
    );
    CREATE TABLE proof_capture (
      id TEXT PRIMARY KEY NOT NULL,
      proof_target_id TEXT NOT NULL REFERENCES proof_target(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      idempotency_key TEXT,
      capture_metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE watch_event (
      id TEXT PRIMARY KEY NOT NULL,
      watchlist_id TEXT NOT NULL REFERENCES watchlist(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES watchlist_run(id) ON DELETE CASCADE,
      baseline_from_run_id TEXT REFERENCES watchlist_run(id) ON DELETE SET NULL,
      proof_capture_id TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE digest_run (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE digest_item (
      id TEXT PRIMARY KEY NOT NULL,
      digest_run_id TEXT NOT NULL REFERENCES digest_run(id) ON DELETE CASCADE,
      watchlist_id TEXT NOT NULL REFERENCES watchlist(id) ON DELETE CASCADE,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE digest_delivery (
      id TEXT PRIMARY KEY NOT NULL,
      digest_run_id TEXT NOT NULL UNIQUE REFERENCES digest_run(id) ON DELETE CASCADE,
      status TEXT NOT NULL
    );
    CREATE TABLE delivery_attempt (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      digest_run_id TEXT REFERENCES digest_run(id) ON DELETE SET NULL,
      lane TEXT NOT NULL,
      channel TEXT NOT NULL,
      payload_snapshot_json TEXT NOT NULL
    );
  `);
  harness.sqlite.exec(`
    INSERT INTO user (id) VALUES ('owner-1'), ('owner-2');
    INSERT INTO watchlist (id, user_id, name, created_at, updated_at)
      VALUES ('watch-1', 'owner-1', 'Canary', '2026-07-15', '2026-07-15'),
             ('watch-2', 'owner-2', 'Other', '2026-07-15', '2026-07-15');
  `);
  return harness;
}

function seedCanary(harness: ReturnType<typeof createSqliteD1>) {
  harness.sqlite.exec(`
    INSERT INTO watchlist_run (
      id, watchlist_id, trigger_type, status, baseline_from_run_id,
      summary_json, started_at, finished_at, created_at, updated_at
    ) VALUES (
      'run-1', 'watch-1', 'manual', 'succeeded', NULL,
      '{"kind":"launch_readiness_canary"}', '2026-07-15', '2026-07-15', '2026-07-15', '2026-07-15'
    );
    INSERT INTO proof_target (id, watchlist_id, last_successful_capture_id)
      VALUES ('target-1', 'watch-1', 'proof-1');
    INSERT INTO proof_capture (
      id, proof_target_id, status, idempotency_key, capture_metadata_json, created_at
    ) VALUES (
      'proof-1', 'target-1', 'succeeded', 'launch-readiness:2026-07-15:proof',
      '{"kind":"launch_readiness_real_capture","proofUrl":"https://0509.io/"}', '2026-07-15'
    );
    INSERT INTO watch_event (
      id, watchlist_id, run_id, baseline_from_run_id, proof_capture_id,
      title, summary, metadata_json, created_at
    ) VALUES (
      'event-1', 'watch-1', 'run-1', NULL, 'proof-1',
      'Launch readiness canary',
      'Private canary verified the monitoring, proof, and digest delivery pipeline.',
      '{"kind":"launch_readiness_canary"}', '2026-07-15'
    );
    INSERT INTO digest_run (id, user_id, summary_json, created_at)
      VALUES ('digest-1', 'owner-1', '{"kind":"launch_readiness_canary"}', '2026-07-15');
    INSERT INTO digest_item (id, digest_run_id, watchlist_id, metadata_json, created_at)
      VALUES ('item-1', 'digest-1', 'watch-1',
        '{"kind":"launch_readiness_canary","eventId":"event-1","proofCaptureId":"proof-1"}',
        '2026-07-15');
    INSERT INTO digest_delivery (id, digest_run_id, status)
      VALUES ('delivery-1', 'digest-1', 'sent');
    INSERT INTO delivery_attempt (
      id, user_id, digest_run_id, lane, channel, payload_snapshot_json
    ) VALUES (
      'attempt-1', 'owner-1', 'digest-1', 'internal', 'email', '{"kind":"weekly_digest"}'
    );
  `);
}

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.close();
});

describe("cleanupLaunchReadinessCanary", () => {
  it("cleans the route-shaped event and preserves its proof capture", async () => {
    const harness = createHarness();
    seedCanary(harness);
    expect(
      harness.sqlite.prepare("SELECT metadata_json FROM watch_event WHERE id = 'event-1'").get(),
    ).toEqual({ metadata_json: '{"kind":"launch_readiness_canary"}' });

    await expect(
      cleanupLaunchReadinessCanary(
        { DB: harness.db } as never,
        { ownerUserId: "owner-1", runId: "run-1", proofCaptureId: "proof-1", digestRunId: "digest-1" },
      ),
    ).resolves.toMatchObject({ cleaned: true, preservedProofCaptureId: "proof-1" });

    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watch_event").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_run").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_item").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_delivery").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM delivery_attempt").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM proof_capture").get()).toEqual({ count: 1 });
  });

  it("does not touch rows when the owner, watchlist, or marker does not match", async () => {
    const mismatchedOwner = createHarness();
    seedCanary(mismatchedOwner);
    await expect(
      cleanupLaunchReadinessCanary(
        { DB: mismatchedOwner.db } as never,
        { ownerUserId: "owner-2", runId: "run-1", proofCaptureId: "proof-1", digestRunId: "digest-1" },
      ),
    ).resolves.toMatchObject({ cleaned: false });
    expect(mismatchedOwner.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_run").get()).toEqual({ count: 1 });

    const nonCanary = createHarness();
    seedCanary(nonCanary);
    nonCanary.sqlite
      .prepare("UPDATE watchlist_run SET summary_json = ? WHERE id = ?")
      .run('{"kind":"customer_scan"}', "run-1");
    await expect(
      cleanupLaunchReadinessCanary(
        { DB: nonCanary.db } as never,
        { ownerUserId: "owner-1", runId: "run-1", proofCaptureId: "proof-1", digestRunId: "digest-1" },
      ),
    ).resolves.toMatchObject({ cleaned: false });
    expect(nonCanary.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 1 });

    const mismatchedWatchlist = createHarness();
    seedCanary(mismatchedWatchlist);
    mismatchedWatchlist.sqlite
      .prepare("UPDATE proof_target SET watchlist_id = ? WHERE id = ?")
      .run("watch-2", "target-1");
    await expect(
      cleanupLaunchReadinessCanary(
        { DB: mismatchedWatchlist.db } as never,
        { ownerUserId: "owner-1", runId: "run-1", proofCaptureId: "proof-1", digestRunId: "digest-1" },
      ),
    ).resolves.toMatchObject({ cleaned: false });
    expect(mismatchedWatchlist.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 1 });
  });

  it("rolls back the whole cleanup when one dependent delete fails", async () => {
    const harness = createHarness();
    seedCanary(harness);
    harness.sqlite.exec(`
      CREATE TRIGGER reject_canary_item_delete
      BEFORE DELETE ON digest_item
      BEGIN
        SELECT RAISE(ABORT, 'item delete blocked');
      END;
    `);

    await expect(
      cleanupLaunchReadinessCanary(
        { DB: harness.db } as never,
        { ownerUserId: "owner-1", runId: "run-1", proofCaptureId: "proof-1", digestRunId: "digest-1" },
      ),
    ).rejects.toThrow("item delete blocked");
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 1 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM delivery_attempt").get()).toEqual({ count: 1 });
  });

  it("is idempotent across repeated and concurrent cleanup calls", async () => {
    const harness = createHarness();
    seedCanary(harness);
    const input = { ownerUserId: "owner-1", runId: "run-1", proofCaptureId: "proof-1", digestRunId: "digest-1" };

    const results = await Promise.all([
      cleanupLaunchReadinessCanary({ DB: harness.db } as never, input),
      cleanupLaunchReadinessCanary({ DB: harness.db } as never, input),
    ]);
    expect(results.filter((result) => result.cleaned)).toHaveLength(1);
    expect(results.filter((result) => !result.cleaned)).toHaveLength(1);

    await expect(cleanupLaunchReadinessCanary({ DB: harness.db } as never, input)).resolves.toMatchObject({
      cleaned: false,
    });
  });

  it("aborts instead of deleting a shared non-canary event in the same run", async () => {
    const harness = createHarness();
    seedCanary(harness);
    harness.sqlite.exec(`
      INSERT INTO watch_event (
        id, watchlist_id, run_id, baseline_from_run_id, proof_capture_id,
        title, summary, metadata_json, created_at
      ) VALUES (
        'event-shared', 'watch-1', 'run-1', NULL, NULL,
        'Customer evidence', 'Keep this history', '{"kind":"customer_event"}', '2026-07-15'
      );
    `);

    await expect(
      cleanupLaunchReadinessCanary(
        { DB: harness.db } as never,
        { ownerUserId: "owner-1", runId: "run-1", proofCaptureId: "proof-1", digestRunId: "digest-1" },
      ),
    ).resolves.toMatchObject({ cleaned: false });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watch_event").get()).toEqual({ count: 2 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_run").get()).toEqual({ count: 1 });
  });
});
