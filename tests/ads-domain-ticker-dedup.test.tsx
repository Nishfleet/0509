import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandTicker } from "~/components/ads/brand-ticker";
import { dedupeTickerBodies, normalizeTickerBody } from "~/lib/ticker-dedup";
import type { AdRecord } from "~/lib/types";

/**
 * Regression test for issue #1496 — the `/ads/:domain` `ld-ticker-belt` first
 * cycle must render 6 distinct ad bodies. Before the fix the belt sliced the
 * first 6 cached ads in recency order without dedup, so the same body repeated
 * 3–4× per cycle on pages whose wall has multiple variants of one body
 * (notion.so 4/6, allbirds.com 5/6, nykaa.com 5/6, mamaearth.com 5/6,
 * atlassian.com 5/6). nike.com, amazon.com, and lenskart.com were already
 * 6/6 because their walls happen not to repeat bodies — they stay clean.
 *
 * Each case below mirrors the real first-cycle duplicate pattern observed on
 * the live page for that brand (issue body), then asserts the rendered first
 * cycle is 6-of-6 distinct after the dedup helper runs.
 */

function ad(overrides: Partial<AdRecord>): AdRecord {
  return {
    metaAdId: overrides.metaAdId ?? "ad-1",
    advertiser: "Brand",
    body: overrides.body ?? "",
    previewHeadline: overrides.previewHeadline ?? "",
    previewSubhead: "",
    hook: overrides.hook ?? "",
    offer: "",
    cta: "Shop Now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://brand.example/launch",
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: "2026-06-01T00:00:00.000Z",
    lastSeenAt: null,
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

/** Parse the first cycle's item bodies out of the rendered ticker markup. */
function firstCycleBodies(markup: string): string[] {
  // The belt renders the run twice (marquee loop). Split on the run opener and
  // parse items only from the first run so the second copy is not double-counted.
  const parts = markup.split('<span class="ld-ticker-run">');
  if (parts.length < 2) return [];
  const firstRun = parts[1];
  const itemRe = /<span class="ld-ticker-item"[^>]*>([\s\S]*?)<\/span>/g;
  const bodies: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(firstRun)) !== null) {
    // Strip the <b>time</b> and <small>[source]</small> tags and keep the
    // body text between them.
    const inner = m[1].replace(/<b>[\s\S]*?<\/b>/, "").replace(/<small>[\s\S]*?<\/small>/, "");
    bodies.push(inner.trim());
  }
  return bodies;
}

