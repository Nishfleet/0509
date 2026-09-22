import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  COST_REGRESSION_MULTIPLE,
  DOCUMENTED_PER_BRAND_PER_DAY,
  checkCostRegression,
} from "../../app/lib/observability/cost-guard";

import type { CostAlert } from "../../app/lib/observability/cost-guard";

const REAL_GRAPHQL: unknown = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cost-guard.graphql.json"), "utf8"),
);

const DAY = "2026-09-21";

function store() {
  const rows: CostAlert[] = [];
  return {
    rows,
    writeAlert(row: CostAlert) {
      rows.push(row);
      return { id: row.id };
    },
  };
}

function envelope(account: Record<string, unknown>) {
  return { data: { viewer: { accounts: [account] } }, errors: null };
}

function quietAccount(rowsWritten: number) {
  return envelope({
    d1: [{ dimensions: { date: DAY }, sum: { rowsWritten } }],
    r2: [{ dimensions: { actionType: "PutObject" }, sum: { requests: 10 } }],
    browser: [{ dimensions: { date: DAY }, sum: { totalSessionDurationMs: 15_000 } }],
  });
}

describe("checkCostRegression", () => {
  it("locks the documented per-brand-per-day figures", () => {
    expect(DOCUMENTED_PER_BRAND_PER_DAY).toEqual({
      d1_rows_written: 10,
      r2_class_a: 10,
      browser_rendering_seconds: 15,
    });
    expect(COST_REGRESSION_MULTIPLE).toBe(3);
  });

  it("reads the committed GraphQL response for 2026-09-21 and names each line over 3x", async () => {
    const alerts = store();
    const result = await checkCostRegression({
      graphql: REAL_GRAPHQL,
      day: DAY,
      onBrands: 1,
      writeAlert: alerts.writeAlert,
    });

    expect(result.totals).toEqual({
      d1_rows_written: 17_510,
      r2_class_a: 1_702,
      browser_rendering_seconds: 4943.228,
    });
    expect(result.perBrand).toEqual(result.totals);
    expect(result.alerts.map((row) => row.id)).toEqual([
      "cost-guard:2026-09-21:d1_rows_written",
      "cost-guard:2026-09-21:r2_class_a",
      "cost-guard:2026-09-21:browser_rendering_seconds",
    ]);
    expect(alerts.rows).toEqual(result.alerts);
    const d1 = result.alerts[0];
    expect(d1).toMatchObject({
      line: "d1_rows_written",
      measured: 17_510,
      expected: 10,
      day: DAY,
      total: 17_510,
      onBrands: 1,
    });
  });

  it("keeps the account total when the ON-brand count changes", async () => {
    const result = await checkCostRegression({
      graphql: REAL_GRAPHQL,
      day: DAY,
      onBrands: 2,
      writeAlert: () => ({ id: "unused" }),
    });
    expect(result.totals.d1_rows_written).toBe(17_510);
    expect(result.perBrand.d1_rows_written).toBe(8755);
  });

  it("writes cost-guard:2026-09-21:d1_rows_written when a threshold is deliberately tripped", async () => {
    const alerts = store();
    const result = await checkCostRegression({
      graphql: quietAccount(31),
      day: DAY,
      onBrands: 1,
      writeAlert: alerts.writeAlert,
    });
    expect(result.alerts).toEqual([
      {
        id: "cost-guard:2026-09-21:d1_rows_written",
        line: "d1_rows_written",
        measured: 31,
        expected: 10,
        day: DAY,
        total: 31,
        onBrands: 1,
      },
    ]);
  });

  it("does not alert at exactly three times the documented figure", async () => {
    const alerts = store();
    const result = await checkCostRegression({
      graphql: envelope({
        d1: [{ dimensions: { date: DAY }, sum: { rowsWritten: 30 } }],
        r2: [{ dimensions: { actionType: "PutObject" }, sum: { requests: 30 } }],
        browser: [{ dimensions: { date: DAY }, sum: { totalSessionDurationMs: 45_000 } }],
      }),
      day: DAY,
      onBrands: 1,
      writeAlert: alerts.writeAlert,
    });
    expect(result.alerts).toEqual([]);
    expect(alerts.rows).toEqual([]);
  });

  it("counts ListObjects as Class A and DeleteObject as free", async () => {
    const result = await checkCostRegression({
      graphql: envelope({
        d1: [{ dimensions: { date: DAY }, sum: { rowsWritten: 0 } }],
        r2: [
          { dimensions: { actionType: "ListObjects" }, sum: { requests: 4 } },
          { dimensions: { actionType: "DeleteObject" }, sum: { requests: 100 } },
          { dimensions: { actionType: "GetObject" }, sum: { requests: 9 } },
        ],
        browser: [{ dimensions: { date: DAY }, sum: { totalSessionDurationMs: 0 } }],
      }),
      day: DAY,
      onBrands: 1,
      writeAlert: () => ({ id: "unused" }),
    });
    expect(result.totals.r2_class_a).toBe(4);
    expect(result.alerts).toEqual([]);
  });

  it("refuses an unrecognized R2 action instead of dropping it", async () => {
    await expect(
      checkCostRegression({
        graphql: envelope({
          d1: [{ dimensions: { date: DAY }, sum: { rowsWritten: 0 } }],
          r2: [{ dimensions: { actionType: "NotARealAction" }, sum: { requests: 1 } }],
          browser: [{ dimensions: { date: DAY }, sum: { totalSessionDurationMs: 0 } }],
        }),
        day: DAY,
        onBrands: 1,
        writeAlert: () => ({ id: "unused" }),
      }),
    ).rejects.toThrow("cost-guard: unrecognized R2 actionType NotARealAction");
  });

  it("refuses a full R2 page", async () => {
    const r2 = Array.from({ length: 100 }, () => ({
      dimensions: { actionType: "PutObject" },
      sum: { requests: 1 },
    }));
    await expect(
      checkCostRegression({
        graphql: envelope({
          d1: [],
          r2,
          browser: [],
        }),
        day: DAY,
        onBrands: 1,
        writeAlert: () => ({ id: "unused" }),
      }),
    ).rejects.toThrow("cost-guard: r2 returned 100 groups, a full page");
  });

  it("sums every D1 group for the day", async () => {
    const result = await checkCostRegression({
      graphql: envelope({
        d1: [
          { dimensions: { date: DAY }, sum: { rowsWritten: 4 } },
          { dimensions: { date: DAY }, sum: { rowsWritten: 6 } },
        ],
        r2: [],
        browser: [],
      }),
      day: DAY,
      onBrands: 1,
      writeAlert: () => ({ id: "unused" }),
    });
    expect(result.totals.d1_rows_written).toBe(10);
    expect(result.alerts).toEqual([]);
  });

  it("rejects a non-positive ON brand count", async () => {
    await expect(
      checkCostRegression({
        graphql: quietAccount(0),
        day: DAY,
        onBrands: 0,
        writeAlert: () => ({ id: "unused" }),
      }),
    ).rejects.toThrow("cost-guard: ON brand count must be a positive integer");
  });

  it("requests the previous UTC day from GraphQL", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(quietAccount(0)), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await checkCostRegression({
      accountId: "0123456789abcdef0123456789abcdef",
      apiToken: "test-token",
      fetchImpl,
      onBrands: 1,
      now: new Date("2026-09-22T01:00:00Z"),
      writeAlert: () => ({ id: "unused" }),
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ authorization: "Bearer test-token" });
    const body = JSON.parse(String(init?.body)) as { query: string };
    expect(body.query).toContain('date_geq: "2026-09-21"');
    expect(body.query).toContain('date_leq: "2026-09-21"');
    expect(body.query).toContain("d1AnalyticsAdaptiveGroups");
    expect(body.query).toContain("r2OperationsAdaptiveGroups");
    expect(body.query).toContain("browserRenderingBrowserTimeUsageAdaptiveGroups");
  });

  it("accepts the production account tag", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(quietAccount(0)), { status: 200 })),
    );
    await checkCostRegression({
      accountId: "f670a698e17bf160c8e4679823e68916",
      apiToken: "test-token",
      fetchImpl,
      onBrands: 1,
      day: DAY,
      writeAlert: () => ({ id: "unused" }),
    });
    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as { query: string };
    expect(body.query).toContain('accountTag: "f670a698e17bf160c8e4679823e68916"');
  });

  it("reads 2026-10-31 when now is 2026-11-01T00:30:00Z", async () => {
    const october = envelope({
      d1: [{ dimensions: { date: "2026-10-31" }, sum: { rowsWritten: 0 } }],
      r2: [],
      browser: [],
    });
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(october), { status: 200 })),
    );
    const result = await checkCostRegression({
      accountId: "0123456789abcdef0123456789abcdef",
      apiToken: "test-token",
      fetchImpl,
      onBrands: 1,
      now: new Date("2026-11-01T00:30:00Z"),
      writeAlert: () => ({ id: "unused" }),
    });
    expect(result.day).toBe("2026-10-31");
    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as { query: string };
    expect(body.query).toContain('date_geq: "2026-10-31"');
  });

  it("refuses a GraphQL errors array", async () => {
    await expect(
      checkCostRegression({
        graphql: { ...quietAccount(0), errors: [{ message: "budget" }] },
        day: DAY,
        onBrands: 1,
        writeAlert: () => ({ id: "unused" }),
      }),
    ).rejects.toThrow("cost-guard: graphql returned errors");
  });

  it("refuses a full D1 page and a full browser page", async () => {
    const d1 = Array.from({ length: 10 }, () => ({
      dimensions: { date: DAY },
      sum: { rowsWritten: 1 },
    }));
    await expect(
      checkCostRegression({
        graphql: envelope({ d1, r2: [], browser: [] }),
        day: DAY,
        onBrands: 1,
        writeAlert: () => ({ id: "unused" }),
      }),
    ).rejects.toThrow("cost-guard: d1 returned 10 groups, a full page");

    const browser = Array.from({ length: 10 }, () => ({
      dimensions: { date: DAY },
      sum: { totalSessionDurationMs: 1 },
    }));
    await expect(
      checkCostRegression({
        graphql: envelope({ d1: [], r2: [], browser }),
        day: DAY,
        onBrands: 1,
        writeAlert: () => ({ id: "unused" }),
      }),
    ).rejects.toThrow("cost-guard: browser returned 10 groups, a full page");
  });
});
