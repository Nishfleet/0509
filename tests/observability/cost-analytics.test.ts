import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_TAG,
  D1_DATABASE_ID,
  R2_CLASS_A_ACTIONS,
  SNAPSHOT_BUCKET,
  USAGE_QUERY,
  fetchDailyUsage,
  parseUsageResponse,
} from "../../app/lib/observability/cost-analytics.server";

const fixture: unknown = JSON.parse(
  readFileSync(new URL("../fixtures/cf-graphql-usage.json", import.meta.url), "utf8"),
);

const DAY = {
  day: "2026-09-22",
  d1RowsWritten: 4677,
  r2ClassAOps: 13,
  browserMs: 157107,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseUsageResponse", () => {
  it("sums the committed GraphQL fixture for 2026-09-22", () => {
    expect(parseUsageResponse("2026-09-22", fixture)).toEqual(DAY);
  });

  it("throws the Cloudflare error message", () => {
    expect(() => parseUsageResponse("2026-09-22", { errors: [{ message: "x" }] })).toThrow(
      /cloudflare graphql: x/,
    );
  });

  it("throws when the account row is missing", () => {
    expect(() =>
      parseUsageResponse("2026-09-22", { data: { viewer: { accounts: [] } } }),
    ).toThrow();
  });

  it("sums an empty row list to zero", () => {
    expect(
      parseUsageResponse("2026-09-22", {
        data: { viewer: { accounts: [{ d1: [], r2: [], browser: [] }] } },
      }),
    ).toEqual({
      day: "2026-09-22",
      d1RowsWritten: 0,
      r2ClassAOps: 0,
      browserMs: 0,
    });
  });

  it("throws when an alias is not an array", () => {
    expect(() =>
      parseUsageResponse("2026-09-22", {
        data: { viewer: { accounts: [{ d1: null, r2: [], browser: [] }] } },
      }),
    ).toThrow(/cloudflare graphql: d1 is not an array/);
  });

  it("throws when a row has no sum", () => {
    expect(() =>
      parseUsageResponse("2026-09-22", {
        data: { viewer: { accounts: [{ d1: [{}], r2: [], browser: [] }] } },
      }),
    ).toThrow(/cloudflare graphql: d1 row has no sum/);
  });

  it("throws when a summed field is not a number", () => {
    expect(() =>
      parseUsageResponse("2026-09-22", {
        data: {
          viewer: {
            accounts: [{ d1: [{ sum: { rowsWritten: "4677" } }], r2: [], browser: [] }],
          },
        },
      }),
    ).toThrow(/cloudflare graphql: d1 rowsWritten is not a number/);
  });

  it("throws when a GraphQL error has no message", () => {
    expect(() => parseUsageResponse("2026-09-22", { errors: [{}] })).toThrow(
      /cloudflare graphql: missing error message/,
    );
  });
});

describe("fetchDailyUsage", () => {
  it("POSTs the usage query with the bearer token and returns the fixture sums", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchDailyUsage("2026-09-22", "test-token")).resolves.toEqual(DAY);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/graphql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
    const init = fetchSpy.mock.calls[0]?.[1];
    const rawBody = init && typeof init.body === "string" ? init.body : "";
    const sent: unknown = JSON.parse(rawBody);
    expect(sent).toEqual({
      query: USAGE_QUERY,
      variables: {
        accountTag: ACCOUNT_TAG,
        databaseId: D1_DATABASE_ID,
        bucket: SNAPSHOT_BUCKET,
        date: "2026-09-22",
        actions: [...R2_CLASS_A_ACTIONS],
      },
    });
  });
});
