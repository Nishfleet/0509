import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { checkCostRegression } from "../../app/lib/observability/cost-guard.server";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const REAL_GRAPHQL: unknown = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cost-guard.graphql.json"), "utf8"),
);

const DOC = readFileSync(join(ROOT, "docs/REBUILD-COST.md"), "utf8");
const WRANGLER = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");

const DAY = "2026-09-21";

function oneNumber(text: string, pattern: RegExp, label: string): number {
  const values = [...text.matchAll(pattern)].map((match) => Number(match[1]?.replaceAll(",", "")));
  const distinct = [...new Set(values)];
  if (distinct.length !== 1 || distinct[0] === undefined || !Number.isFinite(distinct[0])) {
    throw new Error(`${label} matched ${distinct.join(", ") || "nothing"}`);
  }
  return distinct[0];
}

function documented() {
  const d1Week = oneNumber(DOC, /wrote ([\d,]+) with no ON brand/g, "d1 week floor");
  const d1PerBrand = oneNumber(DOC, /(\d+) snapshot rows per brand-day/g, "d1 per brand");
  const browserWeekMs = oneNumber(DOC, /summed to ([\d,]+) ms/g, "browser week");
  const browserPerBrand = oneNumber(
    DOC,
    /\| Browser Rendering duration \| (\d+) browser-seconds per brand per day/g,
    "browser per brand",
  );
  const modelSeconds = oneNumber(DOC, /≈(\d+) browser-seconds per brand per day/g, "browser model");
  if (modelSeconds !== browserPerBrand) throw new Error("browser model and table estimate disagree");
  const r2ClassAWeek = oneNumber(
    DOC,
    /\| R2 `0509-snapshots` \|[^|]*\| Class A: `PutBucket` (\d+)/g,
    "snapshot class A",
  );
  const dailyRows = [...DOC.matchAll(/^\| (\d{4}-\d{2}-\d{2}) \| [\d,]+ \| [\d,]+ \| [\d,]+ \| ([\d,]+) \|$/gm)].map(
    (match) => Number(match[2]?.replaceAll(",", "")),
  );
  if (dailyRows.length !== 7) throw new Error(`expected 7 ordinary days, got ${String(dailyRows.length)}`);
  const summed = dailyRows.reduce((sum, rows) => sum + rows, 0);
  if (summed !== d1Week) throw new Error(`daily rows sum to ${String(summed)}, week floor is ${String(d1Week)}`);
  const databaseIds = [...WRANGLER.matchAll(/"database_id": "([^"]+)"/g)].map((match) => match[1]);
  const buckets = [...WRANGLER.matchAll(/"bucket_name": "([^"]+)"/g)].map((match) => match[1]);
  if (databaseIds.length !== 1 || buckets.length !== 1) {
    throw new Error("wrangler must declare one D1 database and one R2 bucket");
  }
  return {
    d1Week,
    d1PerBrand,
    browserWeekMs,
    browserPerBrand,
    r2ClassAWeek,
    dailyRows,
    days: dailyRows.length,
    multiple: 3,
    databaseId: databaseIds[0] ?? "",
    bucket: buckets[0] ?? "",
  };
}

const FIGURES = documented();

const D1_QUIET_ROWS = 95_724;
const D1_TRIP_ROWS = 95_725;
const BROWSER_QUIET_MS = 26_917_830;
const BROWSER_TRIP_MS = 26_917_831;

function docLimit(weekFloor: number, perUnit: number, onBrands: number): number {
  return FIGURES.multiple * (weekFloor + perUnit * onBrands * FIGURES.days);
}

function envelope(account: Record<string, unknown>) {
  return { data: { viewer: { accounts: [account] } }, errors: null };
}

function day(rowsWritten: number, classA = 0, durationMs = 0) {
  return envelope({
    d1: [
      {
        dimensions: { date: DAY, databaseId: FIGURES.databaseId },
        sum: { rowsWritten },
      },
    ],
    r2:
      classA === 0
        ? []
        : [
            {
              dimensions: { date: DAY, actionType: "PutObject", bucketName: FIGURES.bucket },
              sum: { requests: classA },
            },
          ],
    browser: [{ dimensions: { date: DAY }, sum: { totalSessionDurationMs: durationMs } }],
  });
}

