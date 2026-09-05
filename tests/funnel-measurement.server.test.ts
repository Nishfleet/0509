import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FUNNEL_EVENT_NAMES,
  FUNNEL_ERROR_KINDS,
  FUNNEL_ROUTES,
  RESULT_COUNT_BUCKETS,
  bucketResultCount,
  emitFunnelEvent,
  funnelErrorKindFrom,
  gpcOptedOut,
  isFunnelEvent,
  isFunnelMeasurementEnabled,
} from "~/lib/funnel-measurement.server";

const disabledEnv = {};
const enabledEnv = { FUNNEL_MEASUREMENT_ENABLED: "true" };

function requestWith(gpc: boolean): Request {
  const headers = new Headers();
  if (gpc) {
    headers.set("sec-gpc", "1");
  }
  return new Request("https://0509.io/", { headers });
}

function capturedLogLines(spy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((call) => call[0])
    .filter((value): value is string => typeof value === "string")
    .map((value) => JSON.parse(value) as Record<string, unknown>);
}

describe("isFunnelMeasurementEnabled", () => {
  it("is off when the variable is absent or empty", () => {
    expect(isFunnelMeasurementEnabled(disabledEnv)).toBe(false);
    expect(isFunnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "" })).toBe(false);
    expect(isFunnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "  " })).toBe(false);
  });

  it("enables only for the exact value true", () => {
    expect(isFunnelMeasurementEnabled(enabledEnv)).toBe(true);
    expect(isFunnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "TRUE" })).toBe(true);
    expect(isFunnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "1" })).toBe(false);
    expect(isFunnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "yes" })).toBe(false);
    expect(isFunnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "on" })).toBe(false);
    expect(isFunnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "true " })).toBe(true);
  });
});

describe("gpcOptedOut", () => {
  it("treats Sec-GPC: 1 as opted out", () => {
    expect(gpcOptedOut(requestWith(true))).toBe(true);
    expect(gpcOptedOut(requestWith(false))).toBe(false);
  });

  it("does not treat other GPC values as opt-outs", () => {
    const request = new Request("https://0509.io/", { headers: { "sec-gpc": "0" } });
    expect(gpcOptedOut(request)).toBe(false);
  });

  it("does not crash without a request object", () => {
    expect(gpcOptedOut(null)).toBe(false);
    expect(gpcOptedOut(undefined)).toBe(false);
  });
});

describe("bucketResultCount", () => {
  it("maps bounded result counts to the spec buckets", () => {
    expect(bucketResultCount(0)).toBe("0");
    expect(bucketResultCount(1)).toBe("1-10");
    expect(bucketResultCount(10)).toBe("1-10");
    expect(bucketResultCount(11)).toBe("11-50");
    expect(bucketResultCount(50)).toBe("11-50");
    expect(bucketResultCount(51)).toBe("51+");
    expect(bucketResultCount(5000)).toBe("51+");
  });

  it("rejects malformed or untrusted counts instead of inventing a bucket", () => {
    expect(bucketResultCount(-1)).toBeNull();
    expect(bucketResultCount(NaN)).toBeNull();
    expect(bucketResultCount(Infinity)).toBeNull();
    expect(bucketResultCount(3.7)).toBeNull();
    expect(bucketResultCount("5" as unknown as number)).toBeNull();
    expect(bucketResultCount(null as unknown as number)).toBeNull();
    expect(bucketResultCount(undefined as unknown as number)).toBeNull();
  });
});

describe("funnelErrorKindFrom", () => {
  it("maps discovery failure classes to coarse kinds", () => {
    expect(funnelErrorKindFrom({ failureClass: "rate_limited" })).toBe("rate_limited");
    expect(funnelErrorKindFrom({ failureClass: "timeout" })).toBe("timeout");
    expect(funnelErrorKindFrom({ failureClass: "login_wall" })).toBe("unknown");
    expect(funnelErrorKindFrom({ failureClass: "provider_unavailable" })).toBe("unknown");
  });

  it("maps provider error duck-typing without reading message bodies", () => {
    expect(funnelErrorKindFrom({ isRateLimit: true })).toBe("rate_limited");
    expect(funnelErrorKindFrom({ code: 500 })).toBe("provider_unavailable");
    expect(funnelErrorKindFrom({ code: 429 })).toBe("unknown");
    expect(funnelErrorKindFrom(new Error("rate limit exceeded for user a@b.com"))).toBe(
      "unknown",
    );
    expect(funnelErrorKindFrom("some string")).toBe("unknown");
    expect(funnelErrorKindFrom(null)).toBe("unknown");
  });
});

