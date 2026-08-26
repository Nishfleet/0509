import { afterEach, describe, expect, it, vi } from "vitest";

import { loadOfferTimeline } from "~/lib/offer-timeline.server";

const queryAll = vi.hoisted(() => vi.fn());

vi.mock("~/lib/data/d1.server", () => ({
  queryAll,
  queryOne: vi.fn(),
  execute: vi.fn(),
  ensureDb: vi.fn(),
}));

afterEach(() => {
  queryAll.mockReset();
});

describe("loadOfferTimeline", () => {
  it("maps stored snapshot rows into a dated ledger with artifact keys", async () => {
    queryAll.mockResolvedValue([
      {
        id: "s1",
        canonical_url: "https://nykaa.com/glow",
        raw_headline: "Glow serum",
        cta_text: "Shop now",
        price_text: "₹499",
        form_present: 1,
        artifact_key: "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html",
        metadata_json: JSON.stringify({
          screenshotArtifactKey: "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpeg",
        }),
        captured_at: "2026-08-01T10:00:00.000Z",
      },
      {
        id: "s2",
        canonical_url: "https://www.nykaa.com/glow",
        raw_headline: "Festive glow kit",
        cta_text: "Get the kit",
        price_text: "₹799",
        form_present: 1,
        artifact_key: "landing-pages/2026-08-10/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.html",
        metadata_json: JSON.stringify({
          screenshotArtifactKey: "landing-pages/2026-08-10/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpeg",
        }),
        captured_at: "2026-08-10T10:00:00.000Z",
      },
      {
        id: "s3",
        canonical_url: "https://shop.nykaa.com/glow",
        raw_headline: "Festive glow kit",
        cta_text: "Get the kit",
        price_text: "₹599",
        form_present: 0,
        artifact_key: "landing-pages/2026-08-20/cccccccccccccccccccccccccccccccc.html",
        metadata_json: JSON.stringify({
          screenshotArtifactKey: "landing-pages/2026-08-20/cccccccccccccccccccccccccccccccc.jpeg",
        }),
        captured_at: "2026-08-20T10:00:00.000Z",
      },
    ]);

    const loaded = await loadOfferTimeline({ DB: {} } as never, {
      domain: "nykaa.com",
      asOf: "2026-08-15",
    });

    expect(loaded.entries).toHaveLength(3);
    expect(loaded.entries[0]?.screenshotHref).toContain("/artifacts/proof/");
    expect(loaded.entries[0]?.pageTextHref).toContain("/artifacts/page-text/");
    expect(loaded.asOfState?.id).toBe("s2");
    expect(queryAll).toHaveBeenCalledTimes(1);
    const sql = String(queryAll.mock.calls[0]?.[1]);
    expect(sql).toContain("FROM landing_page_snapshot");
    expect(sql).toContain("ESCAPE '\\'");
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });

  it("returns an empty ledger when D1 is missing", async () => {
    const loaded = await loadOfferTimeline({} as never, { domain: "nykaa.com", asOf: null });
    expect(loaded).toEqual({ entries: [], asOfState: null });
    expect(queryAll).not.toHaveBeenCalled();
  });

  it("drops rows that do not belong to the requested domain", async () => {
    queryAll.mockResolvedValue([
      {
        id: "s-other",
        canonical_url: "https://notnykaa.com/glow",
        raw_headline: "Other",
        cta_text: null,
        price_text: null,
        form_present: null,
        artifact_key: null,
        metadata_json: "{}",
        captured_at: "2026-08-01T10:00:00.000Z",
      },
    ]);

    const loaded = await loadOfferTimeline({ DB: {} } as never, {
      domain: "nykaa.com",
      asOf: null,
    });
    expect(loaded.entries).toEqual([]);
  });

  it("labels a backfill row with the honest no-screenshot evidence note", async () => {
    queryAll.mockResolvedValue([
      {
        id: "backfill-nike-20260825",
        canonical_url: "https://www.nike.com/",
        raw_headline: "Nike. Just Do It.",
        cta_text: "Shop Now",
        price_text: null,
        form_present: 0,
        artifact_key: null,
        metadata_json: JSON.stringify({ backfill: true, source: "demo_brand_seed" }),
        captured_at: "2026-08-25T00:00:00.000Z",
      },
    ]);

    const loaded = await loadOfferTimeline({ DB: {} } as never, {
      domain: "nike.com",
      asOf: null,
    });

    expect(loaded.entries).toHaveLength(1);
    const entry = loaded.entries[0];
    expect(entry?.screenshotHref).toBeNull();
    expect(entry?.pageTextHref).toBeNull();
    expect(entry?.evidenceNote).toContain("no screenshot");
    expect(entry?.evidenceNote).toContain("25 Aug 2026");
  });

  it("does not label a real capture row that happens to lack artifacts", async () => {
    queryAll.mockResolvedValue([
      {
        id: "real-1",
        canonical_url: "https://nykaa.com/glow",
        raw_headline: "Glow serum",
        cta_text: "Shop now",
        price_text: "₹499",
        form_present: 1,
        artifact_key: null,
        metadata_json: JSON.stringify({ captureMethod: "landing_page_fetch" }),
        captured_at: "2026-08-01T10:00:00.000Z",
      },
    ]);

    const loaded = await loadOfferTimeline({ DB: {} } as never, {
      domain: "nykaa.com",
      asOf: null,
    });

    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0]?.evidenceNote).toBeNull();
  });
});
