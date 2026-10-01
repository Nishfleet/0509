import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "../fixtures/cf-graphql-usage.json";
import { runCostGuard, runNightlyCostGuard } from "../../app/lib/observability/run-cost-guard.server";

/**
 * cost_alert writer + runCostGuard (0509#4432).
 *
 * The guard reads one day's Cloudflare usage (fetch stubbed: the GraphQL
 * response body is supplied per test), counts ON entities and writes one
 * cost_alert row per line over threshold, UNIQUE (day, line) making a repeat
 * run idempotent. Real local D1 with every migration applied.
 */

const usageBody = (rowsWritten: number, requests: number) => ({
  data: {
    viewer: {
      accounts: [
        {
          d1: [{ sum: { rowsWritten } }],
          r2: [{ sum: { requests } }],
        },
      ],
    },
  },
  errors: null,
});

const stubUsage = (body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );

const countAlerts = async (day: string) => {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM cost_alert WHERE day = ?")
    .bind(day)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

const NOW = "2026-09-22T12:00:00.000Z";

/** `entity.workspace_id` has a FK to `workspace`, which has a FK to `user`. */
async function seedWorkspace(userId: string, email: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(userId, userId, email, NOW, NOW)
    .run();
  await env.DB.prepare(
    "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?, ?, ?, 'UTC', ?)",
  )
    .bind(`ws_${userId}`, userId, userId, NOW)
    .run();
}

async function seedEntity(
  id: string,
  userId: string,
  role: "self" | "competitor",
  domain: string,
  state: "on" | "off" | "dismissed",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO entity (id, workspace_id, role, domain, state, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, `ws_${userId}`, role, domain, state, NOW)
    .run();
}

/**
 * Two workspaces, so the divisor has self rows in it that must NOT count
 * (0509#6086): `entity` CHECKs `role = 'competitor' OR state = 'on'`, so
 * every `self` row is always ON. Counting `state = 'on'` alone made
 * `workspaces_self` dilute the per-brand divisor.
 *
 * ws_user-brand-count: 2 ON competitors, 1 off, 1 dismissed, 1 self
 * ws_user-brand-other:  1 ON competitor, 1 self
 * → onBrands must be 3, not 5.
 */
async function seedBrands(): Promise<void> {
  await seedWorkspace("user-brand-count", "brand-count@example.com");
  await seedEntity("e-self-1", "user-brand-count", "self", "mine.example", "on");
  await seedEntity("e-comp-on-1", "user-brand-count", "competitor", "rival1.example", "on");
  await seedEntity("e-comp-on-2", "user-brand-count", "competitor", "rival2.example", "on");
  await seedEntity("e-comp-off", "user-brand-count", "competitor", "rival3.example", "off");
  await seedEntity("e-comp-dismissed", "user-brand-count", "competitor", "rival4.example", "dismissed");

  await seedWorkspace("user-brand-other", "brand-other@example.com");
  await seedEntity("e-self-2", "user-brand-other", "self", "other-mine.example", "on");
  await seedEntity("e-comp-on-3", "user-brand-other", "competitor", "rival5.example", "on");
}

async function clearBrands(): Promise<void> {
  await env.DB.exec(`DELETE FROM entity WHERE id LIKE 'e-self-%' OR id LIKE 'e-comp-%'`);
  await env.DB.exec(`DELETE FROM workspace WHERE id LIKE 'ws_user-brand-%'`);
  await env.DB.exec(`DELETE FROM "user" WHERE id LIKE 'user-brand-%'`);
}

const readAlert = async (id: string) =>
  env.DB.prepare("SELECT * FROM cost_alert WHERE id = ?").bind(id).first<{
    day: string;
    line: string;
    measured_per_brand: number;
    expected_per_brand: number;
    on_brands: number;
  }>();

describe("runCostGuard (0509#4432)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cost_alert");
    await clearBrands();
  });

  afterEach(async () => {
    await clearBrands();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("trips on the line over threshold and writes one cost_alert row", async () => {
    stubUsage(usageBody(5000, 0));
    const result = await runCostGuard(env.DB, "t", "2026-09-22");
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0]?.line).toBe("d1_rows_written");
    expect(result.alertIds).toHaveLength(1);
    const id = result.alertIds[0];
    console.log("cost_alert id", id);
    const row = await env.DB.prepare("SELECT * FROM cost_alert WHERE id = ?").bind(id).first<{
      day: string;
      line: string;
      measured_per_brand: number;
      expected_per_brand: number;
      on_brands: number;
    }>();
    expect(row).toMatchObject({
      day: "2026-09-22",
      line: "d1_rows_written",
      measured_per_brand: 5000,
      expected_per_brand: 10,
      on_brands: 0,
    });
  });

  it("divides by ON competitors only: self rows are always ON and must not dilute the divisor", async () => {
    await seedBrands();
    // 91 rows over 3 ON competitors is 30.33/brand, over the factor of three
    // times the documented 10. Over 5 (2 self + 3 competitors) it would be
    // 18.2/brand, which is inside the factor and would have alerted nobody.
    stubUsage(usageBody(91, 0));
    const result = await runCostGuard(env.DB, "t", "2026-09-24");
    expect(result.onBrands).toBe(3);
    expect(result.breaches).toEqual([
      {
        day: "2026-09-24",
        line: "d1_rows_written",
        measuredPerBrand: 91 / 3,
        expectedPerBrand: 10,
        onBrands: 3,
      },
    ]);
    const id = result.alertIds[0];
    expect(id).toBeDefined();
    expect(await readAlert(id as string)).toMatchObject({
      day: "2026-09-24",
      line: "d1_rows_written",
      measured_per_brand: 91 / 3,
      expected_per_brand: 10,
      on_brands: 3,
    });
  });

  it("counts an ON competitor but not a retired one", async () => {
    await seedBrands();
    await env.DB.prepare("UPDATE entity SET state = 'off' WHERE id = 'e-comp-on-2'").run();
    stubUsage(usageBody(0, 0));
    const result = await runCostGuard(env.DB, "t", "2026-09-25");
    expect(result.onBrands).toBe(2);
  });

  it("alerts on browser_ms_0509 from the Worker's own day counter, not the account-wide dataset", async () => {
    await seedBrands();
    const counter = env.BROWSER_BUDGET.get(env.BROWSER_BUDGET.idFromName("browser-ms:2026-09-26"));
    await counter.addMs(100_000, "chromium");
    await counter.addMs(50_000, "chromium");
    stubUsage(usageBody(0, 0));
    const result = await runCostGuard(env.DB, "t", "2026-09-26");
    expect(result.usage.browserMs).toBe(150_000);
    expect(result.breaches).toEqual([
      {
        day: "2026-09-26",
        line: "browser_ms_0509",
        measuredPerBrand: 50_000,
        expectedPerBrand: 15_000,
        onBrands: 3,
      },
    ]);
    const id = result.alertIds[0];
    expect(id).toBeDefined();
    expect(await readAlert(id as string)).toMatchObject({
      day: "2026-09-26",
      line: "browser_ms_0509",
      measured_per_brand: 50_000,
      expected_per_brand: 15_000,
      on_brands: 3,
    });
  });

  it("stays silent on browser_ms_0509 at or under three times the per-brand figure", async () => {
    await seedBrands();
    await env.BROWSER_BUDGET.get(env.BROWSER_BUDGET.idFromName("browser-ms:2026-09-27")).addMs(135_000, "chromium");
    stubUsage(usageBody(0, 0));
    const result = await runCostGuard(env.DB, "t", "2026-09-27");
    expect(result.usage.browserMs).toBe(135_000);
    expect(result.breaches).toEqual([]);
    expect(await countAlerts("2026-09-27")).toBe(0);
  });

  it("is idempotent: a second identical call writes no new row", async () => {
    stubUsage(usageBody(5000, 0));
    const first = await runCostGuard(env.DB, "t", "2026-09-22");
    expect(first.alertIds).toHaveLength(1);
    const again = await runCostGuard(env.DB, "t", "2026-09-22");
    expect(again.alertIds).toEqual([]);
    expect(await countAlerts("2026-09-22")).toBe(1);
  });

  it("writes nothing on a quiet day", async () => {
    stubUsage(usageBody(0, 0));
    const result = await runCostGuard(env.DB, "t", "2026-09-23");
    expect(result.breaches).toEqual([]);
    expect(result.alertIds).toEqual([]);
    expect(await countAlerts("2026-09-23")).toBe(0);
  });

  it("parses the committed GraphQL fixture without throwing", async () => {
    stubUsage(fixture);
    const result = await runCostGuard(env.DB, "t", "2026-09-22");
    expect(result.usage).toEqual({
      day: "2026-09-22",
      d1RowsWritten: 4677,
      r2ClassAOps: 13,
      browserMs: 0,
    });
  });
});

