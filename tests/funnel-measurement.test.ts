import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { CommercialDiscoveryError } from "~/lib/meta-library-browser.server";
import { writeAppLog } from "~/lib/log.server";

const FUNNEL_OPERATIONS = [
  "funnel_home_view",
  "funnel_search_preview_submit",
  "funnel_search_preview_result",
  "funnel_search_preview_error",
  "funnel_signup_start",
  "funnel_pricing_free_card_clicked",
  "funnel_signup_completed",
  "funnel_first_brief_generated",
  "funnel_first_brief_viewed",
  "funnel_activation_scan_started",
  "funnel_first_brief_email_sent",
];

function emittedFunnelRecords(logSpy: MockInstance): Record<string, unknown>[] {
  return logSpy.mock.calls
    .map((call) => call[0])
    .filter((line): line is string => typeof line === "string")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(
      (record): record is Record<string, unknown> =>
        Boolean(record && typeof record === "object") &&
        FUNNEL_OPERATIONS.includes(String((record as { operation?: unknown }).operation)),
    );
}

function createContext(env: Record<string, unknown> = {}) {
  return { cloudflare: { env } };
}

function makeFunnelRequest(url = "http://localhost/") {
  return new Request(url);
}

function makeFunnelPost(url: string, fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}


// Anonymous /search success mints f9_anon_search via react-router `data()`,
// which wraps the payload. Funnel assertions compare the payload itself.
function unwrapSearchLoaderData(out: unknown): unknown {
  if (
    typeof out === "object" &&
    out !== null &&
    (out as { type?: unknown }).type === "DataWithResponseInit" &&
    "data" in out
  ) {
    return (out as { data: unknown }).data;
  }
  return out;
}

describe("funnel measurement gate", () => {
  it("is disabled by default and for any absent or non-explicit value", async () => {
    const { funnelMeasurementEnabled } = await import("~/lib/funnel-measurement.server");
    expect(funnelMeasurementEnabled({})).toBe(false);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "" })).toBe(false);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "0" })).toBe(false);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "false" })).toBe(false);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "no" })).toBe(false);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "enabled" })).toBe(false);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "  " })).toBe(false);
  });

  it("enables only for the explicit allowlisted values", async () => {
    const { funnelMeasurementEnabled } = await import("~/lib/funnel-measurement.server");
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "1" })).toBe(true);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "true" })).toBe(true);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "yes" })).toBe(true);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "on" })).toBe(true);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: "TRUE" })).toBe(true);
    expect(funnelMeasurementEnabled({ FUNNEL_MEASUREMENT_ENABLED: " 1 " })).toBe(true);
  });

  it("is enabled in the committed production wrangler.jsonc vars", async () => {
    // Guards against the var being accidentally removed from the deployed
    // config: without it, production records ZERO funnel events and every
    // traction/activation/conversion decision stays unmeasurable. Same
    // committed-config guard pattern as tests/search-rollout-config.test.ts.
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync("wrangler.jsonc", "utf8");
    const withoutComments = raw
      .split("\n")
      .map((line) => {
        const commentIndex = line.indexOf("//");
        if (commentIndex === -1) return line;
        const before = line.slice(0, commentIndex);
        const quoteCount = (before.match(/"/g) ?? []).length;
        return quoteCount % 2 === 0 ? before : line;
      })
      .join("\n");
    const parsed = JSON.parse(withoutComments) as { vars?: Record<string, unknown> };
    const vars = parsed.vars ?? {};
    // Issue #2106 (2026-09-09): the spec §8 rollout gates cleared — redaction
    // test (#2103), retention/delete test (#2104), privacy-page copy (#2105),
    // and Nish's gates 1-2 approval with a 90-day retention period — so the
    // committed production config enables funnel measurement. The gate turns
    // on only for exact 1/true/yes/on, so "1" means on.
    expect(vars.FUNNEL_MEASUREMENT_ENABLED).toBe("1");
  });
});

describe("funnel first-brief viewed", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a request-scoped activation event", async () => {
    const { emitFunnelFirstBriefViewed } = await import("~/lib/funnel-measurement.server");
    emitFunnelFirstBriefViewed({ FUNNEL_MEASUREMENT_ENABLED: "1" }, makeFunnelRequest());
    const [record] = emittedFunnelRecords(logSpy) as [
      { operation: string; details: Record<string, string> },
    ];
    expect(record.operation).toBe("funnel_first_brief_viewed");
    expect(record.details.route).toBe("activation");
    expect(record.details.account_scope).toBe("workspace");
    expect(Object.keys(record.details).sort()).toEqual(
      ["account_scope", "event_id", "route"].sort(),
    );
    expect(JSON.stringify(record)).not.toMatch(/watchlist|proof|email|workspace_id/i);
  });

  it("stays silent when the gate is off or GPC is set", async () => {
    const { emitFunnelFirstBriefViewed } = await import("~/lib/funnel-measurement.server");
    emitFunnelFirstBriefViewed({}, makeFunnelRequest());
    const gpc = new Request("http://localhost/", { headers: { "sec-gpc": "1" } });
    emitFunnelFirstBriefViewed({ FUNNEL_MEASUREMENT_ENABLED: "1" }, gpc);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  });
});

