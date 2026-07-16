import { describe, expect, it } from "vitest";

import {
  CORE_WEB_VITAL_BUDGETS,
  evaluateCoreWebVitals,
  evaluateFirstProofClock,
  evaluateP75,
} from "~/lib/performance-measurement.server";

describe("performance measurement evaluators", () => {
  describe("p75", () => {
    it("sorts finite samples and uses deterministic nearest-rank p75", () => {
      expect(evaluateP75([4, 1, 3, 2])).toMatchObject({
        ok: true,
        status: "pass",
        p75: 3,
        sampleCount: 4,
        reason: null,
      });
    });

    it("handles boundary-sized samples without interpolation", () => {
      expect(evaluateP75([0])).toMatchObject({ ok: true, p75: 0, sampleCount: 1 });
      expect(evaluateP75([0, 10])).toMatchObject({ ok: true, p75: 10, sampleCount: 2 });
      expect(evaluateP75([0, 10, 20])).toMatchObject({ ok: true, p75: 20, sampleCount: 3 });
    });

    it("fails closed for empty, negative, NaN, infinite, or nonnumeric samples", () => {
      for (const samples of [
        [],
        [-1, 2],
        [Number.NaN, 2],
        [Number.POSITIVE_INFINITY],
        ["2", 3],
      ]) {
        expect(evaluateP75(samples)).toMatchObject({
          ok: false,
          status: "fail",
          p75: null,
        });
      }
    });
  });

  describe("Core Web Vitals", () => {
    it("accepts exact budget boundaries", () => {
      const result = evaluateCoreWebVitals(CORE_WEB_VITAL_BUDGETS);
      expect(result).toMatchObject({
        ok: true,
        status: "pass",
        failures: [],
        metrics: CORE_WEB_VITAL_BUDGETS,
      });
    });

    it("rejects missing and invalid evidence instead of treating it as zero", () => {
      const result = evaluateCoreWebVitals({ lcpMs: undefined, inpMs: -1, cls: Number.NaN });
      expect(result.ok).toBe(false);
      expect(result.failures).toEqual(["lcp_missing", "inp_invalid", "cls_invalid"]);
      expect(result.metrics).toEqual({ lcpMs: null, inpMs: null, cls: null });
    });

    it("rejects measurements above the stated budgets", () => {
      const result = evaluateCoreWebVitals({ lcpMs: 2_501, inpMs: 201, cls: 0.100_001 });
      expect(result).toMatchObject({
        ok: false,
        status: "fail",
        failures: ["lcp_budget_exceeded", "inp_budget_exceeded", "cls_budget_exceeded"],
      });
    });
  });

  describe("first-proof clocks", () => {
    it("returns separate configure, queue, execution, and end-to-end durations", () => {
      const result = evaluateFirstProofClock({
        createdAt: "2026-07-16T10:00:00.000Z",
        queuedAt: "2026-07-16T10:00:05.000Z",
        processingStartedAt: "2026-07-16T10:00:20.000Z",
        finishedAt: "2026-07-16T10:01:00.000Z",
        proofSucceededAt: "2026-07-16T10:01:02.000Z",
      });

      expect(result).toEqual({
        ok: true,
        status: "pass",
        failures: [],
        durations: {
          configureToQueueMs: 5_000,
          queueWaitMs: 15_000,
          executionMs: 40_000,
          configureToProofMs: 62_000,
        },
      });
    });

    it("fails closed for missing or malformed authoritative timestamps", () => {
      const result = evaluateFirstProofClock({
        createdAt: "2026-07-16T10:00:00.000Z",
        queuedAt: null,
        processingStartedAt: "not-a-date",
        finishedAt: "2026-07-16T10:01:00.000Z",
        proofSucceededAt: undefined,
      });

      expect(result.ok).toBe(false);
      expect(result.failures).toEqual([
        "queued_at_missing",
        "processing_started_at_invalid",
        "proof_succeeded_at_missing",
      ]);
      expect(result.durations).toEqual({
        configureToQueueMs: null,
        queueWaitMs: null,
        executionMs: null,
        configureToProofMs: null,
      });
    });

    it("rejects nonmonotonic stage transitions", () => {
      const result = evaluateFirstProofClock({
        createdAt: "2026-07-16T10:00:10.000Z",
        queuedAt: "2026-07-16T10:00:05.000Z",
        processingStartedAt: "2026-07-16T10:00:20.000Z",
        finishedAt: "2026-07-16T10:01:00.000Z",
        proofSucceededAt: "2026-07-16T10:01:02.000Z",
      });

      expect(result).toMatchObject({
        ok: false,
        status: "fail",
        failures: ["timestamps_nonmonotonic"],
      });
    });

    it("does not project raw timestamps or sensitive identifiers", () => {
      const result = evaluateFirstProofClock({
        createdAt: "2026-07-16T10:00:00.000Z",
        queuedAt: "2026-07-16T10:00:01.000Z",
        processingStartedAt: "2026-07-16T10:00:02.000Z",
        finishedAt: "2026-07-16T10:00:03.000Z",
        proofSucceededAt: "2026-07-16T10:00:04.000Z",
      });

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("2026-07-16T10:00:00.000Z");
      expect(serialized).not.toContain("userId");
      expect(serialized).not.toContain("watchlistId");
      expect(serialized).not.toContain("token");
    });
  });
});
