import { afterEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1 } from "./helpers/sqlite-d1";

/**
 * Abandoned-onboarding nudge (issue #2114).
 *
 * Covers the three acceptance surfaces:
 *   1. selection — a user created 24-48h ago with zero watchlists and no
 *      prior nudge is selected;
 *   2. idempotency — a user who already has an `onboarding_nudge`
 *      delivery_attempt row is never re-selected, and a second sweep does
 *      not double-send;
 *   3. unsubscribe header — the send path passes a List-Unsubscribe URL to
 *      the provider so the email carries a one-click unsubscribe.
 */

const TEMPLATE_NAME = "onboarding_nudge";

function createNudgeTables(harness: ReturnType<typeof createSqliteD1>) {
  harness.sqlite.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      onboardedAt TEXT,
      signup_source TEXT
    );
    CREATE TABLE watchlist (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_fingerprint TEXT NOT NULL,
      target_label TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_scanned_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE delivery_target (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      watchlist_id TEXT,
      channel TEXT NOT NULL,
      target_value TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      is_validated INTEGER NOT NULL DEFAULT 0,
      is_opted_in INTEGER NOT NULL DEFAULT 0,
      opt_in_source TEXT,
      opted_in_at TEXT,
      is_paused INTEGER NOT NULL DEFAULT 0,
      paused_at TEXT,
      opted_out_at TEXT,
      template_eligible INTEGER NOT NULL DEFAULT 0,
      last_successful_delivery_at TEXT,
      last_successful_attempt_id TEXT,
      provider_identifier TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE delivery_attempt (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      watchlist_id TEXT,
      digest_run_id TEXT,
      delivery_target_id TEXT,
      lane TEXT NOT NULL,
      channel TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      webhook_status TEXT NOT NULL,
      target_value TEXT NOT NULL,
      provider_message_id TEXT,
      provider_status_last_seen_at TEXT,
      template_name TEXT,
      event_ids_json TEXT NOT NULL DEFAULT '[]',
      payload_snapshot_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT UNIQUE,
      error_message TEXT,
      sent_at TEXT,
      failed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE workspace_delivery_config (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL UNIQUE,
      sensitivity_mode TEXT NOT NULL DEFAULT 'balanced',
      instant_enabled INTEGER NOT NULL DEFAULT 0,
      digest_enabled INTEGER NOT NULL DEFAULT 1,
      email_enabled INTEGER NOT NULL DEFAULT 1,
      whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
      quiet_hours_json TEXT,
      timezone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function insertUser(
  harness: ReturnType<typeof createSqliteD1>,
  input: {
    id: string;
    email: string;
    name: string;
    createdAt: string;
    signupSource?: string | null;
  },
) {
  harness.sqlite
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, signup_source)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.name,
      input.email,
      input.createdAt,
      input.createdAt,
      input.signupSource ?? null,
    );
}

function insertWatchlist(
  harness: ReturnType<typeof createSqliteD1>,
  input: { id: string; userId: string; createdAt: string },
) {
  harness.sqlite
    .prepare(
      `INSERT INTO watchlist (
        id, user_id, name, target_type, target_id, target_fingerprint,
        target_label, is_active, created_at, updated_at
       ) VALUES (?, ?, 'watch', 'advertiser', 'target-1', 'fp-1', 'Brand', 1, ?, ?)`,
    )
    .run(input.id, input.userId, input.createdAt, input.createdAt);
}

function insertDeliveryTarget(
  harness: ReturnType<typeof createSqliteD1>,
  input: { id: string; userId: string; targetValue: string },
) {
  harness.sqlite
    .prepare(
      `INSERT INTO delivery_target (
        id, user_id, watchlist_id, channel, target_value, validation_status,
        is_validated, is_opted_in, opt_in_source, opted_in_at, is_paused,
        template_eligible, created_at, updated_at
       ) VALUES (?, ?, NULL, 'email', ?, 'validated', 1, 1, 'account_email', ?, 0, 0, ?, ?)`,
    )
    .run(
      input.id,
      input.userId,
      input.targetValue,
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    );
}

function insertDeliveryAttempt(
  harness: ReturnType<typeof createSqliteD1>,
  input: {
    id: string;
    userId: string;
    templateName: string;
    idempotencyKey: string;
    status?: string;
  },
) {
  const now = new Date().toISOString();
  harness.sqlite
    .prepare(
      `INSERT INTO delivery_attempt (
        id, user_id, watchlist_id, digest_run_id, delivery_target_id, lane,
        channel, provider, status, webhook_status, target_value,
        provider_message_id, provider_status_last_seen_at, template_name,
        event_ids_json, payload_snapshot_json, idempotency_key, error_message,
        sent_at, failed_at, created_at, updated_at
       ) VALUES (?, ?, NULL, NULL, NULL, 'customer', 'email', 'cloudflare_email',
        ?, 'provider_unknown', 'owner@example.com', NULL, NULL, ?,
        '[]', '{}', ?, NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      input.id,
      input.userId,
      input.status ?? "sent",
      input.templateName,
      input.idempotencyKey,
      now,
      now,
    );
}

describe("onboarding nudge send window (IST default)", () => {
  it("treats an unknown timezone as IST and lands inside the 09:00-11:00 window at the 04:00 UTC daily run", async () => {
    const { isWithinSendWindow } = await import("~/lib/onboarding-nudge.server");
    // 04:00 UTC = 09:30 IST, inside 09:00-11:00.
    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    expect(isWithinSendWindow(now, null)).toBe(true);
    expect(isWithinSendWindow(now, undefined)).toBe(true);
    expect(isWithinSendWindow(now, "Asia/Kolkata")).toBe(true);
  });

  it("skips a user whose local time at the 04:00 UTC run is outside 09:00-11:00", async () => {
    const { isWithinSendWindow } = await import("~/lib/onboarding-nudge.server");
    // 04:00 UTC = 00:00 in New York (UTC-4 in September), outside the window.
    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    expect(isWithinSendWindow(now, "America/New_York")).toBe(false);
    // 04:00 UTC = 04:00 in UTC, outside the window.
    expect(isWithinSendWindow(now, "UTC")).toBe(false);
  });

  it("falls back to IST for an invalid timezone name", async () => {
    const { isWithinSendWindow } = await import("~/lib/onboarding-nudge.server");
    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    expect(isWithinSendWindow(now, "Not/ARealZone")).toBe(true);
  });
});

describe("onboarding nudge selection (sqlite)", () => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length > 0) fixtures.pop()?.close();
  });

  it("selects a user created 24-48h ago with zero watchlists and no prior nudge", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createNudgeTables(harness);

    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    const eligible = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
    const tooOld = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();
    const tooNew = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

    insertUser(harness, { id: "user-eligible", email: "a@example.com", name: "A", createdAt: eligible });
    insertUser(harness, { id: "user-too-old", email: "b@example.com", name: "B", createdAt: tooOld });
    insertUser(harness, { id: "user-too-new", email: "c@example.com", name: "C", createdAt: tooNew });

    const { listAbandonedOnboardingUsers } = await import("~/lib/onboarding-nudge.server");
    const selected = await listAbandonedOnboardingUsers(
      { DB: harness.db } as never,
      now,
    );

    expect(selected.map((u) => u.id)).toEqual(["user-eligible"]);
  });

  it("excludes a user who already has a watchlist", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createNudgeTables(harness);

    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    const eligible = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();

    insertUser(harness, { id: "user-with-watch", email: "a@example.com", name: "A", createdAt: eligible });
    insertWatchlist(harness, { id: "watch-1", userId: "user-with-watch", createdAt: eligible });

    const { listAbandonedOnboardingUsers } = await import("~/lib/onboarding-nudge.server");
    const selected = await listAbandonedOnboardingUsers(
      { DB: harness.db } as never,
      now,
    );

    expect(selected).toEqual([]);
  });

  it("excludes a user who already received an onboarding nudge", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createNudgeTables(harness);

    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    const eligible = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();

    insertUser(harness, { id: "user-nudged", email: "a@example.com", name: "A", createdAt: eligible });
    insertDeliveryAttempt(harness, {
      id: "attempt-1",
      userId: "user-nudged",
      templateName: TEMPLATE_NAME,
      idempotencyKey: `onboarding-nudge:user-nudged`,
    });

    const { listAbandonedOnboardingUsers } = await import("~/lib/onboarding-nudge.server");
    const selected = await listAbandonedOnboardingUsers(
      { DB: harness.db } as never,
      now,
    );

    expect(selected).toEqual([]);
  });

  it("does not exclude a user whose only delivery_attempt is a different template", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createNudgeTables(harness);

    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    const eligible = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();

    insertUser(harness, { id: "user-other-template", email: "a@example.com", name: "A", createdAt: eligible });
    insertDeliveryAttempt(harness, {
      id: "attempt-1",
      userId: "user-other-template",
      templateName: "welcome",
      idempotencyKey: "welcome:user-other-template",
    });

    const { listAbandonedOnboardingUsers } = await import("~/lib/onboarding-nudge.server");
    const selected = await listAbandonedOnboardingUsers(
      { DB: harness.db } as never,
      now,
    );

    expect(selected.map((u) => u.id)).toEqual(["user-other-template"]);
  });
});

describe("onboarding nudge send + idempotency (sqlite)", () => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length > 0) fixtures.pop()?.close();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("sends exactly one nudge per user and records the delivery_attempt", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createNudgeTables(harness);

    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    const eligible = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
    insertUser(harness, { id: "user-1", email: "owner@example.com", name: "Owner", createdAt: eligible });
    insertDeliveryTarget(harness, { id: "target-1", userId: "user-1", targetValue: "owner@example.com" });

    const send = vi.fn().mockResolvedValue({ messageId: "msg-1" });
    vi.doMock("~/lib/delivery-email-core.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/delivery-email-core.server")>();
      return {
        ...actual,
        sendCloudflareEmail: vi.fn().mockImplementation(async (env, input) => {
          await send(env, input);
          return {
            provider: "cloudflare_email",
            status: "sent",
            webhookStatus: "provider_unknown",
            providerMessageId: "msg-1",
            providerStatusLastSeenAt: new Date().toISOString(),
            errorMessage: null,
            deliveredAt: null,
          };
        }),
      };
    });
    vi.doMock("~/lib/unsubscribe.server", () => ({
      buildUnsubscribeUrl: vi.fn().mockResolvedValue("https://0509.io/unsubscribe?token=abc"),
    }));

    const { runOnboardingNudgeSweep } = await import("~/lib/onboarding-nudge.server");
    const env = {
      DB: harness.db,
      EMAIL: { send },
      EMAIL_FROM_EMAIL: "alerts@0509.io",
      BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
      BETTER_AUTH_URL: "https://0509.io",
    } as never;

    const first = await runOnboardingNudgeSweep(env, { now });
    expect(first).toMatchObject({ selected: 1, sent: 1, skipped: 0, failed: 0 });

    // A second sweep must not re-select or re-send the same user.
    const second = await runOnboardingNudgeSweep(env, { now });
    expect(second).toMatchObject({ selected: 0, sent: 0, skipped: 0, failed: 0 });

    expect(send).toHaveBeenCalledTimes(1);
    const attempt = harness.sqlite
      .prepare("SELECT COUNT(*) AS count, status FROM delivery_attempt")
      .get();
    expect(attempt).toMatchObject({ count: 1, status: "sent" });
  });

  it("passes a List-Unsubscribe URL to the provider", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createNudgeTables(harness);

    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    const eligible = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
    insertUser(harness, { id: "user-1", email: "owner@example.com", name: "Owner", createdAt: eligible });
    insertDeliveryTarget(harness, { id: "target-1", userId: "user-1", targetValue: "owner@example.com" });

    const send = vi.fn().mockResolvedValue({ messageId: "msg-1" });
    const sendCloudflareEmail = vi.fn().mockResolvedValue({
      provider: "cloudflare_email",
      status: "sent",
      webhookStatus: "provider_unknown",
      providerMessageId: "msg-1",
      providerStatusLastSeenAt: new Date().toISOString(),
      errorMessage: null,
      deliveredAt: null,
    });
    vi.doMock("~/lib/delivery-email-core.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/delivery-email-core.server")>();
      return {
        ...actual,
        sendCloudflareEmail,
      };
    });
    vi.doMock("~/lib/unsubscribe.server", () => ({
      buildUnsubscribeUrl: vi.fn().mockResolvedValue("https://0509.io/unsubscribe?token=abc"),
    }));

    const { runOnboardingNudgeSweep } = await import("~/lib/onboarding-nudge.server");
    const env = {
      DB: harness.db,
      EMAIL: { send },
      EMAIL_FROM_EMAIL: "alerts@0509.io",
      BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
      BETTER_AUTH_URL: "https://0509.io",
    } as never;

    const result = await runOnboardingNudgeSweep(env, { now });
    expect(result).toMatchObject({ sent: 1 });

    expect(sendCloudflareEmail).toHaveBeenCalledTimes(1);
    const call = sendCloudflareEmail.mock.calls[0]?.[1] as {
      unsubscribeUrl: string | null;
    };
    expect(call.unsubscribeUrl).toBe("https://0509.io/unsubscribe?token=abc");
  });
});

/**
 * Paused-watchlist re-engagement (issue #2115).
 *
 * Covers the three acceptance surfaces:
 *   1. selection — a user owning a watchlist paused 14+ days with no prior
 *      resume attempt is selected, with the paused count;
 *   2. idempotency — a user who already has a `watchlist_resume`
 *      delivery_attempt row is never re-selected;
 *   3. one-send guarantee — a second sweep does not double-send.
 */

const RESUME_TEMPLATE_NAME = "watchlist_resume";

function insertPausedWatchlist(
  harness: ReturnType<typeof createSqliteD1>,
  input: { id: string; userId: string; pausedAt: string },
) {
  harness.sqlite
    .prepare(
      `INSERT INTO watchlist (
        id, user_id, name, target_type, target_id, target_fingerprint,
        target_label, is_active, created_at, updated_at
       ) VALUES (?, ?, 'watch', 'advertiser', 'target-1', 'fp-1', 'Brand', 0, ?, ?)`,
    )
    .run(input.id, input.userId, input.pausedAt, input.pausedAt);
}

function insertActiveWatchlist(
  harness: ReturnType<typeof createSqliteD1>,
  input: { id: string; userId: string; createdAt: string },
) {
  harness.sqlite
    .prepare(
      `INSERT INTO watchlist (
        id, user_id, name, target_type, target_id, target_fingerprint,
        target_label, is_active, created_at, updated_at
       ) VALUES (?, ?, 'watch', 'advertiser', 'target-1', 'fp-1', 'Brand', 1, ?, ?)`,
    )
    .run(input.id, input.userId, input.createdAt, input.createdAt);
}

describe("watchlist resume selection (sqlite)", () => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length > 0) fixtures.pop()?.close();
  });

  it("selects a user owning a watchlist paused 14+ days with no prior resume", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createNudgeTables(harness);

    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    const pausedLong = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const pausedRecent = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

    insertUser(harness, { id: "user-paused-long", email: "a@example.com", name: "A", createdAt: pausedLong });
    insertPausedWatchlist(harness, { id: "watch-1", userId: "user-paused-long", pausedAt: pausedLong });
    insertPausedWatchlist(harness, { id: "watch-2", userId: "user-paused-long", pausedAt: pausedLong });

    insertUser(harness, { id: "user-paused-recent", email: "b@example.com", name: "B", createdAt: pausedRecent });
    insertPausedWatchlist(harness, { id: "watch-3", userId: "user-paused-recent", pausedAt: pausedRecent });

    const { listPausedWatchlistUsers } = await import("~/lib/onboarding-nudge.server");
    const selected = await listPausedWatchlistUsers(
      { DB: harness.db } as never,
      now,
    );

    expect(selected.map((u) => u.id)).toEqual(["user-paused-long"]);
    expect(selected[0]?.pausedCount).toBe(2);
  });

  it("excludes a user whose watchlist is active", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createNudgeTables(harness);

    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    const old = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();

    insertUser(harness, { id: "user-active", email: "a@example.com", name: "A", createdAt: old });
    insertActiveWatchlist(harness, { id: "watch-1", userId: "user-active", createdAt: old });

    const { listPausedWatchlistUsers } = await import("~/lib/onboarding-nudge.server");
    const selected = await listPausedWatchlistUsers(
      { DB: harness.db } as never,
      now,
    );

    expect(selected).toEqual([]);
  });

  it("excludes a user who already received a watchlist resume email", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createNudgeTables(harness);

    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    const pausedLong = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();

    insertUser(harness, { id: "user-resumed", email: "a@example.com", name: "A", createdAt: pausedLong });
    insertPausedWatchlist(harness, { id: "watch-1", userId: "user-resumed", pausedAt: pausedLong });
    insertDeliveryAttempt(harness, {
      id: "attempt-1",
      userId: "user-resumed",
      templateName: RESUME_TEMPLATE_NAME,
      idempotencyKey: `watchlist-resume:user-resumed`,
    });

    const { listPausedWatchlistUsers } = await import("~/lib/onboarding-nudge.server");
    const selected = await listPausedWatchlistUsers(
      { DB: harness.db } as never,
      now,
    );

    expect(selected).toEqual([]);
  });

  it("does not exclude a user whose only delivery_attempt is a different template", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    createNudgeTables(harness);

    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    const pausedLong = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();

    insertUser(harness, { id: "user-other-template", email: "a@example.com", name: "A", createdAt: pausedLong });
    insertPausedWatchlist(harness, { id: "watch-1", userId: "user-other-template", pausedAt: pausedLong });
    insertDeliveryAttempt(harness, {
      id: "attempt-1",
      userId: "user-other-template",
      templateName: "onboarding_nudge",
      idempotencyKey: "onboarding-nudge:user-other-template",
    });

    const { listPausedWatchlistUsers } = await import("~/lib/onboarding-nudge.server");
    const selected = await listPausedWatchlistUsers(
      { DB: harness.db } as never,
      now,
    );

    expect(selected.map((u) => u.id)).toEqual(["user-other-template"]);
  });
});

describe("watchlist resume send + idempotency (sqlite)", () => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length > 0) fixtures.pop()?.close();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("sends exactly one resume email per user and records the delivery_attempt", async () => {
    vi.resetModules();
    const harness = createSqliteD1();
    fixtures.push(harness);
    createNudgeTables(harness);

    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    const pausedLong = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
    insertUser(harness, { id: "user-1", email: "owner@example.com", name: "Owner", createdAt: pausedLong });
    insertPausedWatchlist(harness, { id: "watch-1", userId: "user-1", pausedAt: pausedLong });
    insertDeliveryTarget(harness, { id: "target-1", userId: "user-1", targetValue: "owner@example.com" });

    const send = vi.fn().mockResolvedValue({ messageId: "msg-1" });
    const sendCloudflareEmail = vi.fn().mockImplementation(async (env, input) => {
      await send(env, input);
      return {
        provider: "cloudflare_email",
        status: "sent",
        webhookStatus: "provider_unknown",
        providerMessageId: "msg-1",
        providerStatusLastSeenAt: new Date().toISOString(),
        errorMessage: null,
        deliveredAt: null,
      };
    });
    vi.doMock("~/lib/delivery-email-core.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/delivery-email-core.server")>();
      return {
        ...actual,
        sendCloudflareEmail,
      };
    });
    vi.doMock("~/lib/unsubscribe.server", () => ({
      buildUnsubscribeUrl: vi.fn().mockResolvedValue("https://0509.io/unsubscribe?token=abc"),
    }));

    const { runWatchlistResumeSweep } = await import("~/lib/onboarding-nudge.server");
    const env = {
      DB: harness.db,
      EMAIL: { send },
      EMAIL_FROM_EMAIL: "alerts@0509.io",
      BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
      BETTER_AUTH_URL: "https://0509.io",
    } as never;

    const first = await runWatchlistResumeSweep(env, { now });
    expect(first).toMatchObject({ selected: 1, sent: 1, skipped: 0, failed: 0 });

    // A second sweep must not re-select or re-send the same user.
    const second = await runWatchlistResumeSweep(env, { now });
    expect(second).toMatchObject({ selected: 0, sent: 0, skipped: 0, failed: 0 });

    expect(sendCloudflareEmail).toHaveBeenCalledTimes(1);
    const attempt = harness.sqlite
      .prepare("SELECT COUNT(*) AS count, status FROM delivery_attempt")
      .get();
    expect(attempt).toMatchObject({ count: 1, status: "sent" });
  });

  it("passes a List-Unsubscribe URL to the provider", async () => {
    vi.resetModules();
    const harness = createSqliteD1();
    fixtures.push(harness);
    createNudgeTables(harness);

    const now = new Date("2026-09-10T04:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    const pausedLong = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
    insertUser(harness, { id: "user-1", email: "owner@example.com", name: "Owner", createdAt: pausedLong });
    insertPausedWatchlist(harness, { id: "watch-1", userId: "user-1", pausedAt: pausedLong });
    insertDeliveryTarget(harness, { id: "target-1", userId: "user-1", targetValue: "owner@example.com" });

    const send = vi.fn().mockResolvedValue({ messageId: "msg-1" });
    const sendCloudflareEmail = vi.fn().mockResolvedValue({
      provider: "cloudflare_email",
      status: "sent",
      webhookStatus: "provider_unknown",
      providerMessageId: "msg-1",
      providerStatusLastSeenAt: new Date().toISOString(),
      errorMessage: null,
      deliveredAt: null,
    });
    vi.doMock("~/lib/delivery-email-core.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/delivery-email-core.server")>();
      return {
        ...actual,
        sendCloudflareEmail,
      };
    });
    vi.doMock("~/lib/unsubscribe.server", () => ({
      buildUnsubscribeUrl: vi.fn().mockResolvedValue("https://0509.io/unsubscribe?token=abc"),
    }));

    const { runWatchlistResumeSweep } = await import("~/lib/onboarding-nudge.server");
    const env = {
      DB: harness.db,
      EMAIL: { send },
      EMAIL_FROM_EMAIL: "alerts@0509.io",
      BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
      BETTER_AUTH_URL: "https://0509.io",
    } as never;

    const result = await runWatchlistResumeSweep(env, { now });
    expect(result).toMatchObject({ sent: 1 });

    expect(sendCloudflareEmail).toHaveBeenCalledTimes(1);
    const call = sendCloudflareEmail.mock.calls[0]?.[1] as {
      unsubscribeUrl: string | null;
    };
    expect(call.unsubscribeUrl).toBe("https://0509.io/unsubscribe?token=abc");
  });
});