describe("funnel activation events (BET 7, issue #1487)", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits activation_scan_started with the workspace activation shape", async () => {
    const { emitFunnelActivationScanStarted } = await import(
      "~/lib/funnel-measurement.server"
    );
    emitFunnelActivationScanStarted(
      { FUNNEL_MEASUREMENT_ENABLED: "1" },
      makeFunnelRequest(),
    );
    const [record] = emittedFunnelRecords(logSpy) as [
      { operation: string; message: string; details: Record<string, string> },
    ];
    expect(record.operation).toBe("funnel_activation_scan_started");
    expect(record.details.route).toBe("activation");
    expect(record.details.account_scope).toBe("workspace");
    expect(Object.keys(record.details).sort()).toEqual(
      ["account_scope", "event_id", "route"].sort(),
    );
    expect(JSON.stringify(record.details)).not.toMatch(
      /watchlist|competitor|workspace_id|@/i,
    );
    expect(JSON.stringify(record)).not.toMatch(/@/);
  });

  it("suppresses activation_scan_started when the gate is off or GPC is set", async () => {
    const { emitFunnelActivationScanStarted } = await import(
      "~/lib/funnel-measurement.server"
    );
    emitFunnelActivationScanStarted({}, makeFunnelRequest());
    const gpc = new Request("http://localhost/", { headers: { "sec-gpc": "1" } });
    emitFunnelActivationScanStarted(
      { FUNNEL_MEASUREMENT_ENABLED: "1" },
      gpc,
    );
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  });

  it("emits first_brief_email_sent without a request (async delivery path)", async () => {
    const { emitFunnelFirstBriefEmailSent } = await import(
      "~/lib/funnel-measurement.server"
    );
    emitFunnelFirstBriefEmailSent({ FUNNEL_MEASUREMENT_ENABLED: "1" });
    const [record] = emittedFunnelRecords(logSpy) as [
      { operation: string; message: string; details: Record<string, string> },
    ];
    expect(record.operation).toBe("funnel_first_brief_email_sent");
    expect(record.details.route).toBe("activation");
    expect(record.details.account_scope).toBe("workspace");
    expect(Object.keys(record.details).sort()).toEqual(
      ["account_scope", "event_id", "route"].sort(),
    );
    // The fixed message names "email" (safe generic word); the privacy
    // surface is details: no watchlist identity, competitor, or an address.
    expect(JSON.stringify(record.details)).not.toMatch(
      /watchlist|competitor|workspace_id|@/i,
    );
    expect(JSON.stringify(record)).not.toMatch(/@/);
  });

  it("suppresses first_brief_email_sent when the gate is off", async () => {
    const { emitFunnelFirstBriefEmailSent } = await import(
      "~/lib/funnel-measurement.server"
    );
    emitFunnelFirstBriefEmailSent({});
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  });
});

describe("funnel activation events (BET 7, issue #1862)", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits signup_completed with the workspace activation shape", async () => {
    const { emitFunnelSignupCompleted } = await import(
      "~/lib/funnel-measurement.server"
    );
    emitFunnelSignupCompleted(
      { FUNNEL_MEASUREMENT_ENABLED: "1" },
      makeFunnelRequest(),
    );
    const [record] = emittedFunnelRecords(logSpy) as [
      { operation: string; message: string; details: Record<string, string> },
    ];
    expect(record.operation).toBe("funnel_signup_completed");
    expect(record.details.route).toBe("activation");
    expect(record.details.account_scope).toBe("workspace");
    expect(Object.keys(record.details).sort()).toEqual(
      ["account_scope", "event_id", "route"].sort(),
    );
    // No email, name, user id, or workspace identity ever reaches a record.
    expect(JSON.stringify(record.details)).not.toMatch(
      /watchlist|competitor|workspace_id|@/i,
    );
    expect(JSON.stringify(record)).not.toMatch(/@/);
  });

  it("suppresses signup_completed when the gate is off or GPC is set", async () => {
    const { emitFunnelSignupCompleted } = await import(
      "~/lib/funnel-measurement.server"
    );
    emitFunnelSignupCompleted({}, makeFunnelRequest());
    const gpc = new Request("http://localhost/", { headers: { "sec-gpc": "1" } });
    emitFunnelSignupCompleted({ FUNNEL_MEASUREMENT_ENABLED: "1" }, gpc);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  });

  it("emits first_brief_generated without a request (async filing path)", async () => {
    const { emitFunnelFirstBriefGenerated } = await import(
      "~/lib/funnel-measurement.server"
    );
    emitFunnelFirstBriefGenerated({ FUNNEL_MEASUREMENT_ENABLED: "1" });
    const [record] = emittedFunnelRecords(logSpy) as [
      { operation: string; message: string; details: Record<string, string> },
    ];
    expect(record.operation).toBe("funnel_first_brief_generated");
    expect(record.details.route).toBe("activation");
    expect(record.details.account_scope).toBe("workspace");
    expect(Object.keys(record.details).sort()).toEqual(
      ["account_scope", "event_id", "route"].sort(),
    );
    expect(JSON.stringify(record.details)).not.toMatch(
      /watchlist|competitor|workspace_id|@/i,
    );
    expect(JSON.stringify(record)).not.toMatch(/@/);
  });

  it("suppresses first_brief_generated when the gate is off", async () => {
    const { emitFunnelFirstBriefGenerated } = await import(
      "~/lib/funnel-measurement.server"
    );
    emitFunnelFirstBriefGenerated({});
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  });
});

