import { describe, expect, it } from "vitest";

import {
  buildSnapshotPayload,
  diffGoogleAdsSnapshots,
  type GoogleAdsSnapshotPayload,
} from "~/lib/sources/google-ads/google-ads-snapshot.server";
import type { GoogleAdsCreative } from "~/lib/sources/google-ads/google-ads-transparency.server";

function creative(overrides: Partial<GoogleAdsCreative> = {}): GoogleAdsCreative {
  return {
    advertiserId: overrides.advertiserId ?? "AR1",
    advertiserName: overrides.advertiserName ?? "Acme",
    creativeId: overrides.creativeId ?? "CR1",
    format: overrides.format ?? "text",
    domain: overrides.domain ?? "acme.com",
    firstShownAt: overrides.firstShownAt ?? "2026-01-01T00:00:00.000Z",
    // Recent lastShown (same day as the default fetchedAt) so the default
    // creative never accidentally trips the 7-day paused-stale rule.
    lastShownAt: overrides.lastShownAt ?? "2026-09-10T00:00:00.000Z",
    previewUrl: overrides.previewUrl ?? null,
  };
}

function snapshot(creatives: GoogleAdsCreative[], fetchedAt = "2026-09-10T00:00:00.000Z"): GoogleAdsSnapshotPayload {
  return buildSnapshotPayload("acme.com", creatives, false, fetchedAt);
}

const DAY = 24 * 60 * 60 * 1000;

describe("google-ads-snapshot buildSnapshotPayload", () => {
  it("counts advertisers and computes the format mix", () => {
    const payload = buildSnapshotPayload(
      "nike.com",
      [
        creative({ advertiserId: "AR1", format: "text" }),
        creative({ advertiserId: "AR1", creativeId: "CR2", format: "image" }),
        creative({ advertiserId: "AR2", creativeId: "CR3", format: "video" }),
      ],
      true,
      "2026-09-10T00:00:00.000Z",
    );
    expect(payload.advertiserCount).toBe(2);
    expect(payload.formatMix).toEqual({ text: 1, image: 1, video: 1, unknown: 0 });
    expect(payload.truncated).toBe(true);
    expect(payload.creatives).toHaveLength(3);
  });
});

