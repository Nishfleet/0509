import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1 } from "./helpers/sqlite-d1";

const FIRST_SCAN_KEY = "watchlist-run:first-scan:watch-1";

function seedSchema(sqlite: ReturnType<typeof createSqliteD1>["sqlite"]) {
  sqlite.exec(`
    CREATE TABLE watchlist (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_fingerprint TEXT NOT NULL,
      target_label TEXT NOT NULL,
      target_country TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_scanned_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE watchlist_run (
      id TEXT PRIMARY KEY,
      watchlist_id TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL,
      page_budget INTEGER NOT NULL DEFAULT 2,
      pages_scanned INTEGER NOT NULL DEFAULT 0,
      baseline_from_run_id TEXT,
      summary_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      idempotency_key TEXT,
      workflow_instance_id TEXT,
      processing_token TEXT,
      processing_started_at TEXT,
      queued_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      retry_after TEXT,
      queue_priority INTEGER NOT NULL DEFAULT 2
    );
    CREATE UNIQUE INDEX idx_first_scan_key ON watchlist_run(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE TABLE landing_page_snapshot (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    INSERT INTO watchlist (
      id, user_id, name, target_type, target_id, target_fingerprint, target_label,
      is_active, created_at, updated_at
    ) VALUES (
      'watch-1', 'user-1', 'Test watch', 'advertiser', 'target-1', 'fp-1', 'Target',
      1, '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z'
    );
  `);
}