describe("checkCostRegression", () => {
  it("pins the trip line to the figures docs/REBUILD-COST.md carries", () => {
    expect(FIGURES.d1PerBrand).toBe(10);
    expect(FIGURES.d1Week).toBe(223_287);
    expect(FIGURES.browserPerBrand).toBe(15);
    expect(FIGURES.browserWeekMs).toBe(62_703_271);
    expect(FIGURES.r2ClassAWeek).toBe(1);
    expect(DOC).toContain("That dataset has no script name");
  });

  it("reads the committed GraphQL response and stays quiet on that ordinary day", async () => {
    const result = await checkCostRegression({
      graphql: REAL_GRAPHQL,
      day: DAY,
      onBrands: 1,
    });
    expect(result.totals).toEqual({
      d1_rows_written: 17_499,
      r2_class_a: 1,
      browser_rendering_seconds: 4943.228,
    });
    expect(result.alerts).toEqual([]);
    expect(17_499).toBeLessThan(D1_TRIP_ROWS);
    expect(4_943_228).toBeLessThan(BROWSER_TRIP_MS);
    expect(result.expected.d1_rows_written).toBeCloseTo(FIGURES.d1Week / FIGURES.days + 10, 6);
    expect(result.expected.browser_rendering_seconds).toBeCloseTo(
      FIGURES.browserWeekMs / FIGURES.days / 1000 + 15,
      6,
    );
  });

  it("stays quiet on every rows-written day the doc prints, at 0 and 1 ON brands", async () => {
    for (const rows of FIGURES.dailyRows) {
      for (const onBrands of [0, 1]) {
        const result = await checkCostRegression({ graphql: day(rows), day: DAY, onBrands });
        expect(result.alerts, `${String(rows)} rows, ${String(onBrands)} brands`).toEqual([]);
      }
    }
  });

  it("locks 95724 quiet and 95725 alerting to the D1 figures in the cost doc", () => {
    const limit = docLimit(FIGURES.d1Week, FIGURES.d1PerBrand, 1);
    expect(D1_QUIET_ROWS * FIGURES.days).toBeLessThanOrEqual(limit);
    expect(D1_TRIP_ROWS * FIGURES.days).toBeGreaterThan(limit);
    expect(D1_QUIET_ROWS).toBe(D1_TRIP_ROWS - 1);
  });

  it("writes cost-guard:2026-09-21:d1_rows_written at 95725 rows and stays quiet at 95724", async () => {
    const under = await checkCostRegression({ graphql: day(D1_QUIET_ROWS), day: DAY, onBrands: 1 });
    expect(under.alerts).toEqual([]);
    const result = await checkCostRegression({ graphql: day(D1_TRIP_ROWS), day: DAY, onBrands: 1 });
    expect(result.alerts).toEqual([
      {
        id: "cost-guard:2026-09-21:d1_rows_written",
        line: "d1_rows_written",
        measured: D1_TRIP_ROWS,
        expected: result.expected.d1_rows_written,
        day: DAY,
      },
    ]);
    expect(D1_TRIP_ROWS).toBeGreaterThan(3 * result.expected.d1_rows_written);
    expect(D1_QUIET_ROWS).toBeLessThanOrEqual(3 * result.expected.d1_rows_written);
  });

  it("locks the browser boundary to the duration figures in the cost doc", () => {
    const limit = docLimit(FIGURES.browserWeekMs, FIGURES.browserPerBrand * 1000, 1);
    expect(BROWSER_QUIET_MS * FIGURES.days).toBeLessThanOrEqual(limit);
    expect(BROWSER_TRIP_MS * FIGURES.days).toBeGreaterThan(limit);
    expect(BROWSER_QUIET_MS).toBe(BROWSER_TRIP_MS - 1);
  });

  it("writes cost-guard:2026-09-21:browser_rendering_seconds at 26917831 ms and stays quiet one millisecond under", async () => {
    const under = await checkCostRegression({ graphql: day(0, 0, BROWSER_QUIET_MS), day: DAY, onBrands: 1 });
    expect(under.alerts).toEqual([]);
    const result = await checkCostRegression({ graphql: day(0, 0, BROWSER_TRIP_MS), day: DAY, onBrands: 1 });
    expect(result.alerts).toEqual([
      {
        id: "cost-guard:2026-09-21:browser_rendering_seconds",
        line: "browser_rendering_seconds",
        measured: BROWSER_TRIP_MS / 1000,
        expected: result.expected.browser_rendering_seconds,
        day: DAY,
      },
    ]);
  });

  it("names the five-million-row day the $105 pattern is priced at", async () => {
    const result = await checkCostRegression({ graphql: day(5_000_000), day: DAY, onBrands: 0 });
    expect(result.alerts.map((row) => row.id)).toEqual(["cost-guard:2026-09-21:d1_rows_written"]);
    expect(result.alerts[0]?.measured).toBe(5_000_000);
  });

  it("writes cost-guard:2026-09-21:r2_class_a when Class A is more than three times the documented week", async () => {
    const quiet = await checkCostRegression({
      graphql: day(0, FIGURES.r2ClassAWeek * 3, 0),
      day: DAY,
      onBrands: 1,
    });
    expect(quiet.totals.r2_class_a).toBe(3);
    expect(quiet.alerts).toEqual([]);
    const tripped = FIGURES.r2ClassAWeek * 3 + 1;
    const result = await checkCostRegression({
      graphql: day(0, tripped, 0),
      day: DAY,
      onBrands: 1,
    });
    expect(result.alerts).toEqual([
      {
        id: "cost-guard:2026-09-21:r2_class_a",
        line: "r2_class_a",
        measured: tripped,
        expected: FIGURES.r2ClassAWeek,
        day: DAY,
      },
    ]);
  });

  it("counts ListObjects as Class A and DeleteObject as free", async () => {
    const result = await checkCostRegression({
      graphql: envelope({
        d1: [{ dimensions: { date: DAY, databaseId: FIGURES.databaseId }, sum: { rowsWritten: 0 } }],
        r2: [
          { dimensions: { date: DAY, actionType: "ListObjects", bucketName: FIGURES.bucket }, sum: { requests: 2 } },
          { dimensions: { date: DAY, actionType: "DeleteObject", bucketName: FIGURES.bucket }, sum: { requests: 100 } },
          { dimensions: { date: DAY, actionType: "GetObject", bucketName: FIGURES.bucket }, sum: { requests: 9 } },
        ],
        browser: [{ dimensions: { date: DAY }, sum: { totalSessionDurationMs: 0 } }],
      }),
      day: DAY,
      onBrands: 0,
    });
    expect(result.totals.r2_class_a).toBe(2);
    expect(result.alerts).toEqual([]);
  });

  it("refuses an unrecognized R2 action instead of dropping it", async () => {
    await expect(
      checkCostRegression({
        graphql: envelope({
          d1: [],
          r2: [
            {
              dimensions: { date: DAY, actionType: "NotARealAction", bucketName: FIGURES.bucket },
              sum: { requests: 1 },
            },
          ],
          browser: [],
        }),
        day: DAY,
        onBrands: 0,
      }),
    ).rejects.toThrow("cost-guard: unrecognized R2 actionType NotARealAction");
  });

  it("refuses a D1 group with no databaseId", async () => {
    await expect(
      checkCostRegression({
        graphql: envelope({
          d1: [{ dimensions: { date: DAY }, sum: { rowsWritten: 5_097_246 } }],
          r2: [],
          browser: [],
        }),
        day: DAY,
        onBrands: 1,
      }),
    ).rejects.toThrow("cost-guard: d1 group has no databaseId");
  });

  it("refuses a D1 group for a different database", async () => {
    await expect(
      checkCostRegression({
        graphql: envelope({
          d1: [
            {
              dimensions: { date: DAY, databaseId: "887316c4-ca9d-4068-a7fa-1f530b479437" },
              sum: { rowsWritten: 11 },
            },
          ],
          r2: [],
          browser: [],
        }),
        day: DAY,
        onBrands: 1,
      }),
    ).rejects.toThrow("cost-guard: d1 group is not this database");
  });

  it("refuses an R2 group for a different bucket", async () => {
    await expect(
      checkCostRegression({
        graphql: envelope({
          d1: [],
          r2: [
            {
              dimensions: { date: DAY, actionType: "ListObjects", bucketName: "nish-hostinger-kvm4-backups" },
              sum: { requests: 1609 },
            },
          ],
          browser: [],
        }),
        day: DAY,
        onBrands: 0,
      }),
    ).rejects.toThrow("cost-guard: r2 group is not the product bucket");
  });

  it("refuses a full D1 page, a full R2 page, and a full browser page", async () => {
    const d1 = Array.from({ length: 10 }, () => ({
      dimensions: { date: DAY, databaseId: FIGURES.databaseId },
      sum: { rowsWritten: 1 },
    }));
    await expect(
      checkCostRegression({ graphql: envelope({ d1, r2: [], browser: [] }), day: DAY, onBrands: 0 }),
    ).rejects.toThrow("cost-guard: d1 returned 10 groups, a full page");

    const r2 = Array.from({ length: 100 }, () => ({
      dimensions: { date: DAY, actionType: "PutObject", bucketName: FIGURES.bucket },
      sum: { requests: 1 },
    }));
    await expect(
      checkCostRegression({ graphql: envelope({ d1: [], r2, browser: [] }), day: DAY, onBrands: 0 }),
    ).rejects.toThrow("cost-guard: r2 returned 100 groups, a full page");

    const browser = Array.from({ length: 10 }, () => ({
      dimensions: { date: DAY },
      sum: { totalSessionDurationMs: 1 },
    }));
    await expect(
      checkCostRegression({ graphql: envelope({ d1: [], r2: [], browser }), day: DAY, onBrands: 0 }),
    ).rejects.toThrow("cost-guard: browser returned 10 groups, a full page");
  });

  it("refuses a GraphQL errors array", async () => {
    await expect(
      checkCostRegression({
        graphql: { ...day(0), errors: [{ message: "budget" }] },
        day: DAY,
        onBrands: 0,
      }),
    ).rejects.toThrow("cost-guard: graphql returned errors");
  });

  it("rejects a negative ON brand count and accepts zero", async () => {
    await expect(checkCostRegression({ graphql: day(0), day: DAY, onBrands: -1 })).rejects.toThrow(
      "cost-guard: ON brand count must be a non-negative integer",
    );
    const result = await checkCostRegression({ graphql: day(0), day: DAY, onBrands: 0 });
    expect(result.onBrands).toBe(0);
    expect(result.alerts).toEqual([]);
  });

  it("requests the previous UTC day, this database, and the product bucket", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(day(0)), { status: 200, headers: { "content-type": "application/json" } })),
    );
    await checkCostRegression({
      accountId: "f670a698e17bf160c8e4679823e68916",
      apiToken: "test-token",
      fetchImpl,
      onBrands: 1,
      now: new Date("2026-09-22T01:00:00Z"),
    });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ authorization: "Bearer test-token" });
    const body = JSON.parse(String(init?.body)) as { query: string };
    expect(body.query).toContain('date_geq: "2026-09-21"');
    expect(body.query).toContain('date_leq: "2026-09-21"');
    expect(body.query).toContain(`databaseId: "${FIGURES.databaseId}"`);
    expect(body.query).toContain(`bucketName: "${FIGURES.bucket}"`);
    expect(body.query).toContain('accountTag: "f670a698e17bf160c8e4679823e68916"');
    expect(body.query).not.toContain("scriptName");
  });

  it("reads 2026-10-31 when now is 2026-11-01T00:30:00Z", async () => {
    const october = envelope({
      d1: [{ dimensions: { date: "2026-10-31", databaseId: FIGURES.databaseId }, sum: { rowsWritten: 0 } }],
      r2: [],
      browser: [{ dimensions: { date: "2026-10-31" }, sum: { totalSessionDurationMs: 0 } }],
    });
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(JSON.stringify(october), { status: 200 })));
    const result = await checkCostRegression({
      accountId: "0123456789abcdef0123456789abcdef",
      apiToken: "test-token",
      fetchImpl,
      onBrands: 0,
      now: new Date("2026-11-01T00:30:00Z"),
    });
    expect(result.day).toBe("2026-10-31");
    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as { query: string };
    expect(body.query).toContain('date_geq: "2026-10-31"');
  });
});
