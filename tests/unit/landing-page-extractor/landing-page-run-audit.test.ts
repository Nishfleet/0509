import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import {
  createLpRunAuditContext,
  emitLpRunAudit,
  runLpRunAuditStage,
  runLpRunAuditStageAsync,
} from "~/lib/landing-page-run-audit.server";
import { extractLandingPageSignals as realExtractLandingPageSignals } from "~/lib/landing-page-signals.server";

const TEST_CONTEXT = createLpRunAuditContext({
  watchlistId: "watch-123",
  runId: "run-abc",
  domain: "example.com",
});

describe("landing-page-run-audit (issue #1500)", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("emits one structured JSON line per call with tag=lp_run_audit", () => {
    emitLpRunAudit({
      context: TEST_CONTEXT,
      stage: "cta_extract",
      outcome: "ok",
      bytesIn: 1024,
      bytesOut: 96,
      ms: 12,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.tag).toBe("lp_run_audit");
    expect(logged.watchlist_id).toBe("watch-123");
    expect(logged.run_id).toBe("run-abc");
    expect(logged.domain).toBe("example.com");
    expect(logged.stage).toBe("cta_extract");
    expect(logged.outcome).toBe("ok");
    expect(logged.bytes_in).toBe(1024);
    expect(logged.bytes_out).toBe(96);
    expect(logged.ms).toBe(12);
  });

  it("serialises bailed:<reason> outcomes with the colon intact", () => {
    emitLpRunAudit({
      context: TEST_CONTEXT,
      stage: "html_fetch",
      outcome: "bailed:landing_rate_limited",
      bytesIn: 0,
      bytesOut: 0,
      ms: 5,
    });

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.outcome).toBe("bailed:landing_rate_limited");
    expect(logged.stage).toBe("html_fetch");
  });

  it("never throws when the audit fields are pathological (NaN bytes, undefined outcome)", () => {
    // A pathological payload: NaN bytes and an undefined outcome. The module
    // contract is to swallow serialisation failures — the audit stream must
    // never throw into the scan path. JSON.stringify of NaN produces `null`
    // and undefined is dropped from the JSON output; both are still safe.
    expect(() =>
      emitLpRunAudit({
        context: TEST_CONTEXT,
        stage: "html_parse",
        outcome: "ok",
        bytesIn: Number.NaN,
        bytesOut: Number.NaN,
        ms: 0,
      }),
    ).not.toThrow();
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("does not call console.log when emit throws internally", () => {
    // Forcing console.log to throw simulates a logging-path failure.
    logSpy.mockImplementation(() => {
      throw new Error("logging offline");
    });

    expect(() =>
      emitLpRunAudit({
        context: TEST_CONTEXT,
        stage: "url_extract",
        outcome: "ok",
        bytesIn: 0,
        bytesOut: 0,
        ms: 0,
      }),
    ).not.toThrow();
  });

  it("runLpRunAuditStage records ok when bailReasonFor returns null", () => {
    const result = runLpRunAuditStage({
      context: TEST_CONTEXT,
      stage: "anchor_resolve",
      bytesIn: 4096,
      bailReasonFor: (anchors: string[]) => (anchors.length === 0 ? "no_anchors" : null),
      fn: () => ["Buy now", "Read more"],
    });

    expect(result).toEqual(["Buy now", "Read more"]);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.stage).toBe("anchor_resolve");
    expect(logged.outcome).toBe("ok");
    expect(logged.bytes_in).toBe(4096);
    expect(logged.bytes_out).toBeGreaterThan(0);
  });

  it("runLpRunAuditStage records bailed:<reason> when bailReasonFor returns a string", () => {
    runLpRunAuditStage({
      context: TEST_CONTEXT,
      stage: "anchor_resolve",
      bytesIn: 1024,
      bailReasonFor: (anchors: string[]) => (anchors.length === 0 ? "no_anchors" : null),
      fn: () => [] as string[],
    });

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.outcome).toBe("bailed:no_anchors");
  });

  it("runLpRunAuditStage uses the explicit bytesOutFor when provided", () => {
    runLpRunAuditStage({
      context: TEST_CONTEXT,
      stage: "cta_extract",
      bytesIn: 1024,
      bytesOutFor: () => 42,
      bailReasonFor: () => null,
      fn: () => "Buy now",
    });

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.bytes_out).toBe(42);
  });

  it("runLpRunAuditStageAsync awaits the stage fn and emits one line", async () => {
    const result = await runLpRunAuditStageAsync({
      context: TEST_CONTEXT,
      stage: "html_fetch",
      bytesIn: 0,
      bailReasonFor: (value: { html: string | null }) =>
        value.html === null ? "empty_after_strip" : null,
      fn: async () => ({ html: "<title>OK</title>" }),
    });

    expect(result.html).toBe("<title>OK</title>");
    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.stage).toBe("html_fetch");
    expect(logged.outcome).toBe("ok");
  });

  it("emits one line per stage transition for the eight documented stages", () => {
    const stages = [
      "html_fetch",
      "html_parse",
      "anchor_resolve",
      "cta_extract",
      "headline_extract",
      "price_extract",
      "form_extract",
      "url_extract",
    ] as const;

    for (const stage of stages) {
      emitLpRunAudit({
        context: TEST_CONTEXT,
        stage,
        outcome: "ok",
        bytesIn: 0,
        bytesOut: 0,
        ms: 1,
      });
    }

    expect(logSpy).toHaveBeenCalledTimes(stages.length);
    for (let i = 0; i < stages.length; i += 1) {
      const logged = JSON.parse(logSpy.mock.calls[i][0] as string) as Record<string, unknown>;
      expect(logged.stage).toBe(stages[i]);
    }
  });
});