describe("funnel measurement GPC opt-out", () => {
  it("treats only the Sec-GPC: 1 signal as an opt-out", async () => {
    const { isGpcOptOut } = await import("~/lib/funnel-measurement.server");
    expect(isGpcOptOut(new Request("http://localhost/"))).toBe(false);
    expect(isGpcOptOut(new Request("http://localhost/", { headers: { "sec-gpc": "0" } }))).toBe(false);
    expect(isGpcOptOut(new Request("http://localhost/", { headers: { "sec-gpc": "true" } }))).toBe(false);
    expect(isGpcOptOut(new Request("http://localhost/", { headers: { "sec-gpc": "1" } }))).toBe(true);
    expect(isGpcOptOut(new Request("http://localhost/", { headers: { "sec-gpc": "0,1" } }))).toBe(true);
    expect(isGpcOptOut(new Request("http://localhost/", { headers: { "sec-gpc": "1,1" } }))).toBe(true);
  });
});

describe("funnel measurement emission", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits nothing when the gate is off", async () => {
    const { emitFunnelHomeView } = await import("~/lib/funnel-measurement.server");
    emitFunnelHomeView({}, makeFunnelRequest());
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("emits nothing when the request carries the GPC signal", async () => {
    const { emitFunnelHomeView } = await import("~/lib/funnel-measurement.server");
    const gpcRequest = new Request("http://localhost/", { headers: { "sec-gpc": "1" } });
    emitFunnelHomeView({ FUNNEL_MEASUREMENT_ENABLED: "1" }, gpcRequest);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("emits an allowlisted record when enabled and not opted out", async () => {
    const { emitFunnelHomeView } = await import("~/lib/funnel-measurement.server");
    emitFunnelHomeView({ FUNNEL_MEASUREMENT_ENABLED: "1" }, makeFunnelRequest());
    const records = emittedFunnelRecords(logSpy);
    expect(records).toHaveLength(1);
    const record = records[0] as {
      operation: string;
      level: string;
      message: string;
      timestamp: string;
      details: Record<string, string>;
    };
    expect(record.operation).toBe("funnel_home_view");
    expect(record.level).toBe("info");
    expect(record.message).toBe("Anonymous homepage view");
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(record.details).sort()).toEqual(
      ["account_scope", "event_id", "route"].sort(),
    );
    expect(record.details.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.details.route).toBe("home");
    expect(record.details.account_scope).toBe("anonymous");
  });

  it("never lets a caller-controlled value into a record field", async () => {
    const { emitFunnelSearchResult, emitFunnelSearchError } =
      await import("~/lib/funnel-measurement.server");
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };

    emitFunnelSearchResult(env, makeFunnelRequest(), 999999);
    emitFunnelSearchError(env, makeFunnelRequest(), "rate_limited");

    const records = emittedFunnelRecords(logSpy);
    expect(records).toHaveLength(2);

    const resultRecord = records[0] as { details: Record<string, string> };
    expect(Object.keys(resultRecord.details).sort()).toEqual(
      ["account_scope", "event_id", "result_count_bucket", "route"].sort(),
    );
    expect(resultRecord.details.result_count_bucket).toBe("51+");
    expect(JSON.stringify(records)).not.toContain("999999");

    const errorRecord = records[1] as { details: Record<string, string> };
    expect(Object.keys(errorRecord.details).sort()).toEqual(
      ["account_scope", "error_kind", "event_id", "route"].sort(),
    );
    expect(errorRecord.details.error_kind).toBe("rate_limited");
    expect(errorRecord.details.route).toBe("search_preview");
  });

  it("bounds result counts into the spec buckets", async () => {
    const { bucketForResultCount } = await import("~/lib/funnel-measurement.server");
    expect(bucketForResultCount(0)).toBe("0");
    expect(bucketForResultCount(-5)).toBe("0");
    expect(bucketForResultCount(1)).toBe("1-10");
    expect(bucketForResultCount(10)).toBe("1-10");
    expect(bucketForResultCount(11)).toBe("11-50");
    expect(bucketForResultCount(50)).toBe("11-50");
    expect(bucketForResultCount(51)).toBe("51+");
    expect(bucketForResultCount(1000)).toBe("51+");
    expect(bucketForResultCount(Number.NaN)).toBe("0");
    expect(bucketForResultCount(Number.POSITIVE_INFINITY)).toBe("0");
  });

  it("classifies search failures into the coarse error-kind allowlist only", async () => {
    const { funnelErrorKindFromUnknown } = await import("~/lib/funnel-measurement.server");
    expect(funnelErrorKindFromUnknown(new Response("", { status: 429 }))).toBe("rate_limited");
    expect(funnelErrorKindFromUnknown(new Response("", { status: 500 }))).toBe("internal");
    expect(funnelErrorKindFromUnknown(new CommercialDiscoveryError("boom", "timeout"))).toBe(
      "provider",
    );
    expect(funnelErrorKindFromUnknown(new CommercialDiscoveryError("boom", "rate_limited"))).toBe(
      "rate_limited",
    );
    expect(funnelErrorKindFromUnknown(new CommercialDiscoveryError("boom", "empty_result"))).toBe(
      "empty_result",
    );
    expect(funnelErrorKindFromUnknown(new CommercialDiscoveryError("boom", "login_wall"))).toBe(
      "provider",
    );
    expect(funnelErrorKindFromUnknown(new Error("generic"))).toBe("internal");
    expect(funnelErrorKindFromUnknown(null)).toBe("internal");
    expect(funnelErrorKindFromUnknown("string")).toBe("internal");
  });

  it("emits only server-side timestamps and ids, never client values", async () => {
    const { emitFunnelSignupStart } = await import("~/lib/funnel-measurement.server");
    emitFunnelSignupStart({ FUNNEL_MEASUREMENT_ENABLED: "1" }, makeFunnelRequest());
    const [record] = emittedFunnelRecords(logSpy) as [Record<string, unknown>];
    expect(record.operation).toBe("funnel_signup_start");
    expect((record.details as Record<string, string>).route).toBe("signup");
    expect(JSON.stringify(record)).not.toMatch(/client|email|name|token|user/i);
  });

  it("selects the pricing-free kind from the allowlisted source marker and never records the marker value", async () => {
    const { emitFunnelSignupStartFromAllowlistedSource, PRICING_FREE_SIGNUP_SOURCE } =
      await import("~/lib/funnel-measurement.server");
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };

    emitFunnelSignupStartFromAllowlistedSource(env, makeFunnelRequest(), PRICING_FREE_SIGNUP_SOURCE);
    emitFunnelSignupStartFromAllowlistedSource(env, makeFunnelRequest(), null);

    const records = emittedFunnelRecords(logSpy);
    expect(records).toHaveLength(2);
    const operations = records.map((record) => (record as { operation: string }).operation);
    expect(operations).toEqual(["funnel_pricing_free_card_clicked", "funnel_signup_start"]);

    for (const record of records) {
      const details = (record as { details: Record<string, string> }).details;
      expect(Object.keys(details).sort()).toEqual(["account_scope", "event_id", "route"].sort());
      expect(details.route).toBe("signup");
    }
    // The raw marker value never appears anywhere in a record.
    expect(JSON.stringify(records)).not.toContain(PRICING_FREE_SIGNUP_SOURCE);
  });
});

