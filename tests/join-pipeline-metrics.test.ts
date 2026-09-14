import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatJoinLatencyMs,
  getJoinPipelineMetrics,
  JOIN_FIRST_CONFIRM_PROBE,
  recordJoinConfirmSample,
} from "~/lib/join-pipeline-metrics.server";

/**
 * Issue #3177 — the two join-path latencies /status reports, and the D1
 * sample the /join confirm leg writes. Both windows (24 h + 7 d) must be
 * filled from real rows; malformed and out-of-window rows never leak in.
 */

const NOW = new Date("2026-09-14T12:00:00.000Z");

type Row = Record<string, unknown>;

function makeEnv(prepare: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) {
  return { DB: { prepare }, ...extra } as never;
}

function request(headers: Record<string, string> = {}) {
  return new Request("https://0509.io/join", { method: "POST", headers });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordJoinConfirmSample", () => {
  it("writes a status_probe_samples row under the join_first_confirm probe", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const env = makeEnv(prepare, { FUNNEL_MEASUREMENT_ENABLED: "1" });

    await recordJoinConfirmSample(env, request(), { latencyMs: 4200, kind: "domain" });

    expect(prepare).toHaveBeenCalledTimes(1);
    const sql = prepare.mock.calls[0]![0] as string;
    expect(sql).toContain("INSERT INTO status_probe_samples");
    const bindings = bind.mock.calls[0]!;
    expect(bindings[0]).toBe(JOIN_FIRST_CONFIRM_PROBE);
    expect(bindings[1]).toBe(4200);
    expect(bindings[2]).toBe("kind=domain");
    expect(typeof bindings[3]).toBe("string");
  });

  it("records the confirm event with a null latency when the first-touch cookie was absent", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const env = makeEnv(prepare, { FUNNEL_MEASUREMENT_ENABLED: "1" });

    await recordJoinConfirmSample(env, request(), { latencyMs: null, kind: "person" });

    expect(bind.mock.calls[0]![1]).toBeNull();
    expect(bind.mock.calls[0]![2]).toBe("kind=person");
  });

  it("writes nothing when funnel measurement is off, GPC opts out, or the DB is absent", async () => {
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ run: vi.fn() })) }));

    // Flag off.
    await recordJoinConfirmSample(
      makeEnv(prepare, { FUNNEL_MEASUREMENT_ENABLED: "0" }),
      request(),
      { latencyMs: 1000, kind: "domain" },
    );
    // Flag unset entirely.
    await recordJoinConfirmSample(makeEnv(prepare), request(), {
      latencyMs: 1000,
      kind: "domain",
    });
    // GPC opt-out.
    await recordJoinConfirmSample(
      makeEnv(prepare, { FUNNEL_MEASUREMENT_ENABLED: "1" }),
      request({ "sec-gpc": "1" }),
      { latencyMs: 1000, kind: "domain" },
    );
    // No DB.
    await recordJoinConfirmSample({} as never, request(), {
      latencyMs: 1000,
      kind: "domain",
    });

    expect(prepare).not.toHaveBeenCalled();
  });

  it("clamps an out-of-range or non-finite latency to null rather than storing garbage", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const env = makeEnv(prepare, { FUNNEL_MEASUREMENT_ENABLED: "1" });

    await recordJoinConfirmSample(env, request(), { latencyMs: -50, kind: "brand" });
    expect(bind.mock.calls[0]![1]).toBeNull();
    // A kind outside the resolver enum collapses to the generic bucket.
    expect(bind.mock.calls[0]![2]).toBe("kind=brand");
  });

  it("never throws: a failed insert is a warn, not a broken confirm", async () => {
    const bind = vi.fn(() => ({ run: vi.fn().mockRejectedValue(new Error("d1 down")) }));
    const prepare = vi.fn(() => ({ bind }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = makeEnv(prepare, { FUNNEL_MEASUREMENT_ENABLED: "1" });

    await expect(
      recordJoinConfirmSample(env, request(), { latencyMs: 100, kind: "domain" }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe("getJoinPipelineMetrics", () => {
  function envWithRows(confirmRows: Row[], briefRows: Row[]) {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        all: vi.fn().mockResolvedValue({
          results: sql.includes("status_probe_samples") ? confirmRows : briefRows,
        }),
      })),
    }));
    return { env: makeEnv(prepare), prepare };
  }

  it("returns null without a DB binding", async () => {
    await expect(getJoinPipelineMetrics({} as never)).resolves.toBeNull();
  });

  it("buckets confirm samples into the 24h and 7d windows with p50/p95", async () => {
    const hour = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
    const { env } = envWithRows(
      [
        // 24h window: latencies 5s, 10s, 20s → p50 10s, p95 20s.
        { latency_ms: 10_000, checked_at: hour(1) },
        { latency_ms: 5_000, checked_at: hour(2) },
        { latency_ms: 20_000, checked_at: hour(3) },
        // 7d only: a 60s sample.
        { latency_ms: 60_000, checked_at: hour(48) },
        // Outside the 7d window entirely (paranoia — the SQL already filters).
        { latency_ms: 999_999, checked_at: hour(24 * 9) },
        // A confirm with no latency counts as an event but no percentile value.
        { latency_ms: null, checked_at: hour(1) },
      ],
      [],
    );

    const metrics = await getJoinPipelineMetrics(env, { now: NOW });
    expect(metrics).not.toBeNull();
    expect(metrics!.firstConfirm.last24h).toEqual({
      samples: 3,
      p50Ms: 10_000,
      p95Ms: 20_000,
    });
    expect(metrics!.firstConfirm.last7d).toEqual({
      samples: 4,
      p50Ms: 20_000,
      p95Ms: 60_000,
    });
    expect(metrics!.firstConfirm.latestAt).toBe(hour(1));
    expect(metrics!.firstBrief.last7d.samples).toBe(0);
    expect(metrics!.firstBrief.last7d.p50Ms).toBeNull();
  });

  it("derives time-to-first-brief from user.createdAt → digest_run.created_at", async () => {
    const hour = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
    const { env, prepare } = envWithRows(
      [],
      [
        // Filed 30 min after signup, brief filed 1 h ago → 24h window.
        { brief_at: hour(1), signup_at: hour(1.5) },
        // Filed 4 h after signup, 50 h ago → 7d only.
        { brief_at: hour(50), signup_at: hour(54) },
        // Malformed: brief before the signup — skipped, never negative.
        { brief_at: hour(60), signup_at: hour(10) },
      ],
    );

    const metrics = await getJoinPipelineMetrics(env, { now: NOW });
    const briefSql = (prepare.mock.calls as unknown as [string][]).find(([sql]) =>
      sql.includes("FROM digest_run"),
    )![0];
    expect(briefSql).toContain("json_extract(dr.summary_json, '$.kind')");
    expect(briefSql).toContain("u.createdAt AS signup_at");

    expect(metrics!.firstBrief.last24h).toEqual({
      samples: 1,
      p50Ms: 30 * 60 * 1000,
      p95Ms: 30 * 60 * 1000,
    });
    expect(metrics!.firstBrief.last7d.samples).toBe(2);
    // Latencies: 30 min and 4 h → p50 picks the upper-middle (4 h).
    expect(metrics!.firstBrief.last7d.p50Ms).toBe(4 * 3_600_000);
    expect(metrics!.firstBrief.last7d.p95Ms).toBe(4 * 3_600_000);
    expect(metrics!.firstBrief.latestAt).toBe(hour(1));
  });

  it("reads an empty window honestly — samples 0, percentiles null", async () => {
    const { env } = envWithRows([], []);
    const metrics = await getJoinPipelineMetrics(env, { now: NOW });
    expect(metrics!.firstConfirm.last24h).toEqual({ samples: 0, p50Ms: null, p95Ms: null });
    expect(metrics!.firstConfirm.last7d).toEqual({ samples: 0, p50Ms: null, p95Ms: null });
    expect(metrics!.firstConfirm.latestAt).toBeNull();
  });
});

describe("formatJoinLatencyMs", () => {
  it("steps through s → min → h → d without false precision", () => {
    expect(formatJoinLatencyMs(9_400)).toBe("9 s");
    expect(formatJoinLatencyMs(59_900)).toBe("60 s");
    expect(formatJoinLatencyMs(60_000)).toBe("1 min");
    expect(formatJoinLatencyMs(4 * 60_000 + 20_000)).toBe("4 min");
    expect(formatJoinLatencyMs(3_600_000)).toBe("1 h");
    expect(formatJoinLatencyMs(90_000_000)).toBe("1 d");
  });
});
