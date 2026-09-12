import { describe, expect, it } from "vitest";

import {
  STATUS_PROBE_NAMES,
  getPublicStatusProbes,
  probeDueThisTick,
  pruneStatusProbeSamples,
  runStatusProbes,
  type PublicStatusProbe,
} from "~/lib/status-probes.server";
import type { AppEnv } from "~/lib/env.server";

import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

function probeDb() {
  const handle = createSqliteD1();
  applyMigration(handle.sqlite, "migrations/0097_status_probe_samples.sql");
  // node:sqlite-backed stand-in: behaves like D1 at runtime but its structural
  // type is a narrow subset of D1Database, so assert it at this single seam.
  return { ...handle, db: handle.db as unknown as AppEnv["DB"] };
}

function insertSample(
  db: AppEnv["DB"],
  row: {
    probe: string;
    ok: boolean;
    latencyMs?: number | null;
    detail?: string | null;
    checkedAt: string;
  },
) {
  return db!.prepare(
    "INSERT INTO status_probe_samples (probe, ok, latency_ms, detail, checked_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(row.probe, row.ok ? 1 : 0, row.latencyMs ?? null, row.detail ?? null, row.checkedAt).run();
}

describe("status probe sample schema (migration 0097)", () => {
  it("creates the sample table with the packet's columns and the (probe, checked_at) index", async () => {
    const { sqlite, db } = probeDb();
    const columns = sqlite.prepare(
      "SELECT name FROM pragma_table_info('status_probe_samples') ORDER BY cid",
    ).all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "probe",
      "ok",
      "latency_ms",
      "detail",
      "checked_at",
    ]);
    const indexes = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'status_probe_samples'",
    ).all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toContain("idx_status_probe_samples_probe_checked_at");
    // Write + read path on the real schema.
    insertSample(db, { probe: "uptime", ok: true, latencyMs: 42, detail: "home 200/42ms", checkedAt: "2026-09-12T05:00:00.000Z" });
    const row = await db!.prepare("SELECT probe, ok, latency_ms FROM status_probe_samples").bind().first<{
      probe: string;
      ok: number;
      latency_ms: number;
    }>();
    expect(row).toEqual({ probe: "uptime", ok: 1, latency_ms: 42 });
  });
});

describe("probe cadence", () => {
  it("runs the cheap probes every tick and budgets the expensive ones", () => {
    const at = (minute: number) => new Date(`2026-09-12T05:${String(minute).padStart(2, "0")}:00.000Z`);
    for (const minute of [0, 5, 10, 55]) {
      expect(probeDueThisTick("public_search", at(minute))).toBe(true);
      expect(probeDueThisTick("billing_dodo", at(minute))).toBe(true);
      expect(probeDueThisTick("uptime", at(minute))).toBe(true);
    }
    // signin_dispatch sends real canary mail: every 30 minutes only.
    expect(probeDueThisTick("signin_dispatch", at(0))).toBe(true);
    expect(probeDueThisTick("signin_dispatch", at(5))).toBe(false);
    expect(probeDueThisTick("signin_dispatch", at(30))).toBe(true);
    // provider_meta drives a browser capture: once per hour, off the :00 rails.
    expect(probeDueThisTick("provider_meta", at(0))).toBe(false);
    expect(probeDueThisTick("provider_meta", at(25))).toBe(true);
    expect(probeDueThisTick("provider_meta", at(30))).toBe(false);
  });
});

describe("runStatusProbes", () => {
  it("never throws and records one sample per due probe, with retention pruning", async () => {
    const { db } = probeDb();
    // A stale row from 8 days ago must be pruned by the same run.
    insertSample(db, { probe: "uptime", ok: true, checkedAt: "2026-09-04T05:00:00.000Z" });
    const env = {
      DB: db,
      // Loopback dead port: fetch fails fast with ECONNREFUSED — no external
      // network from tests, and the probe records an honest failed sample.
      APP_ORIGIN: "http://127.0.0.1:9",
    } as unknown as AppEnv;
    const results = await runStatusProbes(env, { now: new Date("2026-09-12T05:05:00.000Z") });
    const due = new Set(results.map((result) => result.probe));
    expect(due.has("public_search")).toBe(true);
    expect(due.has("billing_dodo")).toBe(true);
    expect(due.has("uptime")).toBe(true);
    expect(due.has("signin_dispatch")).toBe(false);
    expect(due.has("provider_meta")).toBe(false);
    for (const result of results) {
      expect(result.ok).toBe(false); // no email/browser bindings in this env — honest red
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.detail.length).toBeGreaterThan(0);
    }
    const rows = (await db!.prepare(
      "SELECT probe, checked_at FROM status_probe_samples ORDER BY checked_at",
    ).bind().all()).results as Array<{ probe: string; checked_at: string }>;
    // Stale 2026-09-04 row pruned; only this tick's samples remain.
    expect(rows.every((row) => row.checked_at === "2026-09-12T05:05:00.000Z")).toBe(true);
    expect(rows.length).toBe(3);
  });

  it("runs probes whose runner throws as an honest failed sample instead of throwing", async () => {
    const { db } = probeDb();
    const env = {
      DB: db,
      APP_ORIGIN: "http://127.0.0.1:9",
    } as unknown as AppEnv;
    // uptime throws when fetch fails (dead loopback port) — the
    // assertion is that runStatusProbes still resolves with a failed sample.
    const results = await runStatusProbes(env, { now: new Date("2026-09-12T05:05:00.000Z") });
    const uptime = results.find((result) => result.probe === "uptime");
    expect(uptime).toBeDefined();
    expect(uptime!.ok).toBe(false);
    const row = await db!.prepare(
      "SELECT ok, detail FROM status_probe_samples WHERE probe = 'uptime' ORDER BY id DESC LIMIT 1",
    ).bind().first<{ ok: number; detail: string }>();
    expect(row?.ok).toBe(0);
    expect(row?.detail).toBeTruthy();
  });
});

