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
      screenshot_artifact_key TEXT,
      html_artifact_key TEXT,
      capture_metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
    CREATE TABLE ad_observation (
      id TEXT PRIMARY KEY NOT NULL,
      watchlist_run_id TEXT,
      landing_page_snapshot_id TEXT
    );
    CREATE TABLE landing_page_snapshot (
      id TEXT PRIMARY KEY NOT NULL,
      artifact_key TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE ad (
      id TEXT PRIMARY KEY NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE event_candidate (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT
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
      '{"kind":"launch_readiness_canary","gateRunId":"2026-07-15"}', '2026-07-15', '2026-07-15', '2026-07-15', '2026-07-15'
    );
    INSERT INTO proof_target (id, watchlist_id, last_successful_capture_id)
      VALUES ('target-1', 'watch-1', 'proof-1');
    INSERT INTO proof_capture (
      id, proof_target_id, status, idempotency_key,
      screenshot_artifact_key, html_artifact_key,
      capture_metadata_json, created_at, updated_at
    ) VALUES (
      'proof-1', 'target-1', 'succeeded', 'launch-readiness:2026-07-15:proof',
      NULL, NULL,
      '{"kind":"launch_readiness_real_capture","proofUrl":"https://0509.io/","gateRunId":"2026-07-15"}', '2026-07-15', '2026-07-15'
    );
    INSERT INTO watch_event (
      id, watchlist_id, run_id, baseline_from_run_id, proof_capture_id,
      title, summary, metadata_json, created_at
    ) VALUES (
      'event-1', 'watch-1', 'run-1', NULL, 'proof-1',
      'Launch readiness canary',
      'Private canary verified the monitoring, proof, and digest delivery pipeline.',
      '{"kind":"launch_readiness_canary","gateRunId":"2026-07-15"}', '2026-07-15'
    );
    INSERT INTO digest_run (id, user_id, summary_json, created_at)
      VALUES ('digest-1', 'owner-1', '{"kind":"launch_readiness_canary","gateRunId":"2026-07-15"}', '2026-07-15');
    INSERT INTO digest_item (id, digest_run_id, watchlist_id, metadata_json, created_at)
      VALUES ('item-1', 'digest-1', 'watch-1',
        '{"kind":"launch_readiness_canary","gateRunId":"2026-07-15","eventId":"event-1","proofCaptureId":"proof-1"}',
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
  it("resolves exact cleanup identifiers from the stable gate run ID", async () => {
    const harness = createHarness();
    seedCanary(harness);

    await expect(
      cleanupLaunchReadinessCanary(
        { DB: harness.db } as never,
        { ownerUserId: "owner-1", gateRunId: "2026-07-15" },
      ),
    ).resolves.toMatchObject({ cleaned: true, preservedProofCaptureId: "proof-1" });
    await expect(
      cleanupLaunchReadinessCanary(
        { DB: harness.db } as never,
        { ownerUserId: "owner-1", gateRunId: "2026-07-15" },
      ),
    ).resolves.toMatchObject({ cleaned: true, preservedProofCaptureId: "proof-1" });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_run").get()).toEqual({ count: 0 });
  });

  it("preserves scheduled rows that used the canary as a nullable baseline", async () => {
    const harness = createHarness();
    seedCanary(harness);
    harness.sqlite.exec(`
      INSERT INTO watchlist_run (
        id, watchlist_id, trigger_type, status, baseline_from_run_id,
        summary_json, started_at, finished_at, created_at, updated_at
      ) VALUES (
        'scheduled-run', 'watch-1', 'scheduled', 'succeeded', 'run-1',
        '{"kind":"customer_scan"}', '2026-07-16', '2026-07-16', '2026-07-16', '2026-07-16'
      );
      INSERT INTO watch_event (
        id, watchlist_id, run_id, baseline_from_run_id, proof_capture_id,
        title, summary, metadata_json, created_at
      ) VALUES (
        'scheduled-event', 'watch-1', 'scheduled-run', 'run-1', NULL,
        'Customer evidence', 'Keep this history', '{"kind":"customer_event"}', '2026-07-16'
      );
    `);

    await expect(cleanupLaunchReadinessCanary(
      { DB: harness.db } as never,
      { ownerUserId: "owner-1", gateRunId: "2026-07-15" },
    )).resolves.toMatchObject({ cleaned: true, preservedProofCaptureId: "proof-1" });
    expect(harness.sqlite.prepare(
      "SELECT id, baseline_from_run_id FROM watchlist_run WHERE id = 'scheduled-run'",
    ).get()).toEqual({ id: "scheduled-run", baseline_from_run_id: null });
    expect(harness.sqlite.prepare(
      "SELECT id, baseline_from_run_id FROM watch_event WHERE id = 'scheduled-event'",
    ).get()).toEqual({ id: "scheduled-event", baseline_from_run_id: null });
  });

  it("cleans a failed run-only recovery state and is idempotent by gate ID", async () => {
    const harness = createHarness();
    harness.sqlite.exec(`
      INSERT INTO watchlist_run (
        id, watchlist_id, trigger_type, status, baseline_from_run_id,
        summary_json, started_at, finished_at, created_at, updated_at
      ) VALUES (
        'run-only', 'watch-1', 'manual', 'failed', NULL,
        '{"kind":"launch_readiness_canary","gateRunId":"gate-run-only"}',
        '2026-07-15', '2026-07-15', '2026-07-15', '2026-07-15'
      );
    `);
    const input = { ownerUserId: "owner-1", gateRunId: "gate-run-only" };

    await expect(cleanupLaunchReadinessCanary({ DB: harness.db } as never, input))
      .resolves.toMatchObject({ cleaned: true, preservedProofCaptureId: null });
    await expect(cleanupLaunchReadinessCanary({ DB: harness.db } as never, input))
      .resolves.toMatchObject({ cleaned: true, preservedProofCaptureId: null });
  });

  it("does not clean an actively running canary", async () => {
    const harness = createHarness();
    harness.sqlite.exec(`
      INSERT INTO watchlist_run (
        id, watchlist_id, trigger_type, status, baseline_from_run_id,
        summary_json, started_at, finished_at, created_at, updated_at
      ) VALUES (
        'run-active', 'watch-1', 'manual', 'running', NULL,
        '{"kind":"launch_readiness_canary","gateRunId":"gate-active"}',
        '2999-01-01', NULL, '2999-01-01', '2999-01-01'
      );
    `);

    await expect(cleanupLaunchReadinessCanary(
      { DB: harness.db } as never,
      { ownerUserId: "owner-1", gateRunId: "gate-active" },
    )).resolves.toMatchObject({ cleaned: false, reason: "shared_rows_present" });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 1 });
  });

  it("serializes concurrent full gate cleanup calls and reports both clean", async () => {
    const harness = createHarness();
    seedCanary(harness);
    const input = { ownerUserId: "owner-1", gateRunId: "2026-07-15" };

    const results = await Promise.all([
      cleanupLaunchReadinessCanary({ DB: harness.db } as never, input),
      cleanupLaunchReadinessCanary({ DB: harness.db } as never, input),
    ]);
    expect(results).toEqual([
      expect.objectContaining({ cleaned: true }),
      expect.objectContaining({ cleaned: true }),
    ]);
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_run").get()).toEqual({ count: 0 });
  });

  it("reconciles concurrent artifact cleanup across distinct Worker DB identities", async () => {
    const harness = createHarness();
    seedCanary(harness);
    const artifactKey = "landing-pages/2026-07-15/0123456789abcdef0123456789abcdef.html";
    harness.sqlite.prepare(
      "UPDATE proof_capture SET html_artifact_key = ? WHERE id = 'proof-1'",
    ).run(artifactKey);

    let deleteCalls = 0;
    let releaseDeletes!: () => void;
    const bothDeleting = new Promise<void>((resolve) => {
      releaseDeletes = resolve;
    });
    const bucket = {
      head: async () => ({ key: artifactKey }),
      delete: async () => {
        deleteCalls += 1;
        if (deleteCalls === 2) releaseDeletes();
        await bothDeleting;
      },
    };
    let batchChain: Promise<unknown> = Promise.resolve();
    const wrapDb = () => ({
      prepare: harness.db.prepare.bind(harness.db),
      batch<T extends { run(): Promise<{ meta?: { changes?: number } }> }>(statements: T[]) {
        const operation = batchChain.then(() => harness.db.batch(statements));
        batchChain = operation.then(() => undefined, () => undefined);
        return operation;
      },
    });
    const input = { ownerUserId: "owner-1", gateRunId: "2026-07-15" };

    const results = await Promise.all([
      cleanupLaunchReadinessCanary({ DB: wrapDb(), LANDING_PAGE_ARTIFACTS: bucket } as never, input),
      cleanupLaunchReadinessCanary({ DB: wrapDb(), LANDING_PAGE_ARTIFACTS: bucket } as never, input),
    ]);

    expect(deleteCalls).toBe(2);
    expect(results).toEqual([
      expect.objectContaining({ cleaned: true }),
      expect.objectContaining({ cleaned: true }),
    ]);
    expect(harness.sqlite.prepare(
      "SELECT html_artifact_key FROM proof_capture WHERE id = 'proof-1'",
    ).get()).toEqual({ html_artifact_key: null });
  });

  it("cleans a run, proof, and event after a digest claim conflict without touching the winner", async () => {
    const harness = createHarness();
    seedCanary(harness);
    harness.sqlite.exec(`
      DELETE FROM delivery_attempt;
      DELETE FROM digest_delivery;
      DELETE FROM digest_item;
      UPDATE digest_run
      SET summary_json = '{"kind":"launch_readiness_canary","gateRunId":"winner-gate"}'
      WHERE id = 'digest-1';
      INSERT INTO digest_item (id, digest_run_id, watchlist_id, metadata_json, created_at)
      VALUES (
        'winner-item', 'digest-1', 'watch-1',
        '{"kind":"launch_readiness_canary","gateRunId":"winner-gate","eventId":"winner-event","proofCaptureId":"winner-proof"}',
        '2026-07-15'
      );
    `);
    const winnerBefore = harness.sqlite.prepare("SELECT * FROM digest_run WHERE id = 'digest-1'").get();
    const winnerItemBefore = harness.sqlite.prepare("SELECT * FROM digest_item WHERE id = 'winner-item'").get();

    await expect(cleanupLaunchReadinessCanary(
      { DB: harness.db } as never,
      { ownerUserId: "owner-1", gateRunId: "2026-07-15" },
    )).resolves.toMatchObject({ cleaned: true, preservedProofCaptureId: "proof-1" });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watch_event").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT * FROM digest_run WHERE id = 'digest-1'").get()).toEqual(winnerBefore);
    expect(harness.sqlite.prepare("SELECT * FROM digest_item WHERE id = 'winner-item'").get()).toEqual(winnerItemBefore);
  });

  it("cleans the route-shaped event and preserves its proof capture", async () => {
    const harness = createHarness();
    seedCanary(harness);
    expect(
      harness.sqlite.prepare("SELECT metadata_json FROM watch_event WHERE id = 'event-1'").get(),
    ).toEqual({
      metadata_json: '{"kind":"launch_readiness_canary","gateRunId":"2026-07-15"}',
    });

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
    const artifactKey = "landing-pages/2026-07-15/0123456789abcdef0123456789abcdef.html";
    harness.sqlite.prepare(
      "UPDATE proof_capture SET html_artifact_key = ? WHERE id = 'proof-1'",
    ).run(artifactKey);
    let deleteCalls = 0;
    const bucket = {
      head: async () => ({ key: artifactKey }),
      delete: async () => { deleteCalls += 1; },
    };
    harness.sqlite.exec(`
      CREATE TRIGGER reject_canary_item_delete
      BEFORE DELETE ON digest_item
      BEGIN
        SELECT RAISE(ABORT, 'item delete blocked');
      END;
    `);

    await expect(
      cleanupLaunchReadinessCanary(
        { DB: harness.db, LANDING_PAGE_ARTIFACTS: bucket } as never,
        { ownerUserId: "owner-1", runId: "run-1", proofCaptureId: "proof-1", digestRunId: "digest-1" },
      ),
    ).rejects.toThrow("item delete blocked");
    expect(deleteCalls).toBe(0);
    expect(harness.sqlite.prepare(
      "SELECT html_artifact_key FROM proof_capture WHERE id = 'proof-1'",
    ).get()).toEqual({ html_artifact_key: artifactKey });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 1 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM delivery_attempt").get()).toEqual({ count: 1 });
  });

  it("fails closed when another event or digest still references the canary proof", async () => {
    const harness = createHarness();
    seedCanary(harness);
    const artifactKey = "landing-pages/2026-07-15/0123456789abcdef0123456789abcdef.html";
    harness.sqlite.prepare(
      "UPDATE proof_capture SET html_artifact_key = ? WHERE id = 'proof-1'",
    ).run(artifactKey);
    harness.sqlite.exec(`
      INSERT INTO watchlist_run (
        id, watchlist_id, trigger_type, status, baseline_from_run_id,
        summary_json, started_at, finished_at, created_at, updated_at
      ) VALUES (
        'run-2', 'watch-1', 'manual', 'succeeded', NULL,
        '{"kind":"customer_scan"}', '2026-07-16', '2026-07-16', '2026-07-16', '2026-07-16'
      );
      INSERT INTO watch_event (
        id, watchlist_id, run_id, baseline_from_run_id, proof_capture_id,
        title, summary, metadata_json, created_at
      ) VALUES (
        'event-2', 'watch-1', 'run-2', NULL, 'proof-1',
        'Customer evidence', 'Keep this proof', '{"kind":"customer_event"}', '2026-07-16'
      );
    `);
    let deleteCalls = 0;
    const bucket = {
      head: async () => ({ key: artifactKey }),
      delete: async () => { deleteCalls += 1; },
    };

    await expect(cleanupLaunchReadinessCanary(
      { DB: harness.db, LANDING_PAGE_ARTIFACTS: bucket } as never,
      { ownerUserId: "owner-1", gateRunId: "2026-07-15" },
    )).resolves.toMatchObject({ cleaned: false, reason: "shared_rows_present" });
    expect(deleteCalls).toBe(0);
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watch_event").get()).toEqual({ count: 2 });
    expect(harness.sqlite.prepare(
      "SELECT html_artifact_key FROM proof_capture WHERE id = 'proof-1'",
    ).get()).toEqual({ html_artifact_key: artifactKey });
  });

  it("is idempotent across repeated and concurrent cleanup calls", async () => {
    const harness = createHarness();
    seedCanary(harness);
    const input = { ownerUserId: "owner-1", runId: "run-1", proofCaptureId: "proof-1", digestRunId: "digest-1" };

    const results = await Promise.all([
      cleanupLaunchReadinessCanary({ DB: harness.db } as never, input),
      cleanupLaunchReadinessCanary({ DB: harness.db } as never, input),
    ]);
    expect(results).toEqual([
      expect.objectContaining({ cleaned: true, preservedProofCaptureId: "proof-1" }),
      expect.objectContaining({ cleaned: true, preservedProofCaptureId: "proof-1" }),
    ]);

    await expect(cleanupLaunchReadinessCanary({ DB: harness.db } as never, input)).resolves.toMatchObject({
      cleaned: true,
      preservedProofCaptureId: "proof-1",
      deleted: {
        deliveryAttempts: 0,
        digestDeliveries: 0,
        digestItems: 0,
        watchEvents: 0,
        digestRuns: 0,
        watchlistRuns: 0,
      },
    });
  });

  it("retries legacy artifact cleanup after a transient R2 failure", async () => {
    const harness = createHarness();
    seedCanary(harness);
    const artifactKey = "landing-pages/2026-07-15/0123456789abcdef0123456789abcdef.html";
    harness.sqlite.prepare(
      "UPDATE proof_capture SET html_artifact_key = ? WHERE id = 'proof-1'",
    ).run(artifactKey);
    let deleteCalls = 0;
    const bucket = {
      head: async () => ({ key: artifactKey }),
      delete: async () => {
        deleteCalls += 1;
        if (deleteCalls === 1) throw new Error("transient R2 failure");
      },
    };
    const input = {
      ownerUserId: "owner-1",
      runId: "run-1",
      proofCaptureId: "proof-1",
      digestRunId: "digest-1",
    };

    await expect(cleanupLaunchReadinessCanary(
      { DB: harness.db, LANDING_PAGE_ARTIFACTS: bucket } as never,
      input,
    )).resolves.toMatchObject({
      cleaned: false,
      reason: "artifact_cleanup_incomplete",
      preservedProofCaptureId: "proof-1",
    });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_run").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare(
      "SELECT html_artifact_key FROM proof_capture WHERE id = 'proof-1'",
    ).get()).toEqual({ html_artifact_key: artifactKey });

    await expect(cleanupLaunchReadinessCanary(
      { DB: harness.db, LANDING_PAGE_ARTIFACTS: bucket } as never,
      input,
    )).resolves.toMatchObject({
      cleaned: true,
      preservedProofCaptureId: "proof-1",
    });
    expect(deleteCalls).toBe(2);
    expect(harness.sqlite.prepare(
      "SELECT html_artifact_key FROM proof_capture WHERE id = 'proof-1'",
    ).get()).toEqual({ html_artifact_key: null });
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

    await expect(
      cleanupLaunchReadinessCanary(
        { DB: harness.db } as never,
        { ownerUserId: "owner-1", gateRunId: "2026-07-15" },
      ),
    ).resolves.toMatchObject({ cleaned: false, reason: "shared_rows_present" });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watch_event").get()).toEqual({ count: 2 });
  });
});