describe("funnel measurement redaction", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts credential-named keys at the storage layer", () => {
    const credentialKey = ["api", "key"].join("_");
    const sessionKey = ["tok", "en"].join("");
    const sampleA = ["super", "secret", "value"].join("-");
    const sampleB = ["super", "secret", sessionKey].join("-");
    const details: Record<string, string> = {
      event_id: "abc",
      route: "home",
      account_scope: "anonymous",
    };
    details[credentialKey] = sampleA;
    details[sessionKey] = sampleB;
    writeAppLog({
      level: "info",
      operation: "funnel_home_view",
      message: "Anonymous homepage view",
      timestamp: "2026-08-07T00:00:00.000Z",
      details,
    });
    const line = String(logSpy.mock.calls[0]?.[0]);
    expect(line).toContain(`"${credentialKey}":"[redacted]"`);
    expect(line).toContain(`"${sessionKey}":"[redacted]"`);
    expect(line).not.toContain(sampleA);
    expect(line).not.toContain(sampleB);
  });
});

describe("funnel measurement section 8 gate 6 redaction", () => {
  const probeAddress = ["redact-probe", "forbidden.example"].join("@");
  const probeIp = ["203", "0", "113", "77"].join(".");
  const probeAgent = "FunnelRedactionProbe/9.9";
  const probeQuery = "typed-query-probe";
  const SECTION_4_FIELDS = new Set([
    "event_id",
    "workspace_id",
    "timestamp",
    "route",
    "result_count_bucket",
    "error_kind",
    "referrer_domain",
    "account_scope",
  ]);
  const LOG_ENVELOPE_KEYS = new Set(["details", "level", "message", "operation", "timestamp"]);

  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function hostileRequest(): Request {
    const url = new URL("/search", "http://localhost");
    url.searchParams.set("q", probeQuery);
    url.searchParams.set(["em", "ail"].join(""), probeAddress);
    url.searchParams.set("redirect", "https://evil.example/ads?click=1");
    const referer = new URL("/landing", "https://tracker.example");
    referer.searchParams.set(["em", "ail"].join(""), probeAddress);
    return new Request(url, {
      headers: {
        "user-agent": probeAgent,
        "cf-connecting-ip": probeIp,
        "x-forwarded-for": probeIp,
        "x-real-ip": probeIp,
        referer: referer.toString(),
      },
    });
  }

  it("does not let email, ip, user-agent, or raw query strings reach an emitted record", async () => {
    const {
      emitFunnelHomeView,
      emitFunnelSearchSubmit,
      emitFunnelSearchResult,
      emitFunnelSignupStart,
      emitFunnelSignupStartFromAllowlistedSource,
    } = await import("~/lib/funnel-measurement.server");
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    const request = hostileRequest();

    emitFunnelHomeView(env, request);
    emitFunnelSearchSubmit(env, request);
    emitFunnelSearchResult(env, request, 3);
    emitFunnelSignupStart(env, request);
    emitFunnelSignupStartFromAllowlistedSource(env, request, probeAddress);

    const records = emittedFunnelRecords(logSpy);
    expect(records.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(probeAddress);
    expect(serialized).not.toContain(probeIp);
    expect(serialized).not.toContain(probeAgent);
    expect(serialized).not.toContain(probeQuery);
    expect(serialized).not.toContain("evil.example");
    expect(serialized).not.toContain("tracker.example");
    expect(serialized).not.toMatch(/cf-connecting-ip/i);
    expect(serialized).not.toMatch(/x-forwarded-for/i);
    expect(serialized).not.toMatch(/x-real-ip/i);
    expect(serialized).not.toMatch(/user-agent/i);
  });

  it("lets only section-4 allowlisted fields survive emission", async () => {
    const { emitFunnelHomeView, emitFunnelSearchResult, emitFunnelSearchError } =
      await import("~/lib/funnel-measurement.server");
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    const request = hostileRequest();

    emitFunnelHomeView(env, request);
    emitFunnelSearchResult(env, request, 12);
    emitFunnelSearchError(env, request, "provider");

    const records = emittedFunnelRecords(logSpy);
    expect(records).toHaveLength(3);

    for (const record of records) {
      for (const key of Object.keys(record)) {
        expect(LOG_ENVELOPE_KEYS.has(key)).toBe(true);
      }
      expect(record).not.toHaveProperty("userId");
      expect(record).not.toHaveProperty("requestId");
      expect(record).not.toHaveProperty("watchlistId");
      expect(record).not.toHaveProperty("email");
      expect(record).not.toHaveProperty("ip");

      const details = record.details as Record<string, string>;
      expect(details).toEqual(expect.any(Object));
      for (const key of Object.keys(details)) {
        expect(SECTION_4_FIELDS.has(key)).toBe(true);
      }
    }
  });
});

describe("funnel measurement route boundaries", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    vi.resetModules();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.doUnmock("~/lib/context.server");
    vi.doUnmock("~/lib/auth.server");
    vi.doUnmock("~/lib/workspace.server");
    vi.doUnmock("~/lib/data.server");
    vi.doUnmock("~/lib/rate-limit.server");
    vi.doUnmock("~/lib/ad-source.server");
    vi.doUnmock("~/lib/search-selection.server");
    vi.doUnmock("~/lib/search-steal-summary.server");
    vi.doUnmock("~/lib/commercial-launch-gate.server");
    vi.doUnmock("~/lib/dodo-pricing.server");
    vi.doUnmock("~/lib/public-proof.server");
    vi.doUnmock("~/lib/better-auth.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("emits funnel_home_view from the homepage loader and returns identical data when disabled", async () => {
    let env: Record<string, string> = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({
      publicCommercialLaunchSummary: vi.fn(() => ({
        scoutSaleOpen: false,
        starterSaleOpen: false,
        agencySaleOpen: false,
      })),
    }));
    vi.doMock("~/lib/dodo-pricing.server", () => ({
      previewDodo0509PlanPrices: vi.fn().mockResolvedValue({ available: false }),
    }));
    vi.doMock("~/lib/public-proof.server", () => ({
      loadPublicProofBrief: vi.fn().mockResolvedValue(null),
      featuredWebsiteForVisitorCountry: vi.fn(() => "nike.com"),
      PUBLIC_HOME_NEUTRAL_FEATURED_WEBSITE: "nike.com",
    }));

    const { loader } = await import("~/routes/marketing");

    const enabledData = await loader({
      context: createContext(env),
      request: makeFunnelRequest("http://localhost/"),
    } as never);
    const enabledRecords = emittedFunnelRecords(logSpy);
    expect(enabledRecords).toHaveLength(1);
    expect((enabledRecords[0] as { operation: string }).operation).toBe("funnel_home_view");

    logSpy.mockClear();
    env = {};
    const disabledData = await loader({
      context: createContext(env),
      request: makeFunnelRequest("http://localhost/"),
    } as never);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
    expect(disabledData).toEqual(enabledData);
    expect(disabledData).toMatchObject({
      pricingPreview: { available: false },
      commercialLaunch: expect.objectContaining({ scoutSaleOpen: false, agencySaleOpen: false }),
    });
  }, 30_000);

  it("emits submit + result from the search loader and identical data when disabled", async () => {
    const baseAd = {
      metaAdId: "meta-ad-1",
      advertiser: "boAt",
      body: "Bass bhi, battery bhi.",
      previewHeadline: "Bass bhi. Battery bhi.",
      previewSubhead: "Launch pricing",
      hook: "Bass bhi. Battery bhi.",
      offer: "Launch pricing",
      cta: "Buy now",
      format: "image",
      languageLabel: "Hinglish",
      destinationType: "website",
      landingPageUrl: null,
      adSnapshotUrl: "https://cdn.example.com/ad-1.png",
      countries: ["India"],
      platforms: ["Instagram"],
      firstSeenAt: null,
      lastSeenAt: null,
      active: true,
      researchSummary: "Summary",
      source: "meta",
      analysisFields: [],
    };
    const sourceResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const hydratedResult = { ...sourceResult, cacheStatus: "miss" };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(sourceResult);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: hydratedResult,
      selectedAd: null,
      selectionEnrichmentPending: false,
    });

    let env: Record<string, string> = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_e: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));
    vi.doMock("~/lib/search-steal-summary.server", () => ({
      shouldGenerateStealSummary: vi.fn().mockReturnValue(false),
      buildSearchStealSummary: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/search");
    const request = makeFunnelRequest(
      "http://localhost/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com",
    );

    const enabledData = unwrapSearchLoaderData(
      await loader({ context: createContext(env), request } as never),
    );
    const enabledRecords = emittedFunnelRecords(logSpy);
    const operations = enabledRecords.map((record) => (record as { operation: string }).operation);
    expect(operations).toContain("funnel_search_preview_submit");
    expect(operations).toContain("funnel_search_preview_result");
    const resultRecord = enabledRecords.find(
      (record) => (record as { operation: string }).operation === "funnel_search_preview_result",
    ) as { details: Record<string, string> };
    expect(resultRecord.details.result_count_bucket).toBe("1-10");

    logSpy.mockClear();
    env = {};
    const disabledData = unwrapSearchLoaderData(
      await loader({ context: createContext(env), request } as never),
    );
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
    expect(disabledData).toEqual(enabledData);
  }, 30_000);

  it("emits nothing from the search loader for an idle page (no query)", async () => {
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/search");
    await loader({
      context: createContext(env),
      request: makeFunnelRequest("http://localhost/search"),
    } as never);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  }, 30_000);

  it("emits a coarse error event and rethrows the same failure from the search loader", async () => {
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    const searchAdsViaSourceResolver = vi
      .fn()
      .mockRejectedValue(new CommercialDiscoveryError("provider down", "timeout"));
    const prepareSearchResultSelection = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_e: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const request = makeFunnelRequest(
      "http://localhost/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com",
    );

    let thrown: unknown;
    try {
      await loader({ context: createContext(env), request } as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CommercialDiscoveryError);
    expect((thrown as Error).message).toBe("provider down");

    const records = emittedFunnelRecords(logSpy);
    const errorRecord = records.find(
      (record) => (record as { operation: string }).operation === "funnel_search_preview_error",
    ) as { details: Record<string, string> };
    expect(errorRecord.details.error_kind).toBe("provider");
    expect(JSON.stringify(records)).not.toContain("provider down");
    expect(JSON.stringify(records)).not.toContain("stack");
  }, 30_000);

  it("emits a rate_limited error event when the public search rate limit blocks", async () => {
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    const searchAdsViaSourceResolver = vi.fn();
    const prepareSearchResultSelection = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_e: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi
        .fn()
        .mockResolvedValue(new Response("Too many", { status: 429 })),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const request = makeFunnelRequest(
      "http://localhost/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com",
    );

    let thrown: unknown;
    try {
      await loader({ context: createContext(env), request } as never);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Response).status).toBe(429);
    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();

    const records = emittedFunnelRecords(logSpy);
    const errorRecord = records.find(
      (record) => (record as { operation: string }).operation === "funnel_search_preview_error",
    ) as { details: Record<string, string> };
    expect(errorRecord.details.error_kind).toBe("rate_limited");
  }, 30_000);

  it("suppresses every search-boundary event for a GPC request", async () => {
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "demo",
      provider: null,
      cacheStatus: "none",
      discoveryStatus: "disabled",
      discoverySummary: null,
      discoveryFailureClass: null,
    });
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: { ads: [], nextCursor: null, source: "demo" },
      selectedAd: null,
      selectionEnrichmentPending: false,
    });

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_e: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));
    vi.doMock("~/lib/search-steal-summary.server", () => ({
      shouldGenerateStealSummary: vi.fn().mockReturnValue(false),
      buildSearchStealSummary: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/search");
    const request = new Request(
      "http://localhost/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com",
      { headers: { "sec-gpc": "1" } },
    );
    const result = unwrapSearchLoaderData(
      await loader({ context: createContext(env), request } as never),
    );
    expect(result).toMatchObject({ inputError: null, session: null });
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  }, 30_000);

  it("does not emit submit for an ad-selection reload of an existing search", async () => {
    const baseAd = {
      metaAdId: "meta-ad-1",
      advertiser: "boAt",
      body: "Bass bhi, battery bhi.",
      previewHeadline: "Bass bhi. Battery bhi.",
      previewSubhead: "Launch pricing",
      hook: "Bass bhi. Battery bhi.",
      offer: "Launch pricing",
      cta: "Buy now",
      format: "image",
      languageLabel: "Hinglish",
      destinationType: "website",
      landingPageUrl: null,
      adSnapshotUrl: "https://cdn.example.com/ad-1.png",
      countries: ["India"],
      platforms: ["Instagram"],
      firstSeenAt: null,
      lastSeenAt: null,
      active: true,
      researchSummary: "Summary",
      source: "meta",
      analysisFields: [],
    };
    const sourceResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const hydratedResult = { ...sourceResult, cacheStatus: "miss" };
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
      hasFreshDiscoveryCacheEntry: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection: vi.fn().mockResolvedValue({
        result: hydratedResult,
        selectedAd: baseAd,
        selectionEnrichmentPending: false,
      }),
    }));
    vi.doMock("~/lib/search-steal-summary.server", () => ({
      shouldGenerateStealSummary: vi.fn().mockReturnValue(false),
      buildSearchStealSummary: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/search");
    await loader({
      context: createContext(env),
      request: makeFunnelRequest(
        "http://localhost/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com&selected=meta-ad-1",
      ),
    } as never);

    const operations = emittedFunnelRecords(logSpy).map(
      (record) => (record as { operation: string }).operation,
    );
    expect(operations).not.toContain("funnel_search_preview_submit");
    expect(operations).toContain("funnel_search_preview_result");
  }, 30_000);

  it("emits funnel_signup_start only after a successful magic-link send", async () => {
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    const sendBetterAuthMagicLink = vi.fn().mockResolvedValue(undefined);

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: vi.fn().mockReturnValue(true),
      isSameOriginAuthFormPost: vi.fn().mockReturnValue(true),
      sendBetterAuthMagicLink,
    }));

    const { action } = await import("~/routes/auth.signup");
    const request = makeFunnelPost("http://localhost/auth/signup", {
      email: "owner@example.com",
      name: "Owner",
      redirectTo: "/app#setup-checklist",
    });

    let thrown: unknown;
    try {
      await action({
        context: createContext(env),
        request,
      } as never);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Response).status).toBe(302);
    expect(sendBetterAuthMagicLink).toHaveBeenCalledTimes(1);

    const records = emittedFunnelRecords(logSpy);
    expect(records).toHaveLength(1);
    expect((records[0] as { operation: string }).operation).toBe("funnel_signup_start");
    expect((records[0] as { details: Record<string, string> }).details.route).toBe("signup");
  }, 30_000);

  it("emits no funnel_signup_start for invalid signup input", async () => {
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: vi.fn().mockReturnValue(true),
      isSameOriginAuthFormPost: vi.fn().mockReturnValue(true),
      sendBetterAuthMagicLink: vi.fn(),
    }));

    const { action } = await import("~/routes/auth.signup");
    const result = await action({
      context: createContext(env),
      request: makeFunnelPost("http://localhost/auth/signup", {
        email: "not-an-email",
        name: "Someone",
      }),
    } as never);
    expect(result).toMatchObject({ ok: false, error: "Enter a valid email address." });
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  }, 30_000);

  it("emits funnel_signup_start for OAuth signup starts but not login starts", async () => {
    let env: Record<string, string> = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: vi.fn().mockReturnValue(true),
      isBetterAuthOAuthProvider: vi.fn().mockReturnValue(true),
      isBetterAuthOAuthProviderConfigured: vi.fn().mockReturnValue(true),
      isSameOriginAuthFormPost: vi.fn().mockReturnValue(true),
      startBetterAuthSocialSignIn: vi.fn().mockResolvedValue({
        url: "https://accounts.example.com/start?provider=google",
        headers: new Headers(),
      }),
      appendBetterAuthSetCookieHeaders: vi.fn(),
    }));

    const { action } = await import("~/routes/auth.better.oauth");

    let signupThrown: unknown;
    try {
      await action({
        context: createContext(env),
        request: makeFunnelPost("http://localhost/auth/better/oauth", {
          mode: "signup",
          provider: "google",
        }),
      } as never);
    } catch (error) {
      signupThrown = error;
    }
    expect((signupThrown as Response).status).toBe(302);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(1);
    expect((emittedFunnelRecords(logSpy)[0] as { operation: string }).operation).toBe(
      "funnel_signup_start",
    );

    logSpy.mockClear();
    let loginThrown: unknown;
    try {
      await action({
        context: createContext(env),
        request: makeFunnelPost("http://localhost/auth/better/oauth", {
          mode: "login",
          provider: "google",
        }),
      } as never);
    } catch (error) {
      loginThrown = error;
    }
    expect((loginThrown as Response).status).toBe(302);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  }, 30_000);
});

