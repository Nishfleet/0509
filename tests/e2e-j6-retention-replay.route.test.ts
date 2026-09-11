import { afterEach, describe, expect, it, vi } from "vitest";

import { action } from "~/lib/e2e-j6-retention-replay.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

const VIEWPORT = "375x812";
const IDEMPOTENCY_KEY = `e2e-j6-retention-failure-${VIEWPORT}`;
const RUN_ID = `e2e-run-j6-retention-failure-${VIEWPORT}`;
const CACHE_KEY = `e2e-j6-retention:${VIEWPORT}`;
const QUERY_FINGERPRINT = `e2e-j6-retention-${VIEWPORT}`;
const STALE_TIMESTAMP = new Date(Date.now() - 60 * 60 * 1_000).toISOString();

const requestEnv: { current: unknown } = { current: null };

vi.mock("~/lib/context.server", () => ({
  getEnv: vi.fn(() => requestEnv.current),
}));

vi.mock("~/lib/e2e-auth.server", () => ({
  isE2ETestRequestEnabled: vi.fn(async () => true),
}));

vi.mock("~/lib/e2e-provider.server", () => ({
  resolveE2EProviderDeny: vi.fn(async () => ({ enabled: true, failClosed: true, reason: "enabled" })),
  sanitizeE2EProviderEnv: vi.fn((env: unknown) => env),
}));

vi.mock("~/lib/cron-failure-alert.server", () => ({
  alertScheduledTaskFailure: vi.fn(async () => ({ sent: true, reason: "sent" })),
}));

vi.mock("~/lib/retention.server", () => ({
  // Mirror the real sweep's contract: per-step delete, `deleted[step]` on
  // success and `failedSteps` on throw — through the caller's DB binding so
  // the failure-injection proxy still fires.
  runRetentionSweep: vi.fn(async (env: { DB?: D1Database }) => {
    const deleted: Record<string, number> = {
      discovery_fetch_log: 0,
      better_auth_magic_link_ticket: 0,
      meta_integration_log: 0,
      watchlist_run: 0,
      delivery_attempt: 0,
      landing_page_snapshot: 0,
      presence_item: 0,
    };
    const failedSteps: string[] = [];
    try {
      const result = await env.DB!.prepare("DELETE FROM discovery_cache_entry WHERE cache_key LIKE ?")
        .bind("e2e-j6-retention:%")
        .run();
      deleted.discovery_cache_entry = Number(result.meta?.changes ?? 0);
    } catch {
      failedSteps.push("discovery_cache_entry");
    }
    return { deleted, failedSteps };
  }),
}));

const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.close();
});

function createHarness() {
  const harness = createSqliteD1();
  fixtures.push(harness);
  harness.sqlite.exec(`
    CREATE TABLE e2e_j6_replay (
      idempotency_key TEXT PRIMARY KEY,
      action TEXT NOT NULL CHECK (action IN ('failure', 'recovery', 'team_membership')),
      user_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('started', 'succeeded')),
      processing_token TEXT NOT NULL,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE discovery_cache_entry (
      cache_key TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('meta_api', 'meta_library_browser', 'demo')),
      route_context TEXT NOT NULL CHECK (route_context IN ('public_search', 'watchlist_scan', 'scheduled_warmup')),
      query_fingerprint TEXT NOT NULL,
      country TEXT NOT NULL,
      cursor TEXT,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      browser_ms_used INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return harness;
}

function seedClaimRow(harness: ReturnType<typeof createSqliteD1>, updatedAt: string) {
  harness.sqlite.prepare(`
    INSERT INTO e2e_j6_replay (idempotency_key, action, user_id, run_id, status, processing_token, result_json, created_at, updated_at)
    VALUES (?, 'failure', 'e2e-starter', ?, 'started', 'dead-token', NULL, ?, ?)
  `).run(IDEMPOTENCY_KEY, RUN_ID, updatedAt, updatedAt);
}

function seedFixtureRow(harness: ReturnType<typeof createSqliteD1>) {
  const now = Date.now();
  const fetchedAt = new Date(now - 32 * 24 * 60 * 60 * 1_000).toISOString();
  const expiresAt = new Date(now - 31 * 24 * 60 * 60 * 1_000).toISOString();
  harness.sqlite.prepare(`
    INSERT INTO discovery_cache_entry (
      cache_key, provider, route_context, query_fingerprint, country, cursor,
      payload_json, fetched_at, expires_at, browser_ms_used, created_at, updated_at
    ) VALUES (?, 'demo', 'scheduled_warmup', ?, 'all', NULL, '{}', ?, ?, 0, ?, ?)
  `).run(CACHE_KEY, QUERY_FINGERPRINT, fetchedAt, expiresAt, fetchedAt, fetchedAt);
}

function replayRequest() {
  return new Request("http://127.0.0.1:43127/api/e2e/retention/replay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-0509-e2e-test-mode": "1",
      cookie: "f9_e2e_fixture=e2e-starter",
    },
    body: JSON.stringify({
      userId: "e2e-starter",
      runId: RUN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      scenario: "j6",
      clock: new Date().toISOString(),
    }),
  });
}

async function callAction(harness: ReturnType<typeof createSqliteD1>) {
  requestEnv.current = { DB: harness.db };
  return action({ context: {}, request: replayRequest(), params: {} } as never);
}

describe("Journey 6 retention replay claim", () => {
  it("reclaims a stale 'started' claim left by a crashed run instead of bricking the lane", async () => {
    const harness = createHarness();
    seedClaimRow(harness, STALE_TIMESTAMP);

    const response = await callAction(harness);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, replayed: false, outcome: "failure", viewport: VIEWPORT });
    const row = harness.sqlite
      .prepare("SELECT status, processing_token AS processingToken FROM e2e_j6_replay WHERE idempotency_key = ?")
      .get(IDEMPOTENCY_KEY) as { status: string; processingToken: string };
    expect(row.status).toBe("succeeded");
    expect(row.processingToken).not.toBe("dead-token");
  });

  it("still returns 409 while a fresh claim is in progress", async () => {
    const harness = createHarness();
    seedClaimRow(harness, new Date().toISOString());

    const response = await callAction(harness);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, blocker: "j6_retention_replay_in_progress" });
  });

  it("replaces a leftover fixture row from a crashed failure run", async () => {
    const harness = createHarness();
    seedFixtureRow(harness);

    const response = await callAction(harness);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, replayed: false, outcome: "failure" });
  });
});
