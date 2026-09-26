import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "../fixtures/cf-graphql-usage.json";
import { runCostGuard } from "../../app/lib/observability/run-cost-guard.server";

/**
 * cost_alert writer + runCostGuard (0509#4432).
 *
 * The guard reads one day's Cloudflare usage (fetch stubbed: the GraphQL
 * response body is supplied per test), counts ON entities and writes one
 * cost_alert row per line over threshold, UNIQUE (day, line) making a repeat
 * run idempotent. Real local D1 with every migration applied.
 */

const usageBody = (rowsWritten: number, requests: number, totalSessionDurationMs: number) => ({
  data: {
    viewer: {
      accounts: [
        {
          d1: [{ sum: { rowsWritten } }],
          r2: [{ sum: { requests } }],
          browser: [{ sum: { totalSessionDurationMs } }],
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

describe("runCostGuard (0509#4432)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM cost_alert");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("trips on the line over threshold and writes one cost_alert row", async () => {
    stubUsage(usageBody(5000, 0, 0));
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

  it("is idempotent: a second identical call writes no new row", async () => {
    stubUsage(usageBody(5000, 0, 0));
    const first = await runCostGuard(env.DB, "t", "2026-09-22");
    expect(first.alertIds).toHaveLength(1);
    const again = await runCostGuard(env.DB, "t", "2026-09-22");
    expect(again.alertIds).toEqual([]);
    expect(await countAlerts("2026-09-22")).toBe(1);
  });

  it("writes nothing on a quiet day", async () => {
    stubUsage(usageBody(0, 0, 0));
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
      browserMs: 157107,
    });
  });
});
