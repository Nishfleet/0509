import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  funnelErrorKind,
  funnelResultCountBucket,
  hasGpcOptOut,
  isFunnelMeasurementEnabled,
  recordFunnelEvent,
  type FunnelEventSpec,
} from "~/lib/funnel-measurement.server";

const FORBIDDEN_KEYS = [
  "visitor_id",
  "session_id",
  "user_id",
  "email",
  "query",
  "url",
  "referrer",
  "ip",
  "user_agent",
  "token",
  "cookie",
];

function capturedLogLines(): string[] {
  const lines = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
  return lines.filter((line) => line.includes('"operation"'));
}

function parseEvents(): Record<string, unknown>[] {
  return capturedLogLines().map((line) => JSON.parse(line));
}

function requestWith(headers: Record<string, string> = {}) {
  return new Request("http://localhost/search", { headers });
}

const enabledEnv = { FUNNEL_MEASUREMENT_ENABLED: "1" } as const;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isFunnelMeasurementEnabled", () => {
  it("is off when the environment variable is absent", () => {
    expect(isFunnelMeasurementEnabled({})).toBe(false);
  });

  it("is off for any value other than exactly 1", () => {
    for (const value of ["true", "yes", "on", "0", "2", "enabled", ""]) {
      expect(isFunnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: value })).toBe(false);
    }
  });

  it("is on only for exactly 1", () => {
    expect(isFunnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "1" })).toBe(true);
  });
});

describe("hasGpcOptOut", () => {
  it("detects the standard Sec-GPC signal", () => {
    expect(hasGpcOptOut(requestWith({ "Sec-GPC": "1" }))).toBe(true);
  });

  it("detects the legacy GPC header", () => {
    expect(hasGpcOptOut(requestWith({ GPC: "1" }))).toBe(true);
  });

  it("treats an absent or non-opt-out signal as no opt-out", () => {
    expect(hasGpcOptOut(requestWith())).toBe(false);
    expect(hasGpcOptOut(requestWith({ "Sec-GPC": "0" }))).toBe(false);
  });
});

describe("funnelResultCountBucket", () => {
  it("bounds exact counts into the coarse buckets", () => {
    expect(funnelResultCountBucket(0)).toBe("0");
    expect(funnelResultCountBucket(1)).toBe("1-10");
    expect(funnelResultCountBucket(10)).toBe("1-10");
    expect(funnelResultCountBucket(11)).toBe("11-50");
    expect(funnelResultCountBucket(50)).toBe("11-50");
    expect(funnelResultCountBucket(51)).toBe("51+");
    expect(funnelResultCountBucket(1000)).toBe("51+");
  });

  it("rejects malformed or untrusted counts", () => {
    expect(funnelResultCountBucket(-1)).toBeNull();
    expect(funnelResultCountBucket(NaN)).toBeNull();
    expect(funnelResultCountBucket(Infinity)).toBeNull();
    expect(funnelResultCountBucket("12")).toBeNull();
    expect(funnelResultCountBucket(undefined)).toBeNull();
    expect(funnelResultCountBucket(null)).toBeNull();
  });
});

describe("funnelErrorKind", () => {
  it("passes only allowlisted coarse classes", () => {
    expect(funnelErrorKind("rate_limited")).toBe("rate_limited");
    expect(funnelErrorKind("timeout")).toBe("timeout");
    expect(funnelErrorKind("provider_unavailable")).toBe("provider_unavailable");
  });

  it("rejects unknown or free-text error labels", () => {
    expect(funnelErrorKind("Meta API returned 500 with body: SELECT * FROM users")).toBeNull();
    expect(funnelErrorKind("my custom failure")).toBeNull();
    expect(funnelErrorKind(null)).toBeNull();
    expect(funnelErrorKind(undefined)).toBeNull();
  });
});