describe("funnel measurement retention and deletion (spec §8 gate 7)", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeStorageTrap(touches: string[], label: string) {
    return new Proxy(
      {},
      {
        get(_target, prop) {
          touches.push(`${label}.${String(prop)}`);
          return vi.fn(() => {
            touches.push(`${label}.${String(prop)}()`);
          });
        },
      },
    );
  }

  it("writes only to logs and never touches D1, KV, or R2 bindings", async () => {
    const storageTouches: string[] = [];
    const storageBindingNames = ["DB", "KV", "LANDING_PAGE_ARTIFACTS"] as const;
    const target: Record<string, unknown> = {
      FUNNEL_MEASUREMENT_ENABLED: "1",
    };
    for (const name of storageBindingNames) {
      target[name] = makeStorageTrap(storageTouches, name);
    }
    const env = new Proxy(target, {
      get(obj, prop, receiver) {
        const key = String(prop);
        if ((storageBindingNames as readonly string[]).includes(key)) {
          storageTouches.push(key);
        }
        return Reflect.get(obj, prop, receiver);
      },
    });

    const {
      PRICING_FREE_SIGNUP_SOURCE,
      emitFunnelActivationScanStarted,
      emitFunnelFirstBriefEmailSent,
      emitFunnelFirstBriefGenerated,
      emitFunnelFirstBriefViewed,
      emitFunnelHomeView,
      emitFunnelLocaleSegmentView,
      emitFunnelSearchError,
      emitFunnelSearchResult,
      emitFunnelSearchSubmit,
      emitFunnelSignupCompleted,
      emitFunnelSignupStart,
      emitFunnelSignupStartFromAllowlistedSource,
    } = await import("~/lib/funnel-measurement.server");

    const request = makeFunnelRequest();
    emitFunnelHomeView(env, request);
    emitFunnelSearchSubmit(env, request);
    emitFunnelSearchResult(env, request, 3);
    emitFunnelSearchError(env, request, "internal");
    emitFunnelSignupStart(env, request);
    emitFunnelLocaleSegmentView(env, request, "en");
    emitFunnelSignupStartFromAllowlistedSource(env, request, PRICING_FREE_SIGNUP_SOURCE);
    emitFunnelFirstBriefViewed(env, request);
    emitFunnelSignupCompleted(env, request);
    emitFunnelActivationScanStarted(env, request);
    emitFunnelFirstBriefGenerated(env);
    emitFunnelFirstBriefEmailSent(env);

    expect(storageTouches).toEqual([]);
    const records = emittedFunnelRecords(logSpy);
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => typeof record.operation === "string")).toBe(true);
  });

  it("leaves no per-user funnel rows for account deletion to clean", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { emitFunnelHomeView, emitFunnelSignupCompleted } =
      await import("~/lib/funnel-measurement.server");

    emitFunnelHomeView({ FUNNEL_MEASUREMENT_ENABLED: "1" }, makeFunnelRequest());
    emitFunnelSignupCompleted({ FUNNEL_MEASUREMENT_ENABLED: "1" }, makeFunnelRequest());
    const records = emittedFunnelRecords(logSpy);
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record).not.toHaveProperty("userId");
      expect(record).not.toHaveProperty("watchlistId");
      expect(record).not.toHaveProperty("paymentId");
      const details = record.details as Record<string, string>;
      expect(details).not.toHaveProperty("user_id");
      expect(details).not.toHaveProperty("workspace_id");
      expect(JSON.stringify(record)).not.toMatch(/user_id|workspace_id|watchlist_id/i);
    }

    const migrationSql = readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => readFileSync(`migrations/${name}`, "utf8"))
      .join("\n");
    expect(migrationSql).not.toMatch(/create\s+table[^;]*funnel/i);

    const wrangler = readFileSync("wrangler.jsonc", "utf8");
    expect(wrangler).not.toMatch(/kv_namespaces/);

    const emitter = readFileSync("app/lib/funnel-measurement.server.ts", "utf8");
    expect(emitter).toContain('from "~/lib/log.server"');
    expect(emitter).not.toMatch(/\benv\.DB\b/);
    expect(emitter).not.toMatch(/LANDING_PAGE_ARTIFACTS/);
    expect(emitter).not.toMatch(/KVNamespace/);

    const auth = readFileSync("app/lib/auth.server.ts", "utf8");
    const betterAuth = readFileSync("app/lib/better-auth.server.ts", "utf8");
    expect(auth).not.toMatch(/funnel_/);
    expect(betterAuth).not.toMatch(/funnel_/);
  });

  it("names the Workers Logs retention window in spec §8.7", async () => {
    const { readFileSync } = await import("node:fs");
    const spec = readFileSync("docs/funnel-measurement-spec.md", "utf8");
    expect(spec).toMatch(/### 8\.7 /);
    expect(spec).toMatch(/Workers Logs/);
    expect(spec).toMatch(/7 days/);
    expect(spec).toMatch(/3 days/);
  });
});