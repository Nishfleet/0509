import { describe, expect, it } from "vitest";

import {
  deriveBriefConfidence,
  deriveBriefDelta,
  deriveBriefExpiry,
  deriveBriefOwner,
  deriveBriefRetentionFields,
  renderBriefRetentionHtml,
  renderBriefRetentionText,
} from "~/lib/brief-retention";
import type {
  DigestItemRecord,
  DigestRecord,
  WatchEventRecord,
} from "~/lib/types";

function digestItem(input: Partial<DigestItemRecord> = {}): DigestItemRecord {
  return {
    id: input.id ?? "item-1",
    digestRunId: input.digestRunId ?? "run-1",
    watchlistId: input.watchlistId ?? "watch-1",
    watchlistName: input.watchlistName ?? "Boat Lifestyle",
    eventType: input.eventType ?? "landing_page_offer_changed",
    title: input.title ?? "Boat changed its landing page offer",
    summary: input.summary ?? "Pricing shifted from ₹1,499 to ₹1,299.",
    metadata: input.metadata ?? {
      proofCaptureId: "proof-1",
      sourceStatus: "proof_backed",
    },
    createdAt: input.createdAt ?? "2026-08-10T00:00:00.000Z",
  };
}

function watchEvent(input: Partial<WatchEventRecord> = {}): WatchEventRecord {
  return {
    id: input.id ?? "event-1",
    watchlistId: input.watchlistId ?? "watch-1",
    runId: input.runId ?? "run-1",
    eventType: input.eventType ?? "landing_page_offer_changed",
    status: input.status ?? "confirmed",
    importanceScore: input.importanceScore ?? 85,
    adId: input.adId ?? null,
    baselineFromRunId: input.baselineFromRunId ?? null,
    candidateId: input.candidateId ?? null,
    proofCaptureId: input.proofCaptureId ?? "proof-1",
    title: input.title ?? "Boat changed its landing page offer",
    summary: input.summary ?? "Pricing shifted from ₹1,499 to ₹1,299.",
    metadata: input.metadata ?? {},
    confirmedAt: input.confirmedAt ?? "2026-08-10T00:00:00.000Z",
    suppressedAt: input.suppressedAt ?? null,
    invalidatedAt: input.invalidatedAt ?? null,
    lastEvaluatedAt: input.lastEvaluatedAt ?? "2026-08-10T00:00:00.000Z",
    createdAt: input.createdAt ?? "2026-08-10T00:00:00.000Z",
  };
}

function previousDigest(items: DigestItemRecord[] = []): DigestRecord {
  return {
    id: "prev-1",
    userId: "user-1",
    periodStart: "2026-08-03T00:00:00.000Z",
    periodEnd: "2026-08-10T00:00:00.000Z",
    createdAt: "2026-08-10T01:00:00.000Z",
    items,
    delivery: null,
  };
}

describe("deriveBriefDelta", () => {
  it("states the first-brief baseline when no previous digest exists", () => {
    const delta = deriveBriefDelta({
      items: [digestItem(), digestItem({ id: "item-2" })],
      previousBrief: null,
    });
    expect(delta).toContain("2 changes filed");
    expect(delta).toContain("first brief on file");
  });

  it("names a higher count than the previous brief as a positive delta", () => {
    const delta = deriveBriefDelta({
      items: [
        digestItem({ id: "item-1" }),
        digestItem({ id: "item-2" }),
        digestItem({ id: "item-3" }),
      ],
      previousBrief: previousDigest([digestItem({ id: "p-1" })]),
    });
    expect(delta).toContain("3 changes filed");
    expect(delta).toContain("2 changes more than the previous brief");
    expect(delta).toContain("1 on file");
  });

  it("names a lower count than the previous brief as a negative delta", () => {
    const delta = deriveBriefDelta({
      items: [digestItem({ id: "item-1" })],
      previousBrief: previousDigest([
        digestItem({ id: "p-1" }),
        digestItem({ id: "p-2" }),
        digestItem({ id: "p-3" }),
      ]),
    });
    expect(delta).toContain("1 change filed");
    expect(delta).toContain("2 changes fewer than the previous brief");
  });

  it("uses singular wording when the count is exactly one", () => {
    const delta = deriveBriefDelta({
      items: [digestItem()],
      previousBrief: previousDigest([digestItem({ id: "p-1" })]),
    });
    expect(delta).toContain("1 change filed");
    expect(delta).toContain("same volume as the previous brief");
  });

  it("never invents a delta when no items are filed", () => {
    const delta = deriveBriefDelta({
      items: [],
      previousBrief: previousDigest([digestItem()]),
    });
    expect(delta).toContain("No filed changes this period");
    expect(delta).not.toContain("baseline");
  });
});

describe("deriveBriefOwner", () => {
  it("returns the workspace owner identity when one is provided", () => {
    expect(deriveBriefOwner({ ownerName: "Priya" })).toBe("Priya");
  });

  it("falls back to the truthful workspace-owner default when the name is empty", () => {
    expect(deriveBriefOwner({ ownerName: null })).toBe("Workspace owner");
    expect(deriveBriefOwner({ ownerName: "   " })).toBe("Workspace owner");
  });
});

