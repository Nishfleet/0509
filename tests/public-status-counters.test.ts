import { describe, expect, it, vi } from "vitest";

import {
  DIGEST_STALENESS_THRESHOLD_MS,
  digestHealthState,
  getMonitoringCoverageDays,
  getPublicStatusCounters,
} from "~/lib/public-status-counters.server";
import { monitoringCoverageDays } from "~/lib/monitoring-coverage";

/**
 * Regression for issue #1780: the /status "Last digest sent" counter froze at
 * a stale date while watchlist runs stayed healthy. The Cloudflare Email
 * digest channel records a digest as `sent` at provider-accept time and has no
 * delivery-confirmation webhook, so `digest_delivery.delivered_at` is NULL for
 * email digests. The old query `MAX(delivered_at) WHERE status='sent'`
 * therefore returned the last *confirmed* delivery (2026-06-29) indefinitely.
 * The page must read the true last-sent timestamp (`created_at`) and must
 * surface the monitoring-healthy/digest-silent contradiction instead of
 * silently re-rendering a stale date.
 */

type Row = Record<string, unknown>;

function makeEnv(prepare: ReturnType<typeof vi.fn>) {
  return { DB: { prepare } } as never;
}

describe("getPublicStatusCounters digest query", () => {
  it("reads the last-sent digest from created_at across status='sent', never delivered_at", async () => {
    // Clock-relative fixture: the digest must sit inside the 7-day freshness
    // threshold on any run date, otherwise digestHealthState correctly reads
    // the record as stalled and this test fails for calendar reasons.
    const recentDigestSentAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const issued: string[] = [];
    const prepare = vi.fn((sql: string) => {
      issued.push(sql);
      let row: Row | null = null;
      if (sql.includes("SUM(CASE")) row = { total: 24, failed: 0 };
      else if (sql.includes("FROM watchlist_run")) row = { last_started_at: recentDigestSentAt };
      else if (sql.includes("FROM digest_delivery")) row = { last_digest_sent_at: recentDigestSentAt };
      return {
        bind: vi.fn(() => ({ all: vi.fn().mockResolvedValue({ results: row ? [row] : [] }) })),
      };
    });

    const result = await getPublicStatusCounters(makeEnv(prepare));

    // The digest query must read created_at for 'sent' rows — the truthful
    // last-sent timestamp — and must never read delivered_at.
    const digestSql = issued.find((sql) => sql.includes("FROM digest_delivery"));
    expect(digestSql).toBeTruthy();
    expect(digestSql).toContain("MAX(created_at)");
    expect(digestSql).toContain("status = 'sent'");
    expect(digestSql).not.toContain("delivered_at");

    expect(result).toMatchObject({
      runsInLast24h: 24,
      failedRunsInLast24h: 0,
      lastDigestSentAt: recentDigestSentAt,
      digestHealth: "recent",
    });
  });

  it("reads the earliest scheduled-observation baseline for the coverage figure", async () => {
    const prepare = vi.fn((sql: string) => {
      let row: Row | null = null;
      if (sql.includes("scheduled_observation_health_state")) row = { active_since: "2026-09-01T00:00:00.000Z" };
      else if (sql.includes("SUM(CASE")) row = { total: 24, failed: 0 };
      else if (sql.includes("FROM watchlist_run")) row = { last_started_at: "2026-09-06T09:00:04.000Z" };
      else if (sql.includes("FROM digest_delivery")) row = { last_digest_sent_at: null };
      return {
        bind: vi.fn(() => ({ all: vi.fn().mockResolvedValue({ results: row ? [row] : [] }) })),
      };
    });

    const result = await getPublicStatusCounters(makeEnv(prepare));
    expect(result!.scheduledMonitoringSince).toBe("2026-09-01T00:00:00.000Z");
  });

  it("degrades the coverage figure to null when the schedule table is empty or unreadable", async () => {
    const prepare = vi.fn((sql: string) => {
      let row: Row | null = null;
      if (sql.includes("SUM(CASE")) row = { total: 24, failed: 0 };
      else if (sql.includes("FROM watchlist_run")) row = { last_started_at: "2026-09-06T09:00:04.000Z" };
      else if (sql.includes("FROM digest_delivery")) row = { last_digest_sent_at: null };
      return {
        bind: vi.fn(() => ({ all: vi.fn().mockResolvedValue({ results: row ? [row] : [] }) })),
      };
    });

    const result = await getPublicStatusCounters(makeEnv(prepare));
    expect(result!.scheduledMonitoringSince).toBeNull();
  });

  it("flags a stall when no digest has been sent in 7 days while monitoring is healthy", async () => {
    const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const prepare = vi.fn((sql: string) => {
      let row: Row | null = null;
      if (sql.includes("SUM(CASE")) row = { total: 24, failed: 0 };
      else if (sql.includes("FROM watchlist_run")) row = { last_started_at: "2026-09-06T09:00:04.000Z" };
      else if (sql.includes("FROM digest_delivery")) row = { last_digest_sent_at: stale };
      return {
        bind: vi.fn(() => ({ all: vi.fn().mockResolvedValue({ results: row ? [row] : [] }) })),
      };
    });

    const result = await getPublicStatusCounters(makeEnv(prepare));
    expect(result).not.toBeNull();
    expect(result!.lastDigestSentAt).toBe(stale);
    expect(result!.runsInLast24h).toBe(24);
    expect(result!.digestHealth).toBe("stalled");
  });
});