describe("google-ads-snapshot diffGoogleAdsSnapshots", () => {
  it("returns no changes on the first snapshot (no baseline)", () => {
    const next = snapshot([creative()]);
    expect(diffGoogleAdsSnapshots(null, next)).toEqual([]);
  });

  it("returns no changes when the snapshot is identical", () => {
    const prev = snapshot([creative()]);
    const next = snapshot([creative()]);
    expect(diffGoogleAdsSnapshots(prev, next)).toEqual([]);
  });

  it("detects new creative ids", () => {
    const prev = snapshot([creative({ creativeId: "CR1" })]);
    const next = snapshot([creative({ creativeId: "CR1" }), creative({ creativeId: "CR2" })]);
    const changes = diffGoogleAdsSnapshots(prev, next);
    const newCreatives = changes.find((c) => (c.metadata as { category?: string }).category === "new_creatives");
    expect(newCreatives).toBeDefined();
    expect(newCreatives?.eventType).toBe("ad_new");
    expect((newCreatives?.metadata as { creativeIds: string[] }).creativeIds).toEqual(["CR2"]);
  });

  it("detects a paused creative (lastShownAt stopped advancing 7+ days)", () => {
    // lastShown froze at exactly 7 days before `next` (>= 7 -> paused) but
    // only 6 days before `prev` (< 7 -> not yet paused), so this creative
    // becomes paused in this transition and is emitted once.
    const nextFetched = Date.parse("2026-09-11T00:00:00.000Z");
    const lastShown = new Date(nextFetched - 7 * DAY).toISOString();
    const prev = snapshot([creative({ creativeId: "CR1", lastShownAt: lastShown })], "2026-09-10T00:00:00.000Z");
    const next = snapshot([creative({ creativeId: "CR1", lastShownAt: lastShown })], "2026-09-11T00:00:00.000Z");
    const changes = diffGoogleAdsSnapshots(prev, next);
    const paused = changes.find((c) => (c.metadata as { category?: string }).category === "paused_creatives");
    expect(paused).toBeDefined();
    expect(paused?.eventType).toBe("ad_inactive");
    expect((paused?.metadata as { creativeIds: string[] }).creativeIds).toEqual(["CR1"]);
  });

  it("does not flag a creative as paused when lastShownAt is still advancing", () => {
    const prev = snapshot(
      [creative({ creativeId: "CR1", lastShownAt: "2026-09-09T00:00:00.000Z" })],
      "2026-09-09T00:00:00.000Z",
    );
    const next = snapshot(
      [creative({ creativeId: "CR1", lastShownAt: "2026-09-10T00:00:00.000Z" })],
      "2026-09-10T00:00:00.000Z",
    );
    const changes = diffGoogleAdsSnapshots(prev, next);
    expect(changes.find((c) => (c.metadata as { category?: string }).category === "paused_creatives")).toBeUndefined();
  });

  it("does not flag a creative as paused when stale but still under 7 days", () => {
    const lastShown = new Date(Date.parse("2026-09-10T00:00:00.000Z") - 5 * DAY).toISOString();
    const prev = snapshot([creative({ creativeId: "CR1", lastShownAt: lastShown })], "2026-09-10T00:00:00.000Z");
    const next = snapshot([creative({ creativeId: "CR1", lastShownAt: lastShown })], "2026-09-10T00:00:00.001Z");
    const changes = diffGoogleAdsSnapshots(prev, next);
    expect(changes.find((c) => (c.metadata as { category?: string }).category === "paused_creatives")).toBeUndefined();
  });

  it("does not re-emit a paused creative that was already paused last check", () => {
    const staleLastShown = new Date(Date.parse("2026-08-30T00:00:00.000Z")).toISOString();
    const prev = snapshot([creative({ creativeId: "CR1", lastShownAt: staleLastShown })], "2026-09-10T00:00:00.000Z");
    // next snapshot: lastShownAt still stale (not advancing) — already paused
    const next = snapshot([creative({ creativeId: "CR1", lastShownAt: staleLastShown })], "2026-09-11T00:00:00.000Z");
    const changes = diffGoogleAdsSnapshots(prev, next);
    expect(
      changes.find((c) => (c.metadata as { category?: string }).category === "paused_creatives"),
    ).toBeUndefined();
    expect(changes).toEqual([]);
  });

  it("detects new advertiser ids on the domain", () => {
    const prev = snapshot([creative({ advertiserId: "AR1", advertiserName: "Acme", creativeId: "CR1" })]);
    const next = snapshot([
      creative({ advertiserId: "AR1", advertiserName: "Acme", creativeId: "CR1" }),
      creative({ advertiserId: "AR2", advertiserName: "Beta", creativeId: "CR2" }),
    ]);
    const changes = diffGoogleAdsSnapshots(prev, next);
    const newAdvertisers = changes.find((c) => (c.metadata as { category?: string }).category === "new_advertisers");
    expect(newAdvertisers).toBeDefined();
    expect(newAdvertisers?.eventType).toBe("ad_new");
    expect((newAdvertisers?.metadata as { advertiserIds: string[] }).advertiserIds).toEqual(["AR2"]);
    expect((newAdvertisers?.metadata as { advertiserNames: string[] }).advertiserNames).toEqual(["Beta"]);
  });

  it("detects a format mix change", () => {
    const prev = snapshot([
      creative({ creativeId: "CR1", format: "text" }),
      creative({ creativeId: "CR2", format: "text" }),
    ]);
    const next = snapshot([
      creative({ creativeId: "CR1", format: "text" }),
      creative({ creativeId: "CR2", format: "image" }),
    ]);
    const changes = diffGoogleAdsSnapshots(prev, next);
    const mix = changes.find((c) => (c.metadata as { category?: string }).category === "format_mix_change");
    expect(mix).toBeDefined();
    expect(mix?.eventType).toBe("website_page_changed");
    expect((mix?.metadata as { prev: { text: number }; next: { text: number; image: number } }).prev.text).toBe(2);
    expect((mix?.metadata as { prev: { text: number }; next: { text: number; image: number } }).next.text).toBe(1);
    expect((mix?.metadata as { prev: { text: number }; next: { text: number; image: number } }).next.image).toBe(1);
  });

  it("emits all four change categories together when they co-occur", () => {
    const prev = snapshot([creative({ advertiserId: "AR1", creativeId: "CR1", format: "text" })]);
    const next = snapshot([
      creative({ advertiserId: "AR1", creativeId: "CR1", format: "image" }),
      creative({ advertiserId: "AR2", advertiserName: "Beta", creativeId: "CR2", format: "image" }),
    ]);
    const changes = diffGoogleAdsSnapshots(prev, next);
    const categories = changes.map((c) => (c.metadata as { category?: string }).category);
    expect(categories).toContain("new_creatives");
    expect(categories).toContain("new_advertisers");
    expect(categories).toContain("format_mix_change");
  });
});
