import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";

/**
 * Issue #3157 — the homepage brief emitted `/creative/<id>` URLs the
 * `/creative/:id` edge route could only answer with 404: the route resolves
 * its URL from the persisted `ad` table (raw_json `creativeImageUrl`), but
 * the brief's ads come from the `discovery_cache_entry` snapshot, which the
 * discovery pipeline writes WITHOUT an `ad`-table row. Every visitor's
 * console counted hard 404s on the primary landing page. These tests lock
 * the payload gate: only ids the route can resolve keep their `creativeId`.
 */

const rowsBySqlWord = vi.hoisted(() => ({ snapshotAds: null as unknown }));

vi.mock("~/lib/brand-page.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/brand-page.server")>();
  return {
    ...actual,
    loadBrandPageCacheSnapshot: vi.fn(async () => ({
      ads: rowsBySqlWord.snapshotAds as never,
      fetchedAt: "2026-09-12T01:55:19.048Z",
      country: "all",
      freshForLiveClaim: false,
      domain: "nike.com",
    })),
  };
});

import { loadPublicProofBrief, routeableCreativeIds } from "~/lib/public-proof.server";
import type { AdRecord } from "~/lib/types";

let routeableAdRows: Array<{ id: string }> = [];

function makeEnv(): AppEnv {
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            return {
              async all() {
                // Route-parity predicate (issue #3157 review round): the
                // /creative/:id route rejects a stored URL that is missing or
                // empty/whitespace, so the gate must read the same predicate.
                if (
                  sql.includes(
                    "json_extract(raw_json, '$.creativeImageUrl') IS NOT NULL",
                  ) &&
                  sql.includes("trim(json_extract(raw_json, '$.creativeImageUrl')) <> ''")
                ) {
                  routeableAdRows.forEach((row, i) => {
                    if (bindings[i] !== row.id) {
                      throw new Error(`unexpected binding order: ${bindings[i]}`);
                    }
                  });
                  return { results: routeableAdRows };
                }
                throw new Error(`Unexpected SQL: ${sql}`);
              },
            };
          },
        };
      },
    },
  } as unknown as AppEnv;
}

function makeAd(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "ad-1",
    advertiser: "Nike",
    body: "Body",
    previewHeadline: "Headline",
    previewSubhead: "Subhead",
    hook: "Bring sports more fully into your day.",
    offer: "",
    cta: "Shop Now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.nike.com/lp",
    adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1",
    countries: ["United States"],
    platforms: ["Instagram"],
    firstSeenAt: "2026-04-07T00:00:00.000Z",
    lastSeenAt: "2026-09-12T00:00:00.000Z",
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

beforeEach(() => {
  rowsBySqlWord.snapshotAds = [
    makeAd({ metaAdId: "ad-1", creativeImageUrl: "https://scontent.xx.fbcdn.net/a.jpg" }),
    makeAd({
      metaAdId: "ad-2",
      creativeImageUrl: "https://scontent.xx.fbcdn.net/b.jpg",
      hook: "Second hook on record.",
    }),
  ];
  routeableAdRows = [];
});

describe("public proof brief /creative payload gate (issue #3157)", () => {
  it("drops creativeId for ads with no persisted ad-table row", async () => {
    const brief = await loadPublicProofBrief(makeEnv(), { visitorCountry: "all" });
    expect(brief).not.toBeNull();
    expect(
      brief!.proofTrail.every((item) => item.creativeId === null),
    ).toBe(true);
  });

  it("keeps creativeId only for ids the route lookup resolves", async () => {
    routeableAdRows = [{ id: "ad-1" }];
    const brief = await loadPublicProofBrief(makeEnv(), { visitorCountry: "all" });
    const byId = new Map(
      brief!.proofTrail.map((item) => [item.creativeImageUrl, item.creativeId]),
    );
    // ad-1 keeps its route id; ad-2 (no persisted row) loses it.
    expect(brief!.proofTrail.length).toBeGreaterThanOrEqual(1);
    expect([...byId.values()]).toContain("ad-1");
    expect(byId.get("https://scontent.xx.fbcdn.net/b.jpg")).toBeNull();
  });

  it("silently drops route ids when the D1 lookup fails", async () => {
    routeableAdRows = [{ id: "ad-1" }, { id: "MISMATCH" }];
    const brief = await loadPublicProofBrief(makeEnv(), { visitorCountry: "all" });
    expect(brief!.proofTrail.every((item) => item.creativeId === null)).toBe(true);
  });

  it("routeableCreativeIds returns an empty set with no ids", async () => {
    const routeable = await routeableCreativeIds(makeEnv(), [null, "  "]);
    expect(routeable.size).toBe(0);
  });
});
