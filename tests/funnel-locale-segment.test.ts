import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

const LOCALE_FUNNEL_OPERATIONS = [
  "funnel_signup_start",
  "funnel_signup_start_magicbrief",
  "funnel_signup_start_locale_en",
  "funnel_signup_start_locale_de",
  "funnel_signup_start_locale_ja",
  "funnel_signup_start_locale_pt_br",
  "funnel_locale_segment_view_en",
  "funnel_locale_segment_view_de",
  "funnel_locale_segment_view_ja",
  "funnel_locale_segment_view_pt_br",
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
        LOCALE_FUNNEL_OPERATIONS.includes(String((record as { operation?: unknown }).operation)),
    );
}

describe("funnel measurement locale sneaker-resale events", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("selects locale view and signup kinds from allowlisted ids and never stores the marker", async () => {
    const {
      emitFunnelLocaleSegmentView,
      emitFunnelSignupStartFromAllowlistedSource,
    } = await import("~/lib/funnel-measurement.server");
    const { sneakerResaleMarket } = await import("~/lib/locale-markets");
    const env = { FUNNEL_MEASUREMENT_ENABLED: "1" };
    const deMarker = sneakerResaleMarket("de").signupSource;
    const hostile = `http://localhost/auth/signup?source=${deMarker}&x=%3Cscript%3Ealert(1)%3C/script%3E`;

    emitFunnelLocaleSegmentView(env, new Request("http://localhost/de/sneaker-resale"), "de");
    emitFunnelSignupStartFromAllowlistedSource(env, new Request(hostile), deMarker);
    emitFunnelSignupStartFromAllowlistedSource(env, new Request(hostile), "not-a-marker");
    emitFunnelSignupStartFromAllowlistedSource(
      env,
      new Request("http://localhost/auth/signup?source=magicbrief-migration"),
      "magicbrief-migration",
    );

    const records = emittedFunnelRecords(logSpy);
    const operations = records.map((record) => (record as { operation: string }).operation);
    expect(operations).toEqual([
      "funnel_locale_segment_view_de",
      "funnel_signup_start_locale_de",
      "funnel_signup_start",
      "funnel_signup_start_magicbrief",
    ]);

    for (const record of records) {
      const details = (record as { details: Record<string, string> }).details;
      expect(Object.keys(details).sort()).toEqual(["account_scope", "event_id", "route"].sort());
      expect(details.account_scope).toBe("anonymous");
    }
    expect(records[0]).toMatchObject({
      details: expect.objectContaining({ route: "sneaker_resale" }),
    });
    expect(JSON.stringify(records)).not.toContain(deMarker);
    expect(JSON.stringify(records)).not.toContain("script");
    expect(JSON.stringify(records)).not.toContain("/de/sneaker-resale");
  });

  it("suppresses locale events when the gate is off or GPC is set", async () => {
    const { emitFunnelLocaleSegmentView, emitFunnelSignupStartFromAllowlistedSource } =
      await import("~/lib/funnel-measurement.server");
    const { sneakerResaleMarket } = await import("~/lib/locale-markets");

    emitFunnelLocaleSegmentView({}, new Request("http://localhost/ja/sneaker-resale"), "ja");
    emitFunnelSignupStartFromAllowlistedSource(
      {},
      new Request("http://localhost/auth/signup"),
      sneakerResaleMarket("ja").signupSource,
    );
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);

    const gpc = new Request("http://localhost/ja/sneaker-resale", { headers: { "sec-gpc": "1" } });
    emitFunnelLocaleSegmentView({ FUNNEL_MEASUREMENT_ENABLED: "1" }, gpc, "ja");
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  });
});
