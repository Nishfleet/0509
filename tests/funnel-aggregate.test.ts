import { describe, expect, it } from "vitest";

import {
  ERROR_KINDS,
  FUNNEL_OPERATIONS,
  RESULT_COUNT_BUCKETS,
  aggregateFunnelLogs,
  parseLogLine,
  renderFunnelReport,
} from "../scripts/funnel-aggregate.mjs";

function record(operation: string, day = "2026-08-07", details: Record<string, unknown> = {}) {
  return JSON.stringify({
    level: "info",
    operation,
    timestamp: `${day}T09:00:00.000Z`,
    eventId: "550e8400-e29b-41d4-a716-446655440000",
    details,
  });
}

describe("parseLogLine", () => {
  it("parses JSON log lines and rejects malformed input", () => {
    expect(parseLogLine('{"operation":"funnel_home_view"}')).toEqual({
      operation: "funnel_home_view",
    });
    expect(parseLogLine("")).toBeNull();
    expect(parseLogLine("not json")).toBeNull();
    expect(parseLogLine("[1,2]")).toBeNull();
    expect(parseLogLine('{"operation":"funnel_home_view"')).toBeNull();
  });
});

describe("aggregateFunnelLogs", () => {
  it("counts each funnel operation per day with bounded breakdowns", () => {
    const lines = [
      record("funnel_home_view"),
      record("funnel_home_view", "2026-08-07"),
      record("funnel_home_view", "2026-08-08"),
      record("funnel_search_preview_submit"),
      record("funnel_search_preview_result", "2026-08-07", {
        route: "search_preview",
        result_count_bucket: "1-10",
      }),
      record("funnel_search_preview_result", "2026-08-07", {
        route: "search_preview",
        result_count_bucket: "0",
      }),
      record("funnel_search_preview_error", "2026-08-07", {
        route: "search_preview",
        error_kind: "rate_limited",
      }),
      record("funnel_signup_start"),
    ];

    const aggregate = aggregateFunnelLogs(lines);

    expect(aggregate.map((entry) => entry.day)).toEqual(["2026-08-07", "2026-08-08"]);
    expect(aggregate[0].totals).toEqual({
      funnel_home_view: 2,
      funnel_search_preview_submit: 1,
      funnel_search_preview_result: 2,
      funnel_search_preview_error: 1,
      funnel_signup_start: 1,
    });
    expect(aggregate[0].resultBuckets).toEqual({ "0": 1, "1-10": 1, "11-50": 0, "51+": 0 });
    expect(aggregate[0].errorKinds).toEqual({
      rate_limited: 1,
      timeout: 0,
      provider_unavailable: 0,
      unknown: 0,
    });
    expect(aggregate[1].totals.funnel_home_view).toBe(1);
  });

  it("ignores non-funnel operations and non-object records", () => {
    const lines = [
      record("monitoring_fanout_scheduled"),
      '{"operation":42}',
      "not json",
      null,
    ];
    const aggregate = aggregateFunnelLogs(lines);
    expect(aggregate).toEqual([]);
  });

  it("ignores records with missing or malformed timestamps", () => {
    const lines = [
      '{"operation":"funnel_home_view"}',
      record("funnel_home_view", "2026-13-99"),
      record("funnel_home_view", "today"),
    ];
    const aggregate = aggregateFunnelLogs(lines);
    expect(aggregate).toEqual([]);
  });

  it("never counts tampered buckets or error kinds (allowlist enforcement)", () => {
    const lines = [
      record("funnel_search_preview_result", "2026-08-07", {
        route: "search_preview",
        result_count_bucket: "1-10",
      }),
      record("funnel_search_preview_result", "2026-08-07", {
        route: "search_preview",
        result_count_bucket: "a-million",
      }),
      record("funnel_search_preview_error", "2026-08-07", {
        route: "search_preview",
        error_kind: "fatal",
      }),
    ];
    const [entry] = aggregateFunnelLogs(lines);
    expect(entry.totals.funnel_search_preview_result).toBe(2);
    expect(entry.resultBuckets).toEqual({ "0": 0, "1-10": 1, "11-50": 0, "51+": 0 });
    expect(entry.totals.funnel_search_preview_error).toBe(1);
    expect(entry.errorKinds).toEqual({
      rate_limited: 0,
      timeout: 0,
      provider_unavailable: 0,
      unknown: 0,
    });
  });

  it("sorts days deterministically regardless of input order", () => {
    const lines = [record("funnel_home_view", "2026-08-09"), record("funnel_home_view", "2026-08-07")];
    const aggregate = aggregateFunnelLogs(lines);
    expect(aggregate.map((entry) => entry.day)).toEqual(["2026-08-07", "2026-08-09"]);
  });
});

describe("renderFunnelReport", () => {
  it("prints only counts and allowlisted labels, never raw values", () => {
    const lines = [
      record("funnel_home_view", "2026-08-07"),
      record("funnel_search_preview_result", "2026-08-07", {
        route: "search_preview",
        result_count_bucket: "11-50",
      }),
    ];
    const report = renderFunnelReport(aggregateFunnelLogs(lines));

    expect(report).toContain("2026-08-07");
    expect(report).toContain("funnel_home_view");
    expect(report).toContain("result_count_bucket: 0=0, 1-10=0, 11-50=1, 51+=0");
    expect(report).not.toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(report).not.toContain("09:00:00");
  });

  it("mirrors the event, bucket, and kind allowlists of the server helper", () => {
    expect(FUNNEL_OPERATIONS).toEqual([
      "funnel_home_view",
      "funnel_search_preview_submit",
      "funnel_search_preview_result",
      "funnel_search_preview_error",
      "funnel_signup_start",
    ]);
    expect(RESULT_COUNT_BUCKETS).toEqual(["0", "1-10", "11-50", "51+"]);
    expect(ERROR_KINDS).toEqual([
      "rate_limited",
      "timeout",
      "provider_unavailable",
      "unknown",
    ]);
  });
});
