import { describe, expect, it } from "vitest";

import {
  SCAN_SOURCE_BUDGET_MS,
  summarizeScanProgress,
  withScanSourceBudget,
  type ScanSourceProgressMap,
} from "~/lib/scan-source-progress.server";

/**
 * Issue #3176 — the activation fan-out's pure progress mechanics.
 *
 * The per-source budget race and the progress summarizer are the two
 * contract pieces everything else builds on: a hung source must lose the
 * race (the "a source timing out never blocks the brief" acceptance) and the
 * summary must count only terminal states as done. The D1 truths — tick
 * roundtrip, finisher preservation, the late-append path — are covered by
 * tests/integration/signup-scan-progress.integration.test.ts on real
 * migrations.
 */

function entry(
  status: ScanSourceProgressMap[string]["status"],
  overrides: Partial<ScanSourceProgressMap[string]> = {},
): ScanSourceProgressMap[string] {
  return {
    kind: "ad_library",
    label: "Label",
    status,
    detail: null,
    updatedAt: "2026-09-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("withScanSourceBudget (#3176 per-source budgets)", () => {
  it("passes a completing source's value through untouched", async () => {
    const raced = await withScanSourceBudget(
      Promise.resolve("capture-result"),
      5_000,
    );
    expect(raced).toEqual({ outcome: "completed", value: "capture-result" });
  });

  it("times a hung source out at its budget — the loser never blocks the caller", async () => {
    // A source whose promise never settles (the workerd "hung capture" shape).
    const loser = new Promise<string>(() => {});
    // Keep the loser's (never-observed) eventual settlement from surfacing as
    // an unhandled rejection in the test process.
    loser.catch(() => {});
    const startedAt = Date.now();
    const raced = await withScanSourceBudget(loser, 10);
    expect(raced).toEqual({ outcome: "timed_out" });
    // Well inside the runner's own timeout: the race returns at the budget,
    // not at some lease-long deadline.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("propagates the winner's rejection so the caller's catch still runs", async () => {
    const failure = Promise.reject(new Error("provider blew up"));
    failure.catch(() => {});
    await expect(withScanSourceBudget(failure, 5_000)).rejects.toThrow(
      "provider blew up",
    );
  });

  it("uses the shared production budget constant, not an ad-hoc one", () => {
    // The shipped budget is the contract the workflow and the tests share.
    expect(SCAN_SOURCE_BUDGET_MS).toBe(30_000);
  });
});

describe("summarizeScanProgress (#3176 scanning N, k done)", () => {
  it("counts only terminal states as done; pending/running stay outstanding", () => {
    const summary = summarizeScanProgress({
      "google_ads": entry("done", { label: "Google Ads", detail: "changes:0" }),
      "tiktok": entry("running", { label: "TikTok Ads" }),
      "subdomains": entry("pending", { label: "Subdomains" }),
      "hiring": entry("timed_out", { label: "Hiring page", detail: "budget:30000ms" }),
      "stgt-1": entry("unavailable", { kind: "mention", label: "RSS / Atom / JSON Feed" }),
      "stgt-2": entry("failed", { kind: "mention", label: "RSS / Atom / JSON Feed", detail: "feed_unavailable" }),
      "stgt-3": entry("skipped", { kind: "mention", label: "X", detail: "connector_not_operational" }),
    });

    expect(summary.total).toBe(7);
    expect(summary.done).toBe(5);
    expect(summary.remaining).toBe(2);
  });

  it("sorts entries deterministically so the surface never reshuffles between polls", () => {
    const summary = summarizeScanProgress({
      "zzz": entry("done"),
      "aaa": entry("running"),
      "mmm": entry("pending"),
    });
    expect(summary.entries.map((e) => e.sourceId)).toEqual(["aaa", "mmm", "zzz"]);
  });

  it("an empty fan-out summarizes to zero totals (the hide-the-block case)", () => {
    const summary = summarizeScanProgress({});
    expect(summary).toEqual({ total: 0, done: 0, remaining: 0, entries: [] });
  });
});