describe("deriveBriefConfidence", () => {
  it("is high when every filed item carries stored proof", () => {
    expect(
      deriveBriefConfidence({
        items: [
          digestItem({ metadata: { proofCaptureId: "p1", sourceStatus: "proof_backed" } }),
          digestItem({ id: "i2", metadata: { proofCaptureId: "p2", sourceStatus: "proof_backed" } }),
        ],
      }),
    ).toBe("high");
  });

  it("is medium when at least one filed item carries stored proof", () => {
    expect(
      deriveBriefConfidence({
        items: [
          digestItem({ metadata: { proofCaptureId: "p1", sourceStatus: "proof_backed" } }),
          digestItem({ id: "i2", metadata: { sourceStatus: "scan_backed" } }),
        ],
      }),
    ).toBe("medium");
  });

  it("is low when no filed item has stored proof", () => {
    expect(
      deriveBriefConfidence({
        items: [
          digestItem({ metadata: { sourceStatus: "scan_backed" } }),
          digestItem({ id: "i2", metadata: { sourceStatus: "scan_backed" } }),
        ],
      }),
    ).toBe("low");
  });

  it("is low when source access is degraded, even if items are proof-backed", () => {
    expect(
      deriveBriefConfidence({
        items: [
          digestItem({ metadata: { proofCaptureId: "p1", sourceStatus: "proof_backed" } }),
        ],
        sourceDegraded: true,
      }),
    ).toBe("low");
  });

  it("is unavailable when no items are filed", () => {
    expect(deriveBriefConfidence({ items: [] })).toBe("unavailable");
  });

  it("reads proof from watch_event.proofCaptureId", () => {
    expect(
      deriveBriefConfidence({
        items: [
          watchEvent({ id: "e1", proofCaptureId: "p1" }),
          watchEvent({ id: "e2", proofCaptureId: "" }),
        ],
      }),
    ).toBe("medium");
  });
});

describe("deriveBriefExpiry", () => {
  it("names the next scan as the expiry when a timestamp is provided", () => {
    expect(
      deriveBriefExpiry({
        nextScanAt: "2026-08-17T03:00:00.000Z",
        nextScanLabel: "Monday 03:00 UTC",
      }),
    ).toBe("Expires at the next check — Monday 03:00 UTC.");
  });

  it("names only the next check when no human label is provided", () => {
    expect(
      deriveBriefExpiry({ nextScanAt: "2026-08-17T03:00:00.000Z" }),
    ).toBe("Expires at the next check.");
  });

  it("names the next check label without a timestamp when only a label is on file", () => {
    expect(
      deriveBriefExpiry({ nextScanLabel: "Monday 03:00 UTC" }),
    ).toBe("Next check Monday 03:00 UTC — no expiry timestamp on file yet.");
  });

  it("renders an explicit unavailable state when neither is on file", () => {
    expect(deriveBriefExpiry({})).toBe(
      "Expiry unset — no next scheduled check is on file.",
    );
  });
});

describe("deriveBriefRetentionFields", () => {
  it("returns all four fields for a populated brief", () => {
    const fields = deriveBriefRetentionFields({
      items: [digestItem(), digestItem({ id: "i2" })],
      previousBrief: previousDigest([digestItem({ id: "p1" })]),
      ownerName: "Priya",
      nextScanAt: "2026-08-17T03:00:00.000Z",
      nextScanLabel: "Monday 03:00 UTC",
    });
    expect(fields.delta).toContain("2 changes filed");
    expect(fields.owner).toBe("Priya");
    expect(fields.confidence).toBe("high");
    expect(fields.confidenceLabel).toContain("High confidence");
    expect(fields.expiry).toContain("Expires at the next check");
    expect(fields.hasAllFields).toBe(true);
  });

  it("marks hasAllFields false when the previous brief is missing", () => {
    const fields = deriveBriefRetentionFields({
      items: [digestItem()],
      previousBrief: null,
      ownerName: "Priya",
      nextScanAt: "2026-08-17T03:00:00.000Z",
    });
    expect(fields.hasAllFields).toBe(false);
  });

  it("marks hasAllFields false when the owner is empty", () => {
    const fields = deriveBriefRetentionFields({
      items: [digestItem()],
      previousBrief: previousDigest(),
      ownerName: null,
      nextScanAt: "2026-08-17T03:00:00.000Z",
    });
    expect(fields.hasAllFields).toBe(false);
    expect(fields.owner).toBe("Workspace owner");
  });

  it("marks hasAllFields false when no next-scan timestamp is on file", () => {
    const fields = deriveBriefRetentionFields({
      items: [digestItem()],
      previousBrief: previousDigest(),
      ownerName: "Priya",
      nextScanAt: null,
    });
    expect(fields.hasAllFields).toBe(false);
    expect(fields.expiry).toContain("Expiry unset");
  });
});

describe("renderBriefRetention", () => {
  const sample = deriveBriefRetentionFields({
    items: [digestItem()],
    previousBrief: previousDigest(),
    ownerName: "Priya",
    nextScanAt: "2026-08-17T03:00:00.000Z",
    nextScanLabel: "Monday 03:00 UTC",
  });

  it("renders all four fields in HTML with their labels", () => {
    const html = renderBriefRetentionHtml(sample);
    expect(html).toContain("Since last brief:");
    expect(html).toContain("Accountable reviewer:");
    expect(html).toContain("Confidence:");
    expect(html).toContain("Expiry:");
    expect(html).toContain("Priya");
    expect(html).toContain("Expires at the next check");
  });

  it("renders all four fields in text with their labels", () => {
    const lines = renderBriefRetentionText(sample);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Since last brief: /);
    expect(lines[1]).toMatch(/^Accountable reviewer: /);
    expect(lines[2]).toMatch(/^Confidence: /);
    expect(lines[3]).toMatch(/^Expiry: /);
  });

  it("escapes HTML in owner names and delta copy", () => {
    const fields = deriveBriefRetentionFields({
      items: [digestItem()],
      previousBrief: null,
      ownerName: "<script>alert(1)</script>",
    });
    const html = renderBriefRetentionHtml(fields);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