describe("recordFunnelEvent", () => {
  it("records nothing by default (gate absent)", () => {
    const emitted = recordFunnelEvent({}, requestWith(), {
      operation: "funnel_home_view",
      route: "home",
    });
    expect(emitted).toBe(false);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("records nothing for GPC requests even when enabled", () => {
    const emitted = recordFunnelEvent(enabledEnv, requestWith({ "Sec-GPC": "1" }), {
      operation: "funnel_home_view",
      route: "home",
    });
    expect(emitted).toBe(false);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("records a minimal anonymous event with server fields only", () => {
    const emitted = recordFunnelEvent(enabledEnv, requestWith(), {
      operation: "funnel_home_view",
      route: "home",
    });
    expect(emitted).toBe(true);
    const events = parseEvents();
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event).toMatchObject({
      level: "info",
      operation: "funnel_home_view",
      message: "funnel_home_view",
      details: { route: "home", account_scope: "anonymous" },
    });
    expect(String(event.eventId)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(new Date(String(event.timestamp)).toISOString()).toBe(String(event.timestamp));
  });

  it("rejects events outside the route allowlist", () => {
    const emitted = recordFunnelEvent(enabledEnv, requestWith(), {
      operation: "funnel_home_view",
      route: "admin",
    } as unknown as FunnelEventSpec);
    expect(emitted).toBe(false);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("rejects operations outside the event allowlist", () => {
    const emitted = recordFunnelEvent(enabledEnv, requestWith(), {
      operation: "funnel_click",
      route: "home",
    } as unknown as FunnelEventSpec);
    expect(emitted).toBe(false);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("rejects a result event without a valid bucket", () => {
    const emitted = recordFunnelEvent(enabledEnv, requestWith(), {
      operation: "funnel_search_preview_result",
      route: "search_preview",
      resultCountBucket: "all" as unknown as never,
    });
    expect(emitted).toBe(false);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("rejects an error event with an unapproved kind", () => {
    const emitted = recordFunnelEvent(enabledEnv, requestWith(), {
      operation: "funnel_search_preview_error",
      route: "search_preview",
      errorKind: "provider exploded" as unknown as never,
    });
    expect(emitted).toBe(false);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("records the coarse bucket on result events and nothing else", () => {
    const emitted = recordFunnelEvent(enabledEnv, requestWith(), {
      operation: "funnel_search_preview_result",
      route: "search_preview",
      resultCountBucket: "11-50",
    });
    expect(emitted).toBe(true);
    const event = parseEvents()[0];
    expect(event).toMatchObject({
      operation: "funnel_search_preview_result",
      details: {
        route: "search_preview",
        account_scope: "anonymous",
        result_count_bucket: "11-50",
      },
    });
    expect(event.details).not.toHaveProperty("error_kind");
  });

  it("records the coarse error kind on error events and nothing else", () => {
    const emitted = recordFunnelEvent(enabledEnv, requestWith(), {
      operation: "funnel_search_preview_error",
      route: "search_preview",
      errorKind: "timeout",
    });
    expect(emitted).toBe(true);
    const event = parseEvents()[0];
    expect(event).toMatchObject({
      operation: "funnel_search_preview_error",
      details: {
        route: "search_preview",
        account_scope: "anonymous",
        error_kind: "timeout",
      },
    });
    expect(event.details).not.toHaveProperty("result_count_bucket");
  });

  it("never lets forbidden fields reach a log record", () => {
    recordFunnelEvent(enabledEnv, requestWith({ "x-request-id": "trace-123" }), {
      operation: "funnel_signup_start",
      route: "signup",
    });
    const events = parseEvents();
    expect(events).toHaveLength(1);
    const raw = JSON.stringify(events[0]);
    expect(raw).not.toMatch(/@[^\s"']+\.[^\s"']+/);
    expect(raw).not.toMatch(/https?:\/\/[^\s"']+\?/);
    expect(raw).not.toMatch(/traffic|nykaa|samplebrand/i);
    for (const key of FORBIDDEN_KEYS) {
      expect(raw).not.toContain(key);
    }
  });

  it("does not emit an event for a non-anonymous spec shape (workspace scope)", () => {
    const emitted = recordFunnelEvent(enabledEnv, requestWith(), {
      operation: "funnel_home_view",
      route: "home",
      workspaceId: "ws-1",
    } as unknown as FunnelEventSpec);
    expect(emitted).toBe(true);
    const event = parseEvents()[0];
    expect(event.details).not.toHaveProperty("workspace_id");
    expect(JSON.stringify(event)).not.toContain("ws-1");
  });
});