function watchlist() {
  return {
    id: "watch-1",
    userId: "user-1",
    name: "Test watch",
    targetType: "advertiser" as const,
    targetId: "target-1",
    targetFingerprint: "fp-1",
    targetLabel: "Target",
    targetCountry: null,
    isActive: true,
    lastScannedAt: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
}

function env(db: ReturnType<typeof createSqliteD1>["db"], overrides: Record<string, unknown> = {}) {
  return { DB: db, ...overrides } as never;
}

describe("durable first watchlist scan queue", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("persists before a setup/dispatch failure and requeues the fenced claim", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    const { processFirstWatchlistScanQueue } = await import("~/lib/monitoring.server");

    await expect(processFirstWatchlistScanQueue(env(harness.db), watchlist())).rejects.toThrow();

    const row = harness.sqlite
      .prepare("SELECT status, processing_token, attempt_count, idempotency_key FROM watchlist_run")
      .get() as Record<string, unknown>;
    expect(row.idempotency_key).toBe(FIRST_SCAN_KEY);
    expect(row.status).toBe("pending");
    expect(row.processing_token).toBeNull();
    expect(row.attempt_count).toBe(1);
    harness.close();
  });

  it("deduplicates the activation key and never reclaims a terminal run", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    const first = await import("~/lib/monitoring.server");
    const e2eEnv = env(harness.db, { E2E_PROVIDER_NETWORK_DENY: "1" });

    await expect(first.processFirstWatchlistScanQueue(e2eEnv, watchlist())).resolves.toMatchObject({
      status: "skipped",
    });
    await expect(first.processFirstWatchlistScanQueue(e2eEnv, watchlist())).resolves.toMatchObject({
      status: "duplicate",
    });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({
      count: 1,
    });
    expect(harness.sqlite.prepare("SELECT status FROM watchlist_run").get()).toEqual({
      status: "skipped",
    });
    harness.close();
  });

  it("reclaims an expired running claim, fences it, and denies providers in local proof mode", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    harness.sqlite
      .prepare(
        `INSERT INTO watchlist_run (
          id, watchlist_id, trigger_type, status, page_budget, summary_json, started_at,
          created_at, updated_at, idempotency_key, queued_at, attempt_count,
          processing_token, processing_started_at
        ) VALUES (?, ?, 'manual', 'running', 2, '{}', ?, ?, ?, ?, ?, 1, 'stale-token', ?)` ,
      )
      .run(
        "run-stale",
        "watch-1",
        "2026-07-15T00:00:00.000Z",
        "2026-07-15T00:00:00.000Z",
        "2026-07-15T00:00:00.000Z",
        FIRST_SCAN_KEY,
        "2026-07-14T00:00:00.000Z",
      );
    const { processFirstWatchlistScanQueue } = await import("~/lib/monitoring.server");

    await processFirstWatchlistScanQueue(env(harness.db, { E2E_PROVIDER_NETWORK_DENY: "1" }), watchlist());

    const row = harness.sqlite
      .prepare("SELECT status, attempt_count, processing_token, error_code FROM watchlist_run")
      .get() as Record<string, unknown>;
    expect(row.status).toBe("skipped");
    expect(row.attempt_count).toBe(2);
    expect(row.processing_token).toBeNull();
    expect(row.error_code).toBe("e2e_provider_network_denied");
    harness.close();
  });

  it("does not call providers, create artifacts, or mark the watchlist scanned in local proof mode", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    const { processFirstWatchlistScanQueue } = await import("~/lib/monitoring.server");

    await processFirstWatchlistScanQueue(
      env(harness.db, { E2E_PROVIDER_NETWORK_DENY: "1" }),
      watchlist(),
    );

    expect(harness.sqlite.prepare("SELECT last_scanned_at FROM watchlist").get()).toEqual({
      last_scanned_at: null,
    });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM landing_page_snapshot").get()).toEqual({
      count: 0,
    });
    harness.close();
  });

  it("awaits Workflow acceptance, sends a discriminated payload, and never uses waitUntil with D1", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    let accept: ((value: { id: string }) => void) | undefined;
    const create = vi.fn(
      (_input: { id: string; params: Record<string, unknown> }) => new Promise<{ id: string }>((resolve) => {
        accept = resolve;
      }),
    );
    const waitUntil = vi.fn();
    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");

    let settled = false;
    const queued = queueFirstWatchlistScan(
      env(harness.db, {
        MONITORING_WORKFLOW: { create, get: vi.fn() },
      }),
      { waitUntil } as never,
      watchlist(),
    ).then((value) => {
      settled = true;
      return value;
    });

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    expect(waitUntil).not.toHaveBeenCalled();
    const request = create.mock.calls[0]![0] as {
      id: string;
      params: Record<string, unknown>;
    };
    expect(request.id).toMatch(/^monitor-v1-/);
    expect(request.params).toMatchObject({
      kind: "first_scan",
      watchlistId: "watch-1",
      executionKey: FIRST_SCAN_KEY,
      workflowInstanceId: request.id,
    });
    accept?.({ id: request.id });
    await expect(queued).resolves.toBe(true);
    expect(harness.sqlite.prepare("SELECT workflow_instance_id FROM watchlist_run").get()).toEqual({
      workflow_instance_id: request.id,
    });
    harness.close();
  });

  it("replays the same run and Workflow ID when Cloudflare already owns the instance", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    const status = vi.fn(async () => ({ status: "queued" as const }));
    const get = vi.fn(async () => ({ status, restart: vi.fn() }));
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: "created" })
      .mockRejectedValueOnce(new Error("instance already exists"));
    const first = await import("~/lib/monitoring.server");
    const workflowEnv = env(harness.db, {
      MONITORING_WORKFLOW: { create, get },
    });

    await expect(first.queueFirstWatchlistScan(workflowEnv, undefined, watchlist())).resolves.toBe(true);
    await expect(first.queueFirstWatchlistScan(workflowEnv, undefined, watchlist())).resolves.toBe(true);

    const firstRequest = create.mock.calls[0]![0] as { id: string; params: { runId: string } };
    const secondRequest = create.mock.calls[1]![0] as { id: string; params: { runId: string } };
    expect(secondRequest).toEqual(firstRequest);
    expect(get).toHaveBeenCalledWith(firstRequest.id);
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({
      count: 1,
    });
    harness.close();
  });

  it("leaves a failed handoff pending for reconciliation", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    const first = await import("~/lib/monitoring.server");
    const workflowEnv = env(harness.db, {
      MONITORING_WORKFLOW: {
        create: vi.fn(async () => {
          throw new Error("workflow unavailable");
        }),
        get: vi.fn(async () => {
          throw new Error("missing workflow");
        }),
      },
    });

    await expect(first.queueFirstWatchlistScan(workflowEnv, undefined, watchlist())).rejects.toThrow(
      "workflow unavailable",
    );
    expect(
      harness.sqlite
        .prepare("SELECT status, error_code, processing_token FROM watchlist_run")
        .get(),
    ).toEqual({
      status: "pending",
      error_code: "first_scan_dispatch_failed",
      processing_token: null,
    });
    harness.close();
  });

  it("rejects activation work while an unrelated manual run is active", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    harness.sqlite
      .prepare(
        `INSERT INTO watchlist_run (
          id, watchlist_id, trigger_type, status, page_budget, summary_json, started_at,
          created_at, updated_at, idempotency_key, queued_at, attempt_count
        ) VALUES ('manual-run', 'watch-1', 'manual', 'pending', 2, '{}', ?, ?, ?, 'manual:other', ?, 0)`,
      )
      .run(
        "2026-07-15T00:00:00.000Z",
        "2026-07-15T00:00:00.000Z",
        "2026-07-15T00:00:00.000Z",
        "2026-07-15T00:00:00.000Z",
      );
    const { prepareFirstWatchlistScanRun } = await import("~/lib/monitoring.server");

    await expect(prepareFirstWatchlistScanRun(env(harness.db), watchlist())).rejects.toThrow(
      /already running/i,
    );
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({
      count: 1,
    });
    harness.close();
  });

  it("reconciles pending and retryable failed activation runs but not provider-unknown failures", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    const { prepareFirstWatchlistScanRun } = await import("~/lib/monitoring.server");
    const descriptor = await prepareFirstWatchlistScanRun(env(harness.db), watchlist());
    harness.sqlite
      .prepare(
        `UPDATE watchlist_run
         SET status = 'failed', error_code = 'first_scan_setup_failed', finished_at = ?, retry_after = NULL
         WHERE id = ?`,
      )
      .run("2026-07-15T00:01:00.000Z", descriptor.runId);
    const create = vi.fn(async ({ id }: { id: string }) => ({ id }));
    const { reconcileFirstWatchlistScanRuns } = await import("~/lib/monitoring-fanout.server");

    const result = await reconcileFirstWatchlistScanRuns(
      env(harness.db, { MONITORING_WORKFLOW: { create, get: vi.fn() } }),
    );
    expect(result).toEqual({ redispatched: 1, cancelled: 0, failures: 0 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(harness.sqlite.prepare("SELECT status, finished_at FROM watchlist_run").get()).toEqual({
      status: "pending",
      finished_at: null,
    });

    harness.sqlite
      .prepare(
        `UPDATE watchlist_run
         SET status = 'failed', error_code = 'provider_unknown', finished_at = ?, workflow_instance_id = NULL
         WHERE id = ?`,
      )
      .run("2026-07-15T00:02:00.000Z", descriptor.runId);
    create.mockClear();
    await expect(
      reconcileFirstWatchlistScanRuns(
        env(harness.db, { MONITORING_WORKFLOW: { create, get: vi.fn() } }),
      ),
    ).resolves.toEqual({ redispatched: 0, cancelled: 0, failures: 0 });
    expect(create).not.toHaveBeenCalled();
    harness.close();
  });

  it("atomically reserves exactly three concurrent free activation scans", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    for (let index = 2; index <= 4; index += 1) {
      harness.sqlite
        .prepare(
          `INSERT INTO watchlist (
            id, user_id, name, target_type, target_id, target_fingerprint,
            target_label, is_active, created_at, updated_at
          ) VALUES (?, 'user-1', ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          `watch-${index}`,
          `Test watch ${index}`,
          `target-${index}`,
          `fp-${index}`,
          `Target ${index}`,
          `2026-07-15T00:00:0${index}.000Z`,
          `2026-07-15T00:00:0${index}.000Z`,
        );
    }
    const first = await import("~/lib/monitoring.server");
    const descriptors = [];
    for (let index = 1; index <= 4; index += 1) {
      descriptors.push(
        await first.prepareFirstWatchlistScanRun(env(harness.db), {
          ...watchlist(),
          id: `watch-${index}`,
          name: `Test watch ${index}`,
          targetId: `target-${index}`,
          targetFingerprint: `fp-${index}`,
          targetLabel: `Target ${index}`,
        }),
      );
    }

    const reservations = await Promise.all(
      descriptors.map((descriptor) =>
        first.reserveFirstWatchlistScanDailyQuota(env(harness.db), {
          runId: descriptor.runId,
          userId: "user-1",
          now: new Date("2026-07-15T12:00:00.000Z"),
        }),
      ),
    );
    expect(reservations.filter(Boolean)).toHaveLength(3);
    expect(
      harness.sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM watchlist_run
           WHERE json_extract(summary_json, '$.firstScanQuotaReserved') = 1`,
        )
        .get(),
    ).toEqual({ count: 3 });
    await expect(
      first.reserveFirstWatchlistScanDailyQuota(env(harness.db), {
        runId: descriptors[0]!.runId,
        userId: "user-1",
        now: new Date("2026-07-15T12:00:00.000Z"),
      }),
    ).resolves.toBe(true);
    harness.close();
  });

  it("fails closed before claim when a Workflow payload does not match the durable identity", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    const first = await import("~/lib/monitoring.server");
    const fanout = await import("~/lib/monitoring-fanout.server");
    const descriptor = await first.prepareFirstWatchlistScanRun(env(harness.db), watchlist());
    await fanout.markOrchestratedRunDispatched(env(harness.db), {
      runId: descriptor.runId,
      workflowInstanceId: descriptor.workflowInstanceId,
    });

    await expect(
      first.runFirstWatchlistScanWorkflowJob(env(harness.db), {
        kind: "first_scan",
        ...descriptor,
        workflowInstanceId: "monitor-v1-tampered",
      }),
    ).rejects.toThrow(/payload identity is invalid/i);
    expect(
      harness.sqlite
        .prepare("SELECT status, attempt_count, processing_token FROM watchlist_run")
        .get(),
    ).toEqual({ status: "pending", attempt_count: 0, processing_token: null });
    harness.close();
  });

  it("marks retryable activation work terminal after the bounded attempt budget", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    const first = await import("~/lib/monitoring.server");
    const descriptor = await first.prepareFirstWatchlistScanRun(env(harness.db), watchlist());
    harness.sqlite
      .prepare(
        `UPDATE watchlist_run
         SET status = 'failed', error_code = 'rate_limited', attempt_count = 4,
             finished_at = '2026-07-15T00:05:00.000Z'
         WHERE id = ?`,
      )
      .run(descriptor.runId);
    const create = vi.fn();
    const { reconcileFirstWatchlistScanRuns } = await import("~/lib/monitoring-fanout.server");

    await expect(
      reconcileFirstWatchlistScanRuns(
        env(harness.db, { MONITORING_WORKFLOW: { create, get: vi.fn() } }),
      ),
    ).resolves.toEqual({ redispatched: 0, cancelled: 0, failures: 0 });
    expect(create).not.toHaveBeenCalled();
    expect(
      harness.sqlite.prepare("SELECT status, error_code, retry_after FROM watchlist_run").get(),
    ).toEqual({
      status: "failed",
      error_code: "first_scan_retry_exhausted",
      retry_after: null,
    });
    harness.close();
  });
});