describe("pruneStatusProbeSamples", () => {
  it("keeps 7 days and clears expired Better Auth verification rows", async () => {
    const { sqlite, db } = probeDb();
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS verification (
        id TEXT PRIMARY KEY NOT NULL,
        identifier TEXT NOT NULL,
        value TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
    sqlite.prepare(
      "INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("expired", "a@b.c", "tok", "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
    sqlite.prepare(
      "INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("fresh", "a@b.c", "tok", "2026-09-20T00:00:00.000Z", "2026-09-12T00:00:00.000Z", "2026-09-12T00:00:00.000Z");
    insertSample(db, { probe: "uptime", ok: true, checkedAt: "2026-09-12T04:00:00.000Z" });
    insertSample(db, { probe: "uptime", ok: true, checkedAt: "2026-09-04T04:00:00.000Z" });
    await pruneStatusProbeSamples({ DB: db } as unknown as AppEnv, { now: new Date("2026-09-12T05:00:00.000Z") });
    const probes = sqlite.prepare("SELECT checked_at FROM status_probe_samples ORDER BY checked_at").all() as Array<{ checked_at: string }>;
    expect(probes.map((row) => row.checked_at)).toEqual(["2026-09-12T04:00:00.000Z"]);
    const verifications = sqlite.prepare("SELECT id FROM verification ORDER BY id").all() as Array<{ id: string }>;
    expect(verifications.map((row) => row.id)).toEqual(["fresh"]);
  });
});

describe("getPublicStatusProbes", () => {
  it("returns latest, 24h ok-rate, 24h p50 latency, and last failure detail per probe", async () => {
    const { db } = probeDb();
    const base = Date.parse("2026-09-12T05:00:00.000Z");
    // uptime: 3 samples in 24h, 2 ok; latencies 10, 30, 50 → p50 of ok (10,30) = 30.
    insertSample(db, { probe: "uptime", ok: true, latencyMs: 10, detail: "home 200/10ms, health 200/5ms", checkedAt: new Date(base - 3 * 3600_000).toISOString() });
    insertSample(db, { probe: "uptime", ok: false, latencyMs: 20, detail: "home 502/20ms, health 200/5ms", checkedAt: new Date(base - 2 * 3600_000).toISOString() });
    insertSample(db, { probe: "uptime", ok: true, latencyMs: 30, detail: "home 200/30ms, health 200/5ms", checkedAt: new Date(base - 1 * 3600_000).toISOString() });
    // Older than 24h — must not affect rates.
    insertSample(db, { probe: "uptime", ok: false, latencyMs: 999, detail: "old failure", checkedAt: new Date(base - 30 * 3600_000).toISOString() });
    // A probe with no rows at all.
    const probes = await getPublicStatusProbes(db!, { now: new Date(base) });
    expect(probes.map((probe) => probe.probe)).toEqual([...STATUS_PROBE_NAMES]);
    const byName = new Map<string, PublicStatusProbe>(probes.map((probe) => [probe.probe, probe]));
    const uptime = byName.get("uptime")!;
    expect(uptime.latest).toEqual({
      ok: true,
      latencyMs: 30,
      detail: "home 200/30ms, health 200/5ms",
      checkedAt: new Date(base - 1 * 3600_000).toISOString(),
    });
    expect(uptime.okRate24h).toBeCloseTo(2 / 3, 5);
    expect(uptime.p50LatencyMs24h).toBe(30);
    expect(uptime.lastFailureDetail).toBe("home 502/20ms, health 200/5ms");
    const providerMeta = byName.get("provider_meta")!;
    expect(providerMeta.latest).toBeNull();
    expect(providerMeta.okRate24h).toBeNull();
    expect(providerMeta.p50LatencyMs24h).toBeNull();
    expect(providerMeta.lastFailureDetail).toBeNull();
  });

  it("surfaces a probe that has only failures with ok-rate 0 and the failure detail", async () => {
    const { db } = probeDb();
    const base = Date.parse("2026-09-12T05:00:00.000Z");
    insertSample(db, { probe: "signin_dispatch", ok: false, latencyMs: 120, detail: "send_email binding not configured", checkedAt: new Date(base - 3600_000).toISOString() });
    const probes = await getPublicStatusProbes(db!, { now: new Date(base) });
    const signin = probes.find((probe) => probe.probe === "signin_dispatch")!;
    expect(signin.latest?.ok).toBe(false);
    expect(signin.okRate24h).toBe(0);
    expect(signin.lastFailureDetail).toBe("send_email binding not configured");
  });
});
