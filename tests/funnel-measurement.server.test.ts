import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  funnelErrorKind,
  funnelResultCountBucket,
  isFunnelGpcOptOut,
  isFunnelMeasurementEnabled,
  recordFunnelEvent,
} from "~/lib/funnel-measurement.server";
import { logAppEvent } from "~/lib/log.server";

function env(overrides: Partial<AppEnv> = {}): AppEnv {
  return { APP_ORIGIN: "https://0509.io", ...overrides };
}

function captureLogLine() {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(line);
  });
  return { lines, spy };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isFunnelMeasurementEnabled", () => {
  it("is disabled by default and for every value except the exact 'true'", () => {
    expect(isFunnelMeasurementEnabled(env())).toBe(false);
    expect(isFunnelMeasurementEnabled(env({ FUNNEL_MEASUREMENT_ENABLED: "" }))).toBe(false);
    expect(isFunnelMeasurementEnabled(env({ FUNNEL_MEASUREMENT_ENABLED: "1" }))).toBe(false);
    expect(isFunnelMeasurementEnabled(env({ FUNNEL_MEASUREMENT_ENABLED: "yes" }))).toBe(false);
    expect(isFunnelMeasurementEnabled(env({ FUNNEL_MEASUREMENT_ENABLED: "on" }))).toBe(false);
    expect(isFunnelMeasurementEnabled(env({ FUNNEL_MEASUREMENT_ENABLED: "false" }))).toBe(false);
    expect(isFunnelMeasurementEnabled(env({ FUNNEL_MEASUREMENT_ENABLED: "enabled" }))).toBe(false);
  });

  it("enables only on an explicit 'true' value", () => {
    expect(isFunnelMeasurementEnabled(env({ FUNNEL_MEASUREMENT_ENABLED: "true" }))).toBe(true);
    expect(isFunnelMeasurementEnabled(env({ FUNNEL_MEASUREMENT_ENABLED: "TRUE" }))).toBe(true);
    expect(isFunnelMeasurementEnabled(env({ FUNNEL_MEASUREMENT_ENABLED: " true " }))).toBe(true);
  });
});

describe("isFunnelGpcOptOut", () => {
  it("treats Sec-GPC: 1 as opted out and everything else as not opted out", () => {
    expect(isFunnelGpcOptOut(new Request("https://0509.io/", { headers: { "sec-gpc": "1" } }))).toBe(true);
    expect(isFunnelGpcOptOut(new Request("https://0509.io/"))).toBe(false);
    expect(isFunnelGpcOptOut(new Request("https://0509.io/", { headers: { "sec-gpc": "0" } }))).toBe(false);
    expect(
      isFunnelGpcOptOut(
        new Request("https://0509.io/", {
          headers: { "dnt": "1", "sec-gpc": "0" },
        }),
      ),
    ).toBe(false);
  });
});

