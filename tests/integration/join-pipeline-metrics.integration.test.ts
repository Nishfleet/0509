import { describe, expect, it } from "vitest";

import { env } from "cloudflare:workers";

import type { AppEnv } from "~/lib/env.server";
import {
  getJoinPipelineMetrics,
  JOIN_FIRST_CONFIRM_PROBE,
  recordJoinConfirmSample,
} from "~/lib/join-pipeline-metrics.server";

import { seedUser, uid } from "./fixtures";

/**
 * Issue #3177 — the /status join-path metrics against real workerd D1:
 * the confirm sample lands in `status_probe_samples` (migration 0097, no
 * new table) and both windows read back through the real schema, the
 * `first_brief` json_extract on digest_run.summary_json, and the
 * user.createdAt join.
 *
 * Local storage is file-scoped, so every assertion runs inside one `it`
 * over the full row set seeded in this file.
 */

const NOW = new Date("2026-09-14T12:00:00.000Z");
const hour = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

async function insertConfirmSample(latencyMs: number | null, checkedAt: string) {
  await env.DB.prepare(
    "INSERT INTO status_probe_samples (probe, ok, latency_ms, detail, checked_at) VALUES (?, 1, ?, ?, ?)",
  )
    .bind(JOIN_FIRST_CONFIRM_PROBE, latencyMs, "kind=domain", checkedAt)
    .run();
}

async function seedFirstBrief(userId: string, briefAt: string) {
  await env.DB.prepare(
    `INSERT INTO digest_run (id, user_id, period_start, period_end, summary_json, created_at)
     VALUES (?, ?, '2026-01-01', '2026-01-08', ?, ?)`,
  )
    .bind(
      uid("jpdigest"),
      userId,
      JSON.stringify({ kind: "first_brief", totalEvents: 1 }),
      briefAt,
    )
    .run();
}

async function seedUserAt(createdAt: string) {
  const id = uid("jpuser");
  await env.DB.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, `Fixture ${id}`, `${id}@example.test`, createdAt, createdAt)
    .run();
  return id;
}

describe("join pipeline metrics on real D1 (issue #3177)", () => {
  it("records the confirm sample and reads both metrics back through the real schema", async () => {
    // Write path: the same call the /join confirm leg makes, gated the same
    // way (FUNNEL_MEASUREMENT_ENABLED on, no GPC).
    const writeEnv = { DB: env.DB, FUNNEL_MEASUREMENT_ENABLED: "1" } as AppEnv;
    await recordJoinConfirmSample(writeEnv, new Request("https://0509.io/join", { method: "POST" }), {
      latencyMs: 7_500,
      kind: "domain",
    });
    const written = await env.DB.prepare(
      "SELECT probe, ok, latency_ms, detail FROM status_probe_samples WHERE probe = ? AND detail = 'kind=domain'",
    )
      .bind(JOIN_FIRST_CONFIRM_PROBE)
      .first<{ probe: string; ok: number; latency_ms: number | null; detail: string }>();
    expect(written).toMatchObject({ probe: JOIN_FIRST_CONFIRM_PROBE, ok: 1, latency_ms: 7_500 });

    // GPC opt-out writes nothing — the flag honours the visitor's posture on
    // the real table, not just in the mocked suite.
    await recordJoinConfirmSample(
      writeEnv,
      new Request("https://0509.io/join", { method: "POST", headers: { "sec-gpc": "1" } }),
      { latencyMs: 1_000, kind: "domain" },
    );
    const gpcCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM status_probe_samples WHERE probe = ? AND latency_ms = 1000",
    )
      .bind(JOIN_FIRST_CONFIRM_PROBE)
      .first<{ n: number }>();
    expect(gpcCount?.n).toBe(0);

    // Confirm samples: 24h window 5s/10s/20s (+ the 7.5s write above),
    // 7d adds a 60s sample; an out-of-window row and a null latency must not
    // leak into the percentiles.
    await insertConfirmSample(5_000, hour(1));
    await insertConfirmSample(10_000, hour(2));
    await insertConfirmSample(20_000, hour(3));
    await insertConfirmSample(60_000, hour(48));
    await insertConfirmSample(999_999, hour(24 * 9));
    await insertConfirmSample(null, hour(1));

    // First briefs: signup → brief-filed latencies of 30 min (24h) and 4 h
    // (7d). A non-first_brief digest and a brief outside the window are
    // fixtures proving the json_extract and the bound.
    const userA = await seedUserAt(hour(1.5));
    await seedFirstBrief(userA, hour(1));
    const userB = await seedUserAt(hour(54));
    await seedFirstBrief(userB, hour(50));
    const userC = await seedUserAt(hour(300));
    await env.DB.prepare(
      `INSERT INTO digest_run (id, user_id, period_start, period_end, summary_json, created_at)
       VALUES (?, ?, '2026-01-01', '2026-01-08', ?, ?)`,
    )
      .bind(uid("jpplain"), userC, JSON.stringify({ kind: "weekly" }), hour(1))
      .run();
    const userD = await seedUserAt(hour(400));
    await seedFirstBrief(userD, hour(24 * 9));

    const metrics = await getJoinPipelineMetrics({ DB: env.DB } as AppEnv, { now: NOW });
    expect(metrics).not.toBeNull();

    // Confirm latencies inside 24h: 5000, 7500, 10000, 20000 → sorted,
    // p50 picks index floor(0.5*4)=2 → 10000; p95 → index 3 → 20000.
    expect(metrics!.firstConfirm.last24h).toEqual({
      samples: 4,
      p50Ms: 10_000,
      p95Ms: 20_000,
    });
    // 7d adds the 60s sample → 5 samples → p50 index 2 → 10000, p95 index 4 → 60000.
    expect(metrics!.firstConfirm.last7d).toEqual({
      samples: 5,
      p50Ms: 10_000,
      p95Ms: 60_000,
    });
    expect(metrics!.firstConfirm.latestAt).not.toBeNull();

    // First-brief latencies: 30 min (24h + 7d), 4 h (7d only).
    expect(metrics!.firstBrief.last24h).toEqual({
      samples: 1,
      p50Ms: 30 * 60 * 1000,
      p95Ms: 30 * 60 * 1000,
    });
    expect(metrics!.firstBrief.last7d).toEqual({
      samples: 2,
      p50Ms: 4 * 3_600_000,
      p95Ms: 4 * 3_600_000,
    });
  });
});
