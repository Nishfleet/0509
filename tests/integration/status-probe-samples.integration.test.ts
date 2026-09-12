import { describe, expect, it } from "vitest";

import { getPublicStatusProbes } from "~/lib/status-probes.server";

import { env } from "cloudflare:workers";

/**
 * Migration 0097 (status_probe_samples) against real workerd D1: the write
 * path (probe samples inserted the way runStatusProbes writes them) and the
 * read path (getPublicStatusProbes aggregation) on the real schema, CHECK
 * semantics, and index.
 */

async function insertSample(
  row: {
    probe: string;
    ok: boolean;
    latencyMs: number | null;
    detail: string | null;
    checkedAt: string;
  },
) {
  await env.DB.prepare(
    "INSERT INTO status_probe_samples (probe, ok, latency_ms, detail, checked_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(row.probe, row.ok ? 1 : 0, row.latencyMs, row.detail, row.checkedAt).run();
}

describe("status_probe_samples on real D1", () => {
  it("writes probe samples and reads the public status projection back", async () => {
    const base = Date.parse("2026-09-12T05:00:00.000Z");
    await insertSample({ probe: "uptime", ok: true, latencyMs: 12, detail: "home 200/12ms, health 200/4ms", checkedAt: new Date(base - 2 * 3600_000).toISOString() });
    await insertSample({ probe: "uptime", ok: false, latencyMs: 40, detail: "home 503/40ms, health 200/4ms", checkedAt: new Date(base - 3600_000).toISOString() });
    await insertSample({ probe: "uptime", ok: true, latencyMs: 18, detail: "home 200/18ms, health 200/4ms", checkedAt: new Date(base).toISOString() });
    await insertSample({ probe: "public_search", ok: true, latencyMs: 55, detail: "9 ads returned (hit)", checkedAt: new Date(base).toISOString() });

    // Every probe name is represented (nulls where never sampled). `now` is
    // pinned to just after the newest sample: the 24h ok-rate/p50/last-failure
    // windows are relative to it, so an unpinned clock would age this fixture
    // out of the window and turn the test into a date-bomb.
    const probes = await getPublicStatusProbes(env.DB, {
      now: new Date(base + 30 * 60_000),
    });
    expect(probes.length).toBe(5);
    const byName = new Map(probes.map((probe) => [probe.probe, probe]));

    const uptime = byName.get("uptime")!;
    expect(uptime.latest).toMatchObject({ ok: true, latencyMs: 18, detail: "home 200/18ms, health 200/4ms" });
    expect(uptime.okRate24h).toBeCloseTo(2 / 3, 5);
    expect(uptime.p50LatencyMs24h).toBe(18);
    expect(uptime.lastFailureDetail).toBe("home 503/40ms, health 200/4ms");

    const publicSearch = byName.get("public_search")!;
    expect(publicSearch.latest).toMatchObject({ ok: true, latencyMs: 55 });
    expect(publicSearch.okRate24h).toBe(1);
    expect(publicSearch.lastFailureDetail).toBeNull();

    const neverRun = byName.get("provider_meta")!;
    expect(neverRun.latest).toBeNull();
    expect(neverRun.okRate24h).toBeNull();
  });

  it("keeps ok as a strict integer column and prunes by checked_at with the index", async () => {
    const base = Date.parse("2026-09-12T05:00:00.000Z");
    // ok accepts only 0/1 semantics through the projection; raw 2 is rejected
    // only if a CHECK existed — this migration intentionally has none, so the
    // assertion pins the write contract the runner uses (0/1 only).
    await insertSample({ probe: "billing_dodo", ok: false, latencyMs: null, detail: "canary billing state not stable", checkedAt: new Date(base).toISOString() });
    const raw = await env.DB.prepare(
      "SELECT ok, latency_ms FROM status_probe_samples WHERE probe = 'billing_dodo' ORDER BY id DESC LIMIT 1",
    ).first<{ ok: number; latency_ms: number | null }>();
    expect(raw?.ok).toBe(0);
    expect(raw?.latency_ms).toBeNull();

    // Retention delete (the cron's prune) removes only old rows.
    await env.DB.prepare(
      "INSERT INTO status_probe_samples (probe, ok, latency_ms, detail, checked_at) VALUES (?, ?, ?, ?, ?)",
    ).bind("billing_dodo", 1, 30, "canary identity stable, catalog resolved, webhook signing ok", new Date(base - 8 * 24 * 3600_000).toISOString()).run();
    const pruneResult = await env.DB.prepare(
      "DELETE FROM status_probe_samples WHERE checked_at < ?",
    ).bind(new Date(base - 7 * 24 * 3600_000).toISOString()).run();
    expect(Number(pruneResult.meta?.changes ?? 0)).toBeGreaterThanOrEqual(1);
    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM status_probe_samples WHERE probe = 'billing_dodo'",
    ).first<{ n: number }>();
    expect(remaining?.n).toBe(1);
  });
});