describe("recordFunnelEvent privacy gates", () => {
  it("emits nothing when collection is disabled by default", () => {
    const { lines } = captureLogLine();
    recordFunnelEvent(env(), new Request("https://0509.io/"), { event: "funnel_home_view" });
    recordFunnelEvent(env(), new Request("https://0509.io/search"), {
      event: "funnel_search_preview_result",
      resultCountBucket: "1-10",
    });
    expect(lines).toEqual([]);
  });

  it("emits nothing for a GPC opt-out request even when collection is enabled", () => {
    const { lines } = captureLogLine();
    const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
    const gpcRequest = new Request("https://0509.io/", { headers: { "sec-gpc": "1" } });
    recordFunnelEvent(enabled, gpcRequest, { event: "funnel_home_view" });
    recordFunnelEvent(enabled, gpcRequest, { event: "funnel_search_preview_submit" });
    recordFunnelEvent(enabled, gpcRequest, { event: "funnel_signup_start" });
    expect(lines).toEqual([]);
  });

  it("emits one record with only allowlisted fields for each event type", () => {
    const { lines } = captureLogLine();
    const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
    const request = new Request("https://0509.io/search");

    recordFunnelEvent(enabled, request, { event: "funnel_home_view" });
    recordFunnelEvent(enabled, request, { event: "funnel_search_preview_submit" });
    recordFunnelEvent(enabled, request, {
      event: "funnel_search_preview_result",
      resultCountBucket: "51+",
    });
    recordFunnelEvent(enabled, request, {
      event: "funnel_search_preview_error",
      errorKind: "timeout",
    });
    recordFunnelEvent(enabled, request, { event: "funnel_signup_start" });

    expect(lines).toHaveLength(5);

    const expectedOperations = [
      "funnel_home_view",
      "funnel_search_preview_submit",
      "funnel_search_preview_result",
      "funnel_search_preview_error",
      "funnel_signup_start",
    ];
    const expectedRoutes = ["home", "search_preview", "search_preview", "search_preview", "signup"];

    for (let index = 0; index < lines.length; index += 1) {
      const record = JSON.parse(lines[index]) as {
        level: string;
        operation: string;
        message: string;
        timestamp: string;
        details: Record<string, unknown>;
      };
      expect(record.level).toBe("info");
      expect(record.operation).toBe(expectedOperations[index]);
      expect(record.message).toBe(expectedOperations[index]);
      expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
      expect(record.details.account_scope).toBe("anonymous");
      expect(record.details.route).toBe(expectedRoutes[index]);
      expect(record.details.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(Object.keys(record.details).sort()).toEqual(
        expectedOperations[index] === "funnel_search_preview_result"
          ? ["account_scope", "event_id", "result_count_bucket", "route"].sort()
          : expectedOperations[index] === "funnel_search_preview_error"
            ? ["account_scope", "error_kind", "event_id", "route"].sort()
            : ["account_scope", "event_id", "route"].sort(),
      );
      if (record.operation === "funnel_search_preview_result") {
        expect(record.details.result_count_bucket).toBe("51+");
        expect(record.details.error_kind).toBeUndefined();
      }
      if (record.operation === "funnel_search_preview_error") {
        expect(record.details.error_kind).toBe("timeout");
        expect(record.details.result_count_bucket).toBeUndefined();
      }
    }
  });

  it("never lets untrusted extra fields reach the record, even via a type cast", () => {
    const { lines } = captureLogLine();
    const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
    const request = new Request("https://0509.io/search?query=secret");

    recordFunnelEvent(enabled, request, {
      event: "funnel_search_preview_result",
      resultCountBucket: "0",
      query: "secret query",
      email: "visitor@example.com",
      referrer: "https://evil.example.com/?q=1",
      userAgent: "Mozilla/5.0 secret",
    } as never);

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as { details: Record<string, unknown> };
    expect(Object.keys(record.details).sort()).toEqual(
      ["account_scope", "event_id", "result_count_bucket", "route"].sort(),
    );
    expect(JSON.stringify(record)).not.toContain("secret query");
    expect(JSON.stringify(record)).not.toContain("visitor@example.com");
    expect(JSON.stringify(record)).not.toContain("evil.example.com");
    expect(JSON.stringify(record)).not.toContain("Mozilla");
  });

  it("drops unknown event names instead of writing a record", () => {
    const { lines } = captureLogLine();
    const enabled = env({ FUNNEL_MEASUREMENT_ENABLED: "true" });
    recordFunnelEvent(enabled, new Request("https://0509.io/"), {
      event: "funnel_evil_event",
    } as never);
    expect(lines).toEqual([]);
  });

  it("buckets the result count into the spec's coarse buckets", () => {
    expect(funnelResultCountBucket(-3)).toBe("0");
    expect(funnelResultCountBucket(0)).toBe("0");
    expect(funnelResultCountBucket(1)).toBe("1-10");
    expect(funnelResultCountBucket(10)).toBe("1-10");
    expect(funnelResultCountBucket(11)).toBe("11-50");
    expect(funnelResultCountBucket(50)).toBe("11-50");
    expect(funnelResultCountBucket(51)).toBe("51+");
    expect(funnelResultCountBucket(1000)).toBe("51+");
  });

  it("maps error inputs to coarse kinds only", () => {
    expect(funnelErrorKind({ failureClass: "login_wall" })).toBe("login_wall");
    expect(funnelErrorKind({ failureClass: "selector_drift" })).toBe("selector_drift");
    expect(funnelErrorKind({ failureClass: "not_a_kind" })).toBe("provider_unavailable");
    expect(funnelErrorKind(new Error("provider timeout after 30s"))).toBe("timeout");
    expect(funnelErrorKind(new Error("429 Too Many Requests"))).toBe("rate_limited");
    expect(funnelErrorKind(new Error("provider timed out"))).toBe("provider_unavailable");
    expect(funnelErrorKind(new Error("everything is broken"))).toBe("provider_unavailable");
    expect(funnelErrorKind("raw string error")).toBe("provider_unavailable");
    expect(funnelErrorKind(null)).toBe("provider_unavailable");
  });
});

describe("funnel records flow through the existing log redaction", () => {
  it("redacts credential-named values in any record that travels the log path", () => {
    const { lines } = captureLogLine();
    logAppEvent("info", "funnel_home_view", "funnel_home_view", {
      details: {
        event_id: "e1",
        route: "home",
        account_scope: "anonymous",
        attacker_injected: { api_key: "sk-live-secret", token: "abc-123" },
      },
    } as never);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("sk-live-secret");
    expect(lines[0]).not.toContain("abc-123");
    expect(lines[0]).toContain("[redacted]");
  });
});
