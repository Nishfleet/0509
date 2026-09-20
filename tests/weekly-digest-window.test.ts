import { afterEach, describe, expect, it } from "vitest";

import {
  enqueueDigestScheduleJobs,
  listDigestScheduleJobPeriodEnds,
  listDigestScheduleJobTimezones,
  listRetryableDigestScheduleJobs,
} from "~/lib/data/digests.server";
import {
  isWithinWeeklyDigestLocalWindow,
  resolveWeeklyDigestCatchUpWindow,
  runDigestDeliveryCycleDetailed,
} from "~/lib/digest-orchestration.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

/**
 * Issue #2406: the weekly brief used to fire one Monday 05:00 UTC shot for
 * every workspace — Sunday evening in the Americas. The three-hourly
 * monitoring tick now hosts the weekly cycle, and a workspace's digest job
 * is enqueued only while its local time sits inside the Monday 05:00-08:00
 * window. These tests pin the window math, the candidate timezone read, and
 * the filtered enqueue.
 */

const harnesses: Array<ReturnType<typeof createSqliteD1>> = [];

function setupHarness() {
  const harness = createSqliteD1();
  harnesses.push(harness);
  harness.sqlite.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      emailVerified INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE watchlist (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE delivery_attempt (
      id TEXT PRIMARY KEY NOT NULL,
      lane TEXT NOT NULL,
      channel TEXT NOT NULL,
      watchlist_id TEXT,
      digest_run_id TEXT,
      delivery_target_id TEXT,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL,
      webhook_status TEXT NOT NULL,
      target_value TEXT,
      payload_snapshot_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE delivery_target (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      watchlist_id TEXT,
      channel TEXT NOT NULL,
      is_paused INTEGER NOT NULL DEFAULT 0,
      opted_out_at TEXT,
      validation_status TEXT,
      target_value TEXT
    );
    CREATE TABLE digest_run (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE workspace_delivery_config (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL UNIQUE,
      timezone TEXT,
      digest_enabled INTEGER NOT NULL DEFAULT 1,
      email_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE watchlist_delivery_config (
      id TEXT PRIMARY KEY NOT NULL,
      watchlist_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      timezone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO user (id, email, name) VALUES
      ('user-pt', 'pt@example.com', 'PT'),
      ('user-ist', 'ist@example.com', 'IST'),
      ('user-both', 'both@example.com', 'Both'),
      ('user-paused', 'paused@example.com', 'Paused'),
      ('user-stale', 'stale@example.com', 'Stale'),
      ('user-utc', 'utc@example.com', 'UTC');
    INSERT INTO watchlist (id, user_id, is_active) VALUES
      ('watch-pt', 'user-pt', 1),
      ('watch-ist', 'user-ist', 1),
      ('watch-both', 'user-both', 1),
      ('watch-paused', 'user-paused', 0),
      ('watch-stale-active', 'user-stale', 1),
      ('watch-stale-paused', 'user-stale', 0),
      ('watch-utc', 'user-utc', 1);
    INSERT INTO workspace_delivery_config (id, user_id, timezone, created_at, updated_at) VALUES
      ('wdc-ist', 'user-ist', 'Asia/Kolkata', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('wdc-both', 'user-both', 'Europe/London', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO watchlist_delivery_config (id, watchlist_id, user_id, timezone, created_at, updated_at) VALUES
      ('wldc-pt', 'watch-pt', 'user-pt', 'America/Los_Angeles', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('wldc-both', 'watch-both', 'user-both', 'America/New_York', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('wldc-stale-paused', 'watch-stale-paused', 'user-stale', 'Pacific/Kiritimati', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);
  applyMigration(harness.sqlite, "migrations/0067_delivery_recovery_and_digest_jobs.sql");
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

describe("weekly digest local window (issue #2406)", () => {
  it("opens only inside local Monday 05:00-08:00", () => {
    const monday = (utc: string) => new Date(`2026-07-13T${utc}.000Z`);
    // UTC workspace: open 05:00 through 07:59, closed at the 08:00 edge.
    expect(isWithinWeeklyDigestLocalWindow(monday("05:00:00"), "UTC")).toBe(true);
    expect(isWithinWeeklyDigestLocalWindow(monday("07:59:00"), "UTC")).toBe(true);
    expect(isWithinWeeklyDigestLocalWindow(monday("08:00:00"), "UTC")).toBe(false);
    expect(isWithinWeeklyDigestLocalWindow(monday("04:59:00"), "UTC")).toBe(false);
    // A Tuesday instant is never a Monday window.
    expect(
      isWithinWeeklyDigestLocalWindow(new Date("2026-07-14T06:00:00.000Z"), "UTC"),
    ).toBe(false);
    // US Pacific (July = PDT, UTC-7): Monday 12:00 UTC is 05:00 local — the
    // window the landing claim promises. The old 05:00 UTC blast was Sunday
    // 22:00 local and stays out of the window.
    expect(
      isWithinWeeklyDigestLocalWindow(monday("12:00:00"), "America/Los_Angeles"),
    ).toBe(true);
    expect(
      isWithinWeeklyDigestLocalWindow(monday("05:00:00"), "America/Los_Angeles"),
    ).toBe(false);
    // Kiritimati (UTC+14): local Monday 05:00 arrives on UTC Sunday.
    expect(
      isWithinWeeklyDigestLocalWindow(
        new Date("2026-07-12T15:00:00.000Z"),
        "Pacific/Kiritimati",
      ),
    ).toBe(true);
    // Missing or invalid timezone names fall back to UTC.
    expect(isWithinWeeklyDigestLocalWindow(monday("06:00:00"), null)).toBe(true);
    expect(isWithinWeeklyDigestLocalWindow(monday("06:00:00"), "not/a-zone")).toBe(true);
  });

  it("opens exactly once per local Monday on the three-hourly tick lattice", () => {
    // Window width equals tick spacing, so for any offset exactly one tick
    // lands inside [05:00, 08:00) on the workspace's local Monday. Sweep the
    // UTC Sunday 00:00 -> Tuesday 00:00 range that contains every timezone's
    // local Monday morning.
    const zones = [
      "UTC",
      "America/Los_Angeles",
      "America/New_York",
      "America/St_Johns",
      "Europe/London",
      "Asia/Kolkata",
      "Asia/Kathmandu",
      "Australia/Sydney",
      "Pacific/Auckland",
      "Pacific/Chatham",
      "Pacific/Kiritimati",
    ];
    for (const zone of zones) {
      let hits = 0;
      for (
        let tick = Date.parse("2026-07-12T00:00:00.000Z");
        tick < Date.parse("2026-07-14T00:00:00.000Z");
        tick += 3 * 60 * 60 * 1000
      ) {
        if (isWithinWeeklyDigestLocalWindow(new Date(tick), zone)) {
          hits += 1;
        }
      }
      expect(hits, zone).toBe(1);
    }
  });

  it("resolves each workspace's effective timezone: workspace row first, then earliest watchlist row", async () => {
    const harness = setupHarness();
    const rows = await listDigestScheduleJobTimezones({ DB: harness.db } as never);
    // The workspace delivery row leads because the weekly brief is a
    // workspace-level send — deliverWeeklyDigest resolves its effective
    // config with watchlistConfig: null. The earliest watchlist row is only
    // the fallback when no workspace timezone exists (user-pt); no row at
    // all surfaces null so the caller defaults to UTC. A watchlist-row
    // fallback only counts when that watchlist is active — user-stale's only
    // configured watchlist is paused, so its Kiritimati row must not leak.
    // Workspaces without an active watchlist (the paused user) are not
    // candidates at all.
    expect(new Map(rows.map((row) => [row.userId, row.timezone]))).toEqual(
      new Map([
        ["user-pt", "America/Los_Angeles"],
        ["user-ist", "Asia/Kolkata"],
        ["user-both", "Europe/London"],
        ["user-stale", null],
        ["user-utc", null],
      ]),
    );
  });

  it("enqueues only the workspaces passed via onlyUserIds", async () => {
    const harness = setupHarness();
    const input = {
      cadence: "weekly" as const,
      periodStart: "2026-07-06T06:00:00.000Z",
      periodEnd: "2026-07-13T06:00:00.000Z",
    };

    await expect(
      enqueueDigestScheduleJobs(
        { DB: harness.db } as never,
        { ...input, onlyUserIds: ["user-utc"] },
      ),
    ).resolves.toBe(1);
    // Re-enqueueing the same period is idempotent; a later tick adds only the
    // workspaces that entered the window since.
    await expect(
      enqueueDigestScheduleJobs(
        { DB: harness.db } as never,
        { ...input, onlyUserIds: ["user-utc", "user-pt"] },
      ),
    ).resolves.toBe(1);

    const jobs = await listRetryableDigestScheduleJobs(
      { DB: harness.db } as never,
      {
        staleRunningBefore: "2026-07-13T05:45:00.000Z",
        maxAttempts: 5,
        limit: 50,
      },
    );
    expect(jobs.map((job) => job.userId).sort()).toEqual(["user-pt", "user-utc"]);
  });

  it("enqueues nothing when the window list is empty", async () => {
    const harness = setupHarness();
    await expect(
      enqueueDigestScheduleJobs(
        { DB: harness.db } as never,
        {
          cadence: "weekly",
          periodStart: "2026-07-06T06:00:00.000Z",
          periodEnd: "2026-07-13T06:00:00.000Z",
          onlyUserIds: [],
        },
      ),
    ).resolves.toBe(0);
  });

  it("files each workspace only at the tick where its local window is open", async () => {
    const harness = setupHarness();
    const env = { DB: harness.db } as never;
    const candidates = await listDigestScheduleJobTimezones(env);
    const inWindowAt = (tickIso: string) =>
      candidates
        .filter((candidate) =>
          isWithinWeeklyDigestLocalWindow(new Date(tickIso), candidate.timezone),
        )
        .map((candidate) => candidate.userId)
        .sort();

    // Monday 06:00 UTC: UTC workspace open (06:00 local), London at 07:00
    // BST, and user-stale defaults to UTC; IST is 11:30 (past its window),
    // PT is still Sunday 23:00.
    expect(inWindowAt("2026-07-13T06:00:00.000Z")).toEqual([
      "user-both",
      "user-stale",
      "user-utc",
    ]);
    // Monday 00:00 UTC: IST enters at 05:30 local.
    expect(inWindowAt("2026-07-13T00:00:00.000Z")).toEqual(["user-ist"]);
    // Monday 12:00 UTC: PT enters at 05:00 local — the watchlist-row
    // fallback, since this workspace has no workspace timezone row.
    expect(inWindowAt("2026-07-13T12:00:00.000Z")).toEqual(["user-pt"]);
    // Monday 09:00 UTC: nobody's local Monday 05:00-08:00 is open — the
    // workspace row (London, 10:00 BST) leads over user-both's watchlist row
    // (New York, 05:00 EDT), which would otherwise have fired here.
    expect(inWindowAt("2026-07-13T09:00:00.000Z")).toEqual([]);
  });
});

describe("weekly digest catch-up (issue #2734)", () => {
  it("resolves the missed tick only once local Monday is past 08:00", () => {
    const monday = (utc: string) => new Date(`2026-07-13T${utc}.000Z`);
    // UTC: nothing before the window and nothing inside it — the live gate
    // owns those cases.
    expect(
      resolveWeeklyDigestCatchUpWindow(monday("04:00:00"), "UTC"),
    ).toBeNull();
    expect(
      resolveWeeklyDigestCatchUpWindow(monday("07:59:00"), "UTC"),
    ).toBeNull();
    // From the 08:00 edge through the rest of local Monday the catch-up keys
    // on the one tick that sat inside the closed window — 06:00 UTC.
    for (const utc of ["08:00:00", "12:00:00", "23:59:00"]) {
      expect(
        resolveWeeklyDigestCatchUpWindow(monday(utc), "UTC")?.tickAt.toISOString(),
      ).toBe("2026-07-13T06:00:00.000Z");
    }
    // Tuesday never catches up — the miss is accepted past local Monday.
    expect(
      resolveWeeklyDigestCatchUpWindow(
        new Date("2026-07-14T09:00:00.000Z"),
        "UTC",
      ),
    ).toBeNull();
    // IST (UTC+5:30): the local window is 23:30-02:30 UTC, tick 00:00 UTC.
    expect(
      resolveWeeklyDigestCatchUpWindow(monday("03:00:00"), "Asia/Kolkata")
        ?.tickAt.toISOString(),
    ).toBe("2026-07-13T00:00:00.000Z");
    // US Pacific (PDT, UTC-7): Monday 15:00 UTC is 08:00 local — the tick was
    // 12:00 UTC, when the live gate would have filed it.
    expect(
      resolveWeeklyDigestCatchUpWindow(monday("15:00:00"), "America/Los_Angeles")
        ?.tickAt.toISOString(),
    ).toBe("2026-07-13T12:00:00.000Z");
    // Kiritimati (UTC+14): local Monday morning lands on UTC Sunday.
    expect(
      resolveWeeklyDigestCatchUpWindow(
        new Date("2026-07-12T18:00:00.000Z"),
        "Pacific/Kiritimati",
      )?.tickAt.toISOString(),
    ).toBe("2026-07-12T15:00:00.000Z");
    // Missing or invalid timezone names fall back to UTC.
    expect(
      resolveWeeklyDigestCatchUpWindow(monday("09:00:00"), null)?.tickAt.toISOString(),
    ).toBe("2026-07-13T06:00:00.000Z");
    expect(
      resolveWeeklyDigestCatchUpWindow(monday("09:00:00"), "not/a-zone")?.tickAt
        .toISOString(),
    ).toBe("2026-07-13T06:00:00.000Z");
  });

  it("prices the workspace's ISO-week span in its own timezone", () => {
    // IST: local Monday 00:00 is Sunday 18:30 UTC; the week ends at the next
    // local Monday 00:00 — the dedupe read's bounds, not the window's.
    const window = resolveWeeklyDigestCatchUpWindow(
      new Date("2026-07-13T09:00:00.000Z"),
      "Asia/Kolkata",
    );
    expect(window?.weekStartAt.toISOString()).toBe("2026-07-12T18:30:00.000Z");
    expect(window?.weekEndAt.toISOString()).toBe("2026-07-19T18:30:00.000Z");
    expect(window?.tickAt.toISOString()).toBe("2026-07-13T00:00:00.000Z");
  });

  it("reads filed period_ends only inside the given range for the given workspaces", async () => {
    const harness = setupHarness();
    const env = { DB: harness.db } as never;
    await enqueueDigestScheduleJobs(env, {
      cadence: "weekly",
      periodStart: "2026-07-06T06:00:00.000Z",
      periodEnd: "2026-07-13T06:00:00.000Z",
      onlyUserIds: ["user-utc"],
    });
    await enqueueDigestScheduleJobs(env, {
      cadence: "weekly",
      periodStart: "2026-06-29T06:00:00.000Z",
      periodEnd: "2026-07-06T06:00:00.000Z",
      onlyUserIds: ["user-ist"],
    });
    await enqueueDigestScheduleJobs(env, {
      cadence: "daily",
      periodStart: "2026-07-12T06:00:00.000Z",
      periodEnd: "2026-07-13T06:00:00.000Z",
      onlyUserIds: ["user-pt"],
    });

    // The user-ist row is a different week; the user-pt row is a different
    // cadence. Only the in-range weekly row for the asked workspaces returns.
    await expect(
      listDigestScheduleJobPeriodEnds(env, {
        cadence: "weekly",
        periodEndGte: "2026-07-12T00:00:00.000Z",
        periodEndLt: "2026-07-20T00:00:00.000Z",
        userIds: ["user-utc", "user-ist", "user-pt"],
      }),
    ).resolves.toEqual([
      { userId: "user-utc", periodEnd: "2026-07-13T06:00:00.000Z" },
    ]);
    await expect(
      listDigestScheduleJobPeriodEnds(env, {
        cadence: "weekly",
        periodEndGte: "2026-07-12T00:00:00.000Z",
        periodEndLt: "2026-07-20T00:00:00.000Z",
        userIds: [],
      }),
    ).resolves.toEqual([]);
  });

  it("files each missed workspace once under its intended tick, and skips weeks already filed", async () => {
    const harness = setupHarness();
    const env = { DB: harness.db } as never;
    // A job already filed for user-utc's ISO week under an off-lattice
    // period_end (a delayed tick that evaluated at actual fire time) must
    // still block the catch-up — the dedupe is the week, not the tuple.
    await enqueueDigestScheduleJobs(env, {
      cadence: "weekly",
      periodStart: "2026-07-06T05:23:00.000Z",
      periodEnd: "2026-07-13T05:23:00.000Z",
      onlyUserIds: ["user-utc"],
    });

    // Monday 09:00 UTC: the window is closed for every candidate except
    // user-pt (02:00 local). deadlineAt 0 drains nothing — only the filings
    // are observed.
    const cycle = {
      cadence: "weekly" as const,
      periodEnd: "2026-07-13T09:00:00.000Z",
      deadlineAt: 0,
    };
    await expect(
      runDigestDeliveryCycleDetailed(env, cycle),
    ).resolves.toEqual({ attempted: 0, sent: 0, failed: 0 });

    const jobs = await listRetryableDigestScheduleJobs(env, {
      staleRunningBefore: "2026-07-13T09:00:00.000Z",
      maxAttempts: 5,
      limit: 50,
    });
    expect(jobs.map((job) => `${job.userId}@${job.periodEnd}`).sort()).toEqual([
      // London's window was 04:00-07:00 UTC → the 06:00 tick.
      "user-both@2026-07-13T06:00:00.000Z",
      // IST's window was 23:30-02:30 UTC → the 00:00 tick.
      "user-ist@2026-07-13T00:00:00.000Z",
      // No usable timezone row → UTC fallback, 06:00 tick.
      "user-stale@2026-07-13T06:00:00.000Z",
      // Filed pre-window at 05:23 — already covered this week, not re-keyed.
      "user-utc@2026-07-13T05:23:00.000Z",
    ]);

    // Exactly-once per ISO week: the same tick re-run files nothing new.
    await runDigestDeliveryCycleDetailed(env, cycle);
    const again = await listRetryableDigestScheduleJobs(env, {
      staleRunningBefore: "2026-07-13T09:00:00.000Z",
      maxAttempts: 5,
      limit: 50,
    });
    expect(again.map((job) => `${job.userId}@${job.periodEnd}`).sort()).toEqual(
      jobs.map((job) => `${job.userId}@${job.periodEnd}`).sort(),
    );
  });

  it("still files a workspace whose window opens later at the same tick", async () => {
    const harness = setupHarness();
    const env = { DB: harness.db } as never;
    // Monday 12:00 UTC: user-pt enters its window (05:00 local) through the
    // live gate while the others' catch-up is a no-op — jobs already filed.
    await runDigestDeliveryCycleDetailed(env, {
      cadence: "weekly",
      periodEnd: "2026-07-13T09:00:00.000Z",
      deadlineAt: 0,
    });
    await runDigestDeliveryCycleDetailed(env, {
      cadence: "weekly",
      periodEnd: "2026-07-13T12:00:00.000Z",
      deadlineAt: 0,
    });
    const jobs = await listRetryableDigestScheduleJobs(env, {
      staleRunningBefore: "2026-07-13T12:00:00.000Z",
      maxAttempts: 5,
      limit: 50,
    });
    expect(jobs.map((job) => `${job.userId}@${job.periodEnd}`).sort()).toEqual([
      "user-both@2026-07-13T06:00:00.000Z",
      "user-ist@2026-07-13T00:00:00.000Z",
      "user-pt@2026-07-13T12:00:00.000Z",
      "user-stale@2026-07-13T06:00:00.000Z",
      "user-utc@2026-07-13T06:00:00.000Z",
    ]);
  });
});