describe("getMonitoringCoverageDays footer figure (issue #2972)", () => {
  it("converts the earliest baseline into whole coverage days", () => {
    expect(
      monitoringCoverageDays("2026-09-01T00:00:00.000Z", "2026-09-12T12:00:00.000Z"),
    ).toBe(11);
    expect(monitoringCoverageDays(null, "2026-09-12T00:00:00.000Z")).toBeNull();
    // A baseline in the future (skewed write) must never render a negative
    // "uptime" figure.
    expect(
      monitoringCoverageDays("2026-09-13T00:00:00.000Z", "2026-09-12T00:00:00.000Z"),
    ).toBeNull();
  });

  it("returns null when the DB is not configured", async () => {
    const result = await getMonitoringCoverageDays({ DB: undefined } as never);
    expect(result).toBeNull();
  });

  it("reads MIN(baseline_at) and returns whole days", async () => {
    const issued: string[] = [];
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const prepare = vi.fn((sql: string) => {
      issued.push(sql);
      return {
        bind: vi.fn(() => ({
          all: vi.fn().mockResolvedValue({ results: [{ active_since: tenDaysAgo }] }),
        })),
      };
    });

    const result = await getMonitoringCoverageDays(makeEnv(prepare));
    expect(issued[0]).toContain("MIN(baseline_at)");
    expect(issued[0]).toContain("scheduled_observation_health_state");
    expect(result).toBe(10);
  });

  it("returns null when the baseline table is empty", async () => {
    const prepare = vi.fn(() => ({
      bind: vi.fn(() => ({ all: vi.fn().mockResolvedValue({ results: [{ active_since: null }] }) })),
    }));

    const result = await getMonitoringCoverageDays(makeEnv(prepare));
    expect(result).toBeNull();
  });
});

describe("digestHealthState contradiction detector", () => {
  const nowMs = Date.now();
  const fresh = new Date(nowMs - 60 * 60 * 1000).toISOString();
  // Just inside the 7-day window (a tick below the threshold), so ms rounding
  // on ISO serialization cannot push it past the cutoff.
  const justWithinSevenDays = new Date(
    nowMs - DIGEST_STALENESS_THRESHOLD_MS + 60_000,
  ).toISOString();
  const tenDaysAgo = new Date(nowMs - 10 * 24 * 60 * 60 * 1000).toISOString();

  it("returns recent for a fresh digest timestamp", () => {
    expect(
      digestHealthState({ runsInLast24h: 24, failedRunsInLast24h: 0, lastDigestSentAt: fresh }),
    ).toBe("recent");
  });

  it("returns recent for a digest sent just inside the 7-day window", () => {
    expect(
      digestHealthState({
        runsInLast24h: 24,
        failedRunsInLast24h: 0,
        lastDigestSentAt: justWithinSevenDays,
      }),
    ).toBe("recent");
  });

  it("flags stalled when digest is older than 7 days while monitoring succeeds", () => {
    expect(
      digestHealthState({ runsInLast24h: 24, failedRunsInLast24h: 0, lastDigestSentAt: tenDaysAgo }),
    ).toBe("stalled");
  });

  it("returns unknown when digest is old but every recent monitoring run failed", () => {
    // All 24 runs failed — the whole pipeline is down, so this is not a
    // digest-specific contradiction.
    expect(
      digestHealthState({ runsInLast24h: 24, failedRunsInLast24h: 24, lastDigestSentAt: tenDaysAgo }),
    ).toBe("unknown");
  });

  it("returns unknown when digest is old but monitoring is silent", () => {
    expect(
      digestHealthState({ runsInLast24h: 0, failedRunsInLast24h: 0, lastDigestSentAt: tenDaysAgo }),
    ).toBe("unknown");
  });

  it("returns stalled when there is no digest record yet but monitoring succeeds", () => {
    expect(
      digestHealthState({ runsInLast24h: 3, failedRunsInLast24h: 0, lastDigestSentAt: null }),
    ).toBe("stalled");
  });

  it("returns unknown during the pre-send bootstrap (nothing sent, nothing running)", () => {
    expect(
      digestHealthState({ runsInLast24h: 0, failedRunsInLast24h: 0, lastDigestSentAt: null }),
    ).toBe("unknown");
  });
});