describe("isFunnelEvent", () => {
  it("accepts only known event names", () => {
    expect(isFunnelEvent({ name: "funnel_home_view" })).toBe(true);
    expect(
      isFunnelEvent({ name: "funnel_search_preview_result", resultCountBucket: "1-10" }),
    ).toBe(true);
    expect(isFunnelEvent({ name: "not_a_funnel_event" } as never)).toBe(false);
    expect(isFunnelEvent(null as never)).toBe(false);
  });

  it("accepts only allowlisted buckets and error kinds", () => {
    expect(
      isFunnelEvent({ name: "funnel_search_preview_result", resultCountBucket: "51+" }),
    ).toBe(true);
    expect(
      isFunnelEvent({ name: "funnel_search_preview_result", resultCountBucket: "999" as never }),
    ).toBe(false);
    expect(isFunnelEvent({ name: "funnel_search_preview_error", errorKind: "timeout" })).toBe(
      true,
    );
    expect(
      isFunnelEvent({ name: "funnel_search_preview_error", errorKind: "fatal" as never }),
    ).toBe(false);
  });
});

describe("emitFunnelEvent", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits nothing when collection is disabled", () => {
    emitFunnelEvent(disabledEnv, requestWith(false), { name: "funnel_home_view" });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("emits nothing for GPC requests even when enabled", () => {
    emitFunnelEvent(enabledEnv, requestWith(true), { name: "funnel_home_view" });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("emits only allowlisted fields for a plain event", () => {
    emitFunnelEvent(enabledEnv, requestWith(false), { name: "funnel_home_view" });
    const [record] = capturedLogLines(consoleSpy);

    expect(record.operation).toBe("funnel_home_view");
    expect(record.level).toBe("info");
    expect(typeof record.eventId).toBe("string");
    expect(String(record.eventId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(record.timestamp)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.details).toEqual({ route: "home" });
  });

  it("emits only allowlisted fields for result and error events", () => {
    emitFunnelEvent(enabledEnv, requestWith(false), {
      name: "funnel_search_preview_result",
      resultCountBucket: "11-50",
    });
    emitFunnelEvent(enabledEnv, requestWith(false), {
      name: "funnel_search_preview_error",
      errorKind: "rate_limited",
    });

    const [resultRecord, errorRecord] = capturedLogLines(consoleSpy);
    expect(resultRecord.details).toEqual({
      route: "search_preview",
      result_count_bucket: "11-50",
    });
    expect(errorRecord.details).toEqual({
      route: "search_preview",
      error_kind: "rate_limited",
    });
  });

  it("uses only spec routes and never a caller-supplied URL", () => {
    emitFunnelEvent(enabledEnv, requestWith(false), { name: "funnel_signup_start" });
    const [record] = capturedLogLines(consoleSpy);
    expect(record.details).toEqual({ route: "signup" });
    expect(FUNNEL_ROUTES).toEqual(["home", "search_preview", "signup"]);
  });

  it("drops tampered inputs instead of writing them (field allowlisting)", () => {
    const tampered = {
      name: "funnel_home_view",
      details: { email: "victim@example.com", query: "nykaa", fullUrl: "https://0509.io/search?q=x" },
    } as never;
    emitFunnelEvent(enabledEnv, requestWith(false), tampered);

    const [record] = capturedLogLines(consoleSpy);
    expect(record.details).toEqual({ route: "home" });
    expect(JSON.stringify(record)).not.toContain("victim@example.com");
    expect(JSON.stringify(record)).not.toContain("nykaa");
    expect(JSON.stringify(record)).not.toContain("q=x");
  });

  it("drops unknown buckets and error kinds at runtime", () => {
    emitFunnelEvent(enabledEnv, requestWith(false), {
      name: "funnel_search_preview_result",
      resultCountBucket: "lots" as never,
    });
    emitFunnelEvent(enabledEnv, requestWith(false), {
      name: "funnel_search_preview_error",
      errorKind: "database on fire" as never,
    });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("never writes a forbidden string into any emitted record", () => {
    const forbidden = [
      "victim@example.com",
      "https://0509.io/search?query=secret-term",
      "tok_1234567890",
      "Bearer abcdef",
    ];
    for (const value of forbidden) {
      emitFunnelEvent(enabledEnv, requestWith(false), {
        name: "funnel_search_preview_error",
        errorKind: "unknown",
      });
      const [record] = capturedLogLines(consoleSpy);
      expect(JSON.stringify(record)).not.toContain(value);
      consoleSpy.mockClear();
    }
  });

  it("exposes exactly the spec allowlists from this module", () => {
    expect(FUNNEL_EVENT_NAMES).toEqual([
      "funnel_home_view",
      "funnel_search_preview_submit",
      "funnel_search_preview_result",
      "funnel_search_preview_error",
      "funnel_signup_start",
    ]);
    expect(RESULT_COUNT_BUCKETS).toEqual(["0", "1-10", "11-50", "51+"]);
    expect(FUNNEL_ERROR_KINDS).toEqual([
      "rate_limited",
      "timeout",
      "provider_unavailable",
      "unknown",
    ]);
  });
});