describe("landing-page-run-audit wired into extractLandingPageSignals (issue #1500)", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("emits html_parse, anchor_resolve, cta_extract, price_extract, form_extract when audit is present", () => {
    const html = `
      <html>
        <head><title>Glow Serum Sale</title></head>
        <body>
          <a href="/shop">Buy now</a>
          <button>Add to cart</button>
          <span>$49.99</span>
          <form><input type="email" /><button type="submit">Submit</button></form>
        </body>
      </html>
    `;

    realExtractLandingPageSignals(html, { audit: TEST_CONTEXT });

    const stages = logSpy.mock.calls.map((call) => {
      const logged = JSON.parse(call[0] as string) as Record<string, unknown>;
      return logged.stage;
    });

    expect(stages).toContain("html_parse");
    expect(stages).toContain("anchor_resolve");
    expect(stages).toContain("cta_extract");
    expect(stages).toContain("price_extract");
    expect(stages).toContain("form_extract");
    // The extractor never owns html_fetch / headline_extract / url_extract —
    // those stages are emitted by the capture path. They must not appear here.
    expect(stages).not.toContain("html_fetch");
    expect(stages).not.toContain("headline_extract");
    expect(stages).not.toContain("url_extract");
  });

  it("stays silent when audit is null (existing call sites unchanged)", () => {
    realExtractLandingPageSignals("<title>OK</title>");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("stays silent when audit is explicitly undefined (existing call sites unchanged)", () => {
    realExtractLandingPageSignals("<title>OK</title>", { documentMode: "raw" });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("records cta_extract as bailed:<reason> on a no-CTA page", () => {
    realExtractLandingPageSignals(
      `<html><head><title>About</title></head><body><nav><a href="/about">About</a></nav><p>Just some text.</p></body></html>`,
      { audit: TEST_CONTEXT },
    );

    const stages = logSpy.mock.calls.map((call) => {
      const logged = JSON.parse(call[0] as string) as Record<string, unknown>;
      return logged;
    });
    const cta = stages.find((row) => row.stage === "cta_extract");
    expect(cta?.outcome).toMatch(/^bailed:/);
  });

  it("records form_extract as ok on a page with a lead input + submit", () => {
    realExtractLandingPageSignals(
      `<html><body><form><input type="email" name="email" /><button type="submit">Send</button></form></body></html>`,
      { audit: TEST_CONTEXT },
    );
    const stages = logSpy.mock.calls.map((call) => {
      const logged = JSON.parse(call[0] as string) as Record<string, unknown>;
      return logged;
    });
    const form = stages.find((row) => row.stage === "form_extract");
    expect(form?.outcome).toBe("ok");
  });

  it("records form_extract as bailed:no_lead_input on a no-input page", () => {
    realExtractLandingPageSignals(
      `<html><body><p>Just text, no form at all.</p></body></html>`,
      { audit: TEST_CONTEXT },
    );
    const stages = logSpy.mock.calls.map((call) => {
      const logged = JSON.parse(call[0] as string) as Record<string, unknown>;
      return logged;
    });
    const form = stages.find((row) => row.stage === "form_extract");
    expect(form?.outcome).toBe("bailed:no_lead_input");
  });

  it("records price_extract as bailed:no_price_pattern when no price-shaped text exists", () => {
    realExtractLandingPageSignals(
      `<html><body><p>Pricing: please contact us for a quote.</p></body></html>`,
      { audit: TEST_CONTEXT },
    );
    const stages = logSpy.mock.calls.map((call) => {
      const logged = JSON.parse(call[0] as string) as Record<string, unknown>;
      return logged;
    });
    const price = stages.find((row) => row.stage === "price_extract");
    expect(price?.outcome).toBe("bailed:no_price_pattern");
  });

  it("records anchor_resolve as bailed:no_anchors on an anchor-free page", () => {
    realExtractLandingPageSignals(
      `<html><body><p>No anchors here, just text and a <button>Buy now</button>.</p></body></html>`,
      { audit: TEST_CONTEXT },
    );
    const stages = logSpy.mock.calls.map((call) => {
      const logged = JSON.parse(call[0] as string) as Record<string, unknown>;
      return logged;
    });
    const anchor = stages.find((row) => row.stage === "anchor_resolve");
    expect(anchor?.outcome).toBe("bailed:no_anchors");
  });
});

/**
 * Local helper that mirrors the utf8ByteLength the extractor uses. Kept
 * here so the audit-module tests do not depend on any internal helper.
 */
function utf8ByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