const BRAND_FIXTURES: Array<{
  domain: string;
  /** The first 6 cached ads in recency order, mirroring the live duplicate
   *  pattern observed in the issue body for that brand. */
  ads: AdRecord[];
}> = [
  {
    domain: "notion.so",
    // Live first cycle was 4/6: body #1 ×3, body #5 ×1, body #6 ×1, body #2 ×1.
    ads: [
      ad({ metaAdId: "n1", previewHeadline: "Notion has everything you need to unlock the power of AI at work." }),
      ad({ metaAdId: "n2", hook: "I've built a lot in 20 years, but in 2026 I'm building a lot more with @notionhq #NotionPartner #BuildWithNotion" }),
      ad({ metaAdId: "n3", previewHeadline: "Notion has everything you need to unlock the power of AI at work." }),
      ad({ metaAdId: "n4", previewHeadline: "Notion has everything you need to unlock the power of AI at work." }),
      ad({ metaAdId: "n5", hook: "starting the new year by building something to organize all the chaos in my world" }),
      ad({ metaAdId: "n6", previewHeadline: "We're changing the way work gets done. Collaboration meets AI meets beautiful functionality." }),
      // Extra distinct bodies so the deduped cycle can still reach 6.
      ad({ metaAdId: "n7", previewHeadline: "Plan it, build it, ship it — all in one AI-native workspace." }),
      ad({ metaAdId: "n8", hook: "From scattered docs to one source of truth — Notion keeps the whole team aligned." }),
    ],
  },
  {
    domain: "allbirds.com",
    // Live first cycle was 5/6: one body repeated twice.
    ads: [
      ad({ metaAdId: "a1", previewHeadline: "The world's most comfortable shoes, made from natural materials." }),
      ad({ metaAdId: "a2", previewHeadline: "Carbon-neutral sneakers. Same comfort, lower footprint." }),
      ad({ metaAdId: "a3", hook: "I never want to take these off — the Wool Runners are that good." }),
      ad({ metaAdId: "a4", previewHeadline: "The world's most comfortable shoes, made from natural materials." }),
      ad({ metaAdId: "a5", previewHeadline: "Tree Runners: breathable, machine-washable, ready for anything." }),
      ad({ metaAdId: "a6", previewHeadline: "Free shipping and a 30-day trial on every pair." }),
      ad({ metaAdId: "a7", previewHeadline: "New arrivals just landed — lighter on your feet and the planet." }),
    ],
  },
  {
    domain: "nykaa.com",
    ads: [
      ad({ metaAdId: "y1", previewHeadline: "Nykaa's biggest beauty sale is live — up to 50% off." }),
      ad({ metaAdId: "y2", previewHeadline: "Nykaa's biggest beauty sale is live — up to 50% off." }),
      ad({ metaAdId: "y3", hook: "My skincare routine starts and ends with Nykaa Naturals." }),
      ad({ metaAdId: "y4", previewHeadline: "New launches every week from the brands you love." }),
      ad({ metaAdId: "y5", previewHeadline: "Free gift on every order over ₹999." }),
      ad({ metaAdId: "y6", previewHeadline: "Pro tips from makeup artists, only on Nykaa." }),
      ad({ metaAdId: "y7", previewHeadline: "Haircare that actually delivers — shop the experts' picks." }),
    ],
  },
  {
    domain: "mamaearth.com",
    ads: [
      ad({ metaAdId: "m1", previewHeadline: "Toxin-free care for the whole family — Mamaearth." }),
      ad({ metaAdId: "m2", previewHeadline: "Goodness inside, goodness outside — made with natural ingredients." }),
      ad({ metaAdId: "m3", previewHeadline: "Toxin-free care for the whole family — Mamaearth." }),
      ad({ metaAdId: "m4", hook: "My hair has never felt healthier — the Onion Oil shampoo is a game changer." }),
      ad({ metaAdId: "m5", previewHeadline: "Made safe certified. No harmful chemicals, ever." }),
      ad({ metaAdId: "m6", previewHeadline: "Baby-safe, dermatologist-tested, and gentle on skin." }),
      ad({ metaAdId: "m7", previewHeadline: "Plant a tree with every order — over 5 million and counting." }),
    ],
  },
  {
    domain: "atlassian.com",
    ads: [
      ad({ metaAdId: "t1", previewHeadline: "Jira: plan, track, and ship great work together." }),
      ad({ metaAdId: "t2", previewHeadline: "Jira: plan, track, and ship great work together." }),
      ad({ metaAdId: "t3", previewHeadline: "Confluence turns team knowledge into action." }),
      ad({ metaAdId: "t4", hook: "We shipped 40% faster after moving our sprint planning to Jira." }),
      ad({ metaAdId: "t5", previewHeadline: "Atlassian's cloud platform scales with your team." }),
      ad({ metaAdId: "t6", previewHeadline: "Automate the busywork with Jira workflows." }),
      ad({ metaAdId: "t7", previewHeadline: "One source of truth for every project, big or small." }),
    ],
  },
  {
    domain: "nike.com",
    // Already 6/6 clean — the wall happens not to repeat bodies.
    ads: [
      ad({ metaAdId: "nk1", previewHeadline: "Run through summer with gear that can take the heat." }),
      ad({ metaAdId: "nk2", previewHeadline: "Air Max: bold cushioning, all-day comfort." }),
      ad({ metaAdId: "nk3", hook: "Just do it — your next PR is one run away." }),
      ad({ metaAdId: "nk4", previewHeadline: "The Pegasus 41 is here. Tested by runners, for runners." }),
      ad({ metaAdId: "nk5", previewHeadline: "Train hard. Recover smarter. Nike has both covered." }),
      ad({ metaAdId: "nk6", previewHeadline: "New colorways dropped — shop the summer collection." }),
    ],
  },
  {
    domain: "amazon.com",
    ads: [
      ad({ metaAdId: "am1", previewHeadline: "Prime members save more on everyday essentials." }),
      ad({ metaAdId: "am2", previewHeadline: "Fast, free delivery on millions of items." }),
      ad({ metaAdId: "am3", hook: "I found everything on my list in one place — Amazon had it all." }),
      ad({ metaAdId: "am4", previewHeadline: "Shop deals across every category, refreshed daily." }),
      ad({ metaAdId: "am5", previewHeadline: "Try before you buy — Prime Wardrobe lets you size at home." }),
      ad({ metaAdId: "am6", previewHeadline: "Subscribe & Save: set it, forget it, save up to 15%." }),
    ],
  },
  {
    domain: "lenskart.com",
    ads: [
      ad({ metaAdId: "l1", previewHeadline: "Try frames at home, free — only at Lenskart." }),
      ad({ metaAdId: "l2", previewHeadline: "Blue-cut lenses for screen-heavy days." }),
      ad({ metaAdId: "l3", hook: "My glasses finally fit my face — the home try-on made it easy." }),
      ad({ metaAdId: "l4", previewHeadline: "Buy one, get one free on eyeglasses this week." }),
      ad({ metaAdId: "l5", previewHeadline: "Contact lenses from the brands you trust, delivered." }),
      ad({ metaAdId: "l6", previewHeadline: "Kids' frames that survive the playground." }),
    ],
  },
];