describe("runNightlyCostGuard", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cost_alert");
    await clearBrands();
  });

  afterEach(async () => {
    await clearBrands();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const at = Date.UTC(2026, 8, 29, 3, 0, 0);

  it("guards the previous UTC day from the scheduled instant", async () => {
    await seedBrands();
    await env.BROWSER_BUDGET.get(env.BROWSER_BUDGET.idFromName("browser-ms:2026-09-28")).addMs(150_000, "chromium");
    stubUsage(usageBody(0, 0));
    const result = await runNightlyCostGuard(env.DB, "t", at);
    expect(result.usage.day).toBe("2026-09-28");
    expect(result.breaches.map((breach) => breach.line)).toEqual(["browser_ms_0509"]);
    expect(await countAlerts("2026-09-28")).toBe(1);
  });

  it("without a token evaluates the browser line only and never calls the analytics API", async () => {
    await seedBrands();
    await env.BROWSER_BUDGET.get(env.BROWSER_BUDGET.idFromName("browser-ms:2026-09-28")).addMs(150_000, "chromium");
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await runNightlyCostGuard(env.DB, undefined, at);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.breaches.map((breach) => breach.line)).toEqual(["browser_ms_0509"]);
    expect(result.alertIds).toHaveLength(1);
  });

  it("treats an empty token as absent", async () => {
    await seedBrands();
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    await runNightlyCostGuard(env.DB, "", at);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("without a token ignores a D1 figure that would breach with one", async () => {
    await seedBrands();
    stubUsage(usageBody(5000, 0));
    const result = await runNightlyCostGuard(env.DB, undefined, Date.UTC(2026, 8, 30, 3, 0, 0));
    expect(result.breaches).toEqual([]);
  });

  it("stays silent when the browser line is under threshold", async () => {
    await seedBrands();
    await env.BROWSER_BUDGET.get(env.BROWSER_BUDGET.idFromName("browser-ms:2026-10-01")).addMs(135_000, "chromium");
    const result = await runNightlyCostGuard(env.DB, undefined, Date.UTC(2026, 9, 2, 3, 0, 0));
    expect(result.breaches).toEqual([]);
    expect(await countAlerts("2026-10-01")).toBe(0);
  });
});