describe("BrandTicker /ads/:domain first-cycle dedup (issue #1496)", () => {
  for (const { domain, ads } of BRAND_FIXTURES) {
    it(`/ads/${domain} renders a 6-of-6 distinct first cycle`, () => {
      const markup = renderToStaticMarkup(
        createElement(BrandTicker, { ads, brandName: domain, fresh: false }),
      );
      expect(markup).toContain("ld-ticker-belt");
      const bodies = firstCycleBodies(markup);
      expect(bodies).toHaveLength(6);
      const normalized = bodies.map(normalizeTickerBody);
      expect(new Set(normalized).size).toBe(6);
    });
  }

  it("renders nothing when no ads carry a body (empty-state path)", () => {
    const markup = renderToStaticMarkup(
      createElement(BrandTicker, { ads: [], brandName: "empty.com", fresh: false }),
    );
    expect(markup).toBe("");
  });

  it("renders an honestly shorter strip when the wall has fewer than 6 distinct bodies", () => {
    const ads = [
      ad({ metaAdId: "d1", previewHeadline: "Only body." }),
      ad({ metaAdId: "d2", previewHeadline: "Only body." }),
      ad({ metaAdId: "d3", previewHeadline: "Only body." }),
    ];
    const markup = renderToStaticMarkup(
      createElement(BrandTicker, { ads, brandName: "short.com", fresh: false }),
    );
    const bodies = firstCycleBodies(markup);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toBe("Only body.");
  });

  it("keeps the source-link tag and aria-hidden wrapper", () => {
    const ads = [
      ad({ metaAdId: "k1", previewHeadline: "Body one." }),
      ad({ metaAdId: "k2", previewHeadline: "Body two." }),
    ];
    const markup = renderToStaticMarkup(
      createElement(BrandTicker, { ads, brandName: "keep.com", fresh: false }),
    );
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("[ad library]");
  });
});

describe("dedupeTickerBodies helper", () => {
  it("drops a second occurrence of the same normalized body", () => {
    const items = [
      { id: 1, body: "Hello world." },
      { id: 2, body: "hello world" },
      { id: 3, body: "Distinct line." },
    ];
    const out = dedupeTickerBodies(items, (i) => i.body);
    expect(out.map((i) => i.id)).toEqual([1, 3]);
  });

  it("prefers the longest raw variant when bodies normalize to the same key", () => {
    // Both normalize to "hello world" — the fuller raw variant (with the
    // trailing period) wins as the stronger evidence line.
    const items = [
      { id: 1, body: "Hello world" },
      { id: 2, body: "Hello world." },
    ];
    const out = dedupeTickerBodies(items, (i) => i.body);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(2);
  });

  it("strips trailing punctuation before comparison", () => {
    const items = [
      { id: 1, body: "Run fast!" },
      { id: 2, body: "run fast" },
    ];
    const out = dedupeTickerBodies(items, (i) => i.body);
    expect(out).toHaveLength(1);
  });

  it("collapses whitespace before comparison", () => {
    const items = [
      { id: 1, body: "Two   spaces" },
      { id: 2, body: "two spaces" },
    ];
    const out = dedupeTickerBodies(items, (i) => i.body);
    expect(out).toHaveLength(1);
  });

  it("preserves insertion order of first occurrences", () => {
    const items = [
      { id: "a", body: "First" },
      { id: "b", body: "Second" },
      { id: "c", body: "First" },
      { id: "d", body: "Third" },
    ];
    const out = dedupeTickerBodies(items, (i) => i.body);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "d"]);
  });

  it("skips empty bodies", () => {
    const items = [
      { id: 1, body: "" },
      { id: 2, body: "   " },
      { id: 3, body: "Real body." },
    ];
    const out = dedupeTickerBodies(items, (i) => i.body);
    expect(out.map((i) => i.id)).toEqual([3]);
  });
});
