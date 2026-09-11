import { createElement } from "react";
import { mockReactRouter } from "./helpers/mock-react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OfferTimelineLoaderData } from "~/routes/timeline.$domain";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";

let currentData: OfferTimelineLoaderData;

beforeEach(() => {
  vi.resetModules();
  mockReactRouter({
    loader: () => currentData,
    loaderData: () => undefined,
  });
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function render(data: OfferTimelineLoaderData): Promise<string> {
  currentData = data;
  const { default: OfferTimelineRoute } = await import("~/routes/timeline.$domain");
  return renderToStaticMarkup(createElement(OfferTimelineRoute));
}

function parseLdJsonBlocks(markup: string): Array<Record<string, unknown>> {
  const matches = [
    ...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g),
  ];
  return matches.map((match) => JSON.parse(match[1] ?? "") as Record<string, unknown>);
}

const SCREENSHOT_A = "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpeg";
const SCREENSHOT_B = "landing-pages/2026-08-10/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpeg";
const SCREENSHOT_C = "landing-pages/2026-08-20/cccccccccccccccccccccccccccccccc.jpeg";
const HTML_A = "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html";
const HTML_B = "landing-pages/2026-08-10/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.html";
const HTML_C = "landing-pages/2026-08-20/cccccccccccccccccccccccccccccccc.html";

function entry(overrides: Partial<OfferLedgerEntry> = {}): OfferLedgerEntry {
  return {
    id: "s1",
    capturedAt: "2026-08-01T10:00:00.000Z",
    dateLabel: "1 Aug 2026",
    canonicalUrl: "https://nykaa.com/glow",
    headline: "Glow serum",
    ctaText: "Shop now",
    priceText: "₹499",
    formPresent: true,
    screenshotHref: `/artifacts/proof/${encodeURIComponent(SCREENSHOT_A)}`,
    pageTextHref: `/artifacts/page-text/${encodeURIComponent(HTML_A)}`,
    evidenceNote: null,
    transition: null,
    runExtentLabel: null,
    ...overrides,
  };
}

const threeStates: OfferLedgerEntry[] = [
  entry(),
  entry({
    id: "s2",
    capturedAt: "2026-08-10T10:00:00.000Z",
    dateLabel: "10 Aug 2026",
    headline: "Festive glow kit",
    ctaText: "Get the kit",
    priceText: "₹799",
    screenshotHref: `/artifacts/proof/${encodeURIComponent(SCREENSHOT_B)}`,
    pageTextHref: `/artifacts/page-text/${encodeURIComponent(HTML_B)}`,
    transition: {
      headline: { before: "Glow serum", after: "Festive glow kit" },
      ctaText: { before: "Shop now", after: "Get the kit" },
      priceText: { before: "₹499", after: "₹799" },
      formPresent: null,
    },
  }),
  entry({
    id: "s3",
    capturedAt: "2026-08-20T10:00:00.000Z",
    dateLabel: "20 Aug 2026",
    headline: "Festive glow kit",
    ctaText: "Get the kit",
    priceText: "₹599",
    screenshotHref: `/artifacts/proof/${encodeURIComponent(SCREENSHOT_C)}`,
    pageTextHref: `/artifacts/page-text/${encodeURIComponent(HTML_C)}`,
    transition: {
      headline: null,
      ctaText: null,
      priceText: { before: "₹799", after: "₹599" },
      formPresent: null,
    },
  }),
];

function data(overrides: Partial<OfferTimelineLoaderData> = {}): OfferTimelineLoaderData {
  return {
    domain: "nykaa.com",
    brandName: "Nykaa",
    canonicalPath: "/timeline/nykaa.com",
    sharePath: "/timeline/nykaa.com",
    shareUrl: "https://0509.io/timeline/nykaa.com",
    shareEnabled: true,
    asOf: null,
    asOfState: null,
    entries: threeStates,
    archive: {
      subject: "nykaa.com",
      generatedAt: "2026-09-01T00:00:00.000Z",
      entries: [],
      gaps: [],
      adTenure: [],
      offerHistory: [],
      monthSummary: null,
    },
    sourceEvents: [],
    noindex: false,
    collecting: false,
    ...overrides,
  };
}

describe("/timeline/:domain render", () => {
  it("renders three dated offer states with screenshot and page-text links", async () => {
    const markup = await render(data());

    expect(markup).toContain("Every offer Nykaa has run since we started watching.");
    expect(markup).toContain("1 Aug 2026");
    expect(markup).toContain("10 Aug 2026");
    expect(markup).toContain("20 Aug 2026");
    expect(markup).toContain("Glow serum");
    expect(markup).toContain("Festive glow kit");
    expect(markup).toContain("₹499");
    expect(markup).toContain("₹599");
    expect(markup).toContain(`href="/artifacts/proof/${encodeURIComponent(SCREENSHOT_A)}"`);
    expect(markup).toContain(`href="/artifacts/proof/${encodeURIComponent(SCREENSHOT_B)}"`);
    expect(markup).toContain(`href="/artifacts/proof/${encodeURIComponent(SCREENSHOT_C)}"`);
    expect(markup).toContain(`href="/artifacts/page-text/${encodeURIComponent(HTML_A)}"`);
    expect(markup).toContain("Screenshot");
    expect(markup).toContain("Page text");
    expect(markup).toContain("First offer on record.");
    expect(markup).toContain("Headline");
    expect(markup).toContain("Glow serum");
    expect(markup).toContain("Festive glow kit");
  });

  it("renders a geo-variance suppressed state as 'Capture suppressed' not a transition or 'First offer' (issue #1996)", async () => {
    const suppressed = entry({
      id: "fr-08",
      capturedAt: "2026-09-08T00:00:00.000Z",
      dateLabel: "8 Sep 2026",
      canonicalUrl: "https://www.nike.com/fr/",
      headline: "Nike. Just Do It",
      ctaText: "En savoir plus sur les publicités personnalisées",
      priceText: "—",
      transition: null,
      suppressedReason: "geo locale change",
      screenshotHref: `/artifacts/proof/${encodeURIComponent(SCREENSHOT_B)}`,
      pageTextHref: `/artifacts/page-text/${encodeURIComponent(HTML_B)}`,
    });
    const markup = await render(data({ entries: [suppressed] }));

    // The suppressed state is named, not shown as a phantom change nor as the
    // misleading "First offer on record." text.
    expect(markup).toContain("Capture suppressed: geo locale change");
    expect(markup).not.toContain("First offer on record.");
    expect(markup).not.toContain("Headline");
    // Proof is still preserved.
    expect(markup).toContain(`href="/artifacts/proof/${encodeURIComponent(SCREENSHOT_B)}"`);
    expect(markup).toContain(`href="/artifacts/page-text/${encodeURIComponent(HTML_B)}"`);
  });

  it("links each dated state to its source URL with nofollow (accept #2)", async () => {
    const markup = await render(data());

    // Every entry points at the captured canonical URL the state came from.
    expect(markup.match(/Source: nykaa\.com/g)).toHaveLength(3);
    expect(markup).toContain('href="https://nykaa.com/glow"');
    expect(markup).toContain('rel="nofollow noreferrer"');
    // The source link never fakes a receipt; screenshot and page text remain.
    expect(markup).toContain(`href="/artifacts/proof/${encodeURIComponent(SCREENSHOT_A)}"`);
  });

  it("emits BreadcrumbList structured data on an indexable timeline (accept #6)", async () => {
    const markup = await render(data());
    const blocks = parseLdJsonBlocks(markup);

    const breadcrumb = blocks.find((block) => block["@type"] === "BreadcrumbList");
    expect(breadcrumb, "missing BreadcrumbList JSON-LD").not.toBeUndefined();
    expect(breadcrumb?.["@context"]).toBe("https://schema.org");
    const items = breadcrumb?.["itemListElement"] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://0509.io/",
    });
    expect(items[1]).toEqual({
      "@type": "ListItem",
      position: 2,
      name: "Nykaa offer timeline",
      item: "https://0509.io/timeline/nykaa.com",
    });

    // The WebPage block is still the page's other structured-data payload.
    const webPages = blocks.filter((block) => block["@type"] === "WebPage");
    expect(webPages).toHaveLength(1);
  });

  it("emits a citable Dataset JSON-LD on an indexable timeline (issue #964)", async () => {
    const markup = await render(data());
    const blocks = parseLdJsonBlocks(markup);

    const dataset = blocks.find((block) => block["@type"] === "Dataset");
    expect(dataset, "missing Dataset JSON-LD").not.toBeUndefined();
    expect(dataset?.["@context"]).toBe("https://schema.org");
    expect(dataset?.["name"]).toBe("Nykaa offer timeline");
    expect(dataset?.["url"]).toBe("https://0509.io/timeline/nykaa.com");
    expect(dataset?.["isAccessibleForFree"]).toBe(true);
    // datePublished = first stored snapshot, dateModified = last stored
    // snapshot — the same timestamps the visible ledger renders.
    expect(dataset?.["datePublished"]).toBe("2026-08-01T10:00:00.000Z");
    expect(dataset?.["dateModified"]).toBe("2026-08-20T10:00:00.000Z");
    // license is the operating terms the page footer links, not an invented
    // Creative Commons grant.
    expect(dataset?.["license"]).toBe("https://0509.io/terms");
    const distribution = dataset?.["distribution"] as Record<string, unknown>;
    expect(distribution?.["@type"]).toBe("DataDownload");
    expect(distribution?.["contentUrl"]).toBe("https://0509.io/timeline/nykaa.com");
    expect(distribution?.["encodingFormat"]).toBe("text/html");
    const creator = dataset?.["creator"] as Record<string, unknown>;
    expect(creator?.["name"]).toBe("Five to Nine");
  });

  it("emits neither JSON-LD block on a noindex timeline shell", async () => {
    const markup = await render(data({ noindex: true, entries: [] }));
    expect(markup).not.toContain("application/ld+json");
    expect(markup).not.toContain('"@type":"Dataset"');
  });

  it("renders an honest collecting page — no Dataset JSON-LD, no dated-ledger overclaim (issue #2021)", async () => {
    const markup = await render(
      data({ entries: [], collecting: true, noindex: false }),
    );
    // Indexable (WebPage present) but no citable Dataset: nothing is stored
    // yet, so there is no dataset to cite — the #964 Dataset would overclaim.
    expect(markup).toContain("application/ld+json");
    expect(markup).not.toContain('"@type":"Dataset"');
    // No "Dated offer states" hero/JSON-LD overclaim on a zero-state page.
    expect(markup).not.toContain("Dated offer states for nykaa.com");
    expect(markup).not.toContain("dated ledger of what this competitor's landing page said");
    // Honest collecting copy + a real link to the ads brand page remains.
    expect(markup).toContain("Collecting \u2014 no offer states recorded yet");
    expect(markup).toContain("We are collecting this competitor&#x27;s landing page now");
    expect(markup).toContain("Meta ads for nykaa.com");
  });

  it("renders the as-of offer and the share URL without requiring a login", async () => {
    const markup = await render(
      data({
        asOf: "2026-08-15",
        asOfState: threeStates[1] ?? null,
        sharePath: "/timeline/nykaa.com?asOf=2026-08-15",
        shareUrl: "https://0509.io/timeline/nykaa.com?asOf=2026-08-15",
      }),
    );

    expect(markup).toContain("As of 2026-08-15");
    expect(markup).toContain("Festive glow kit");
    expect(markup).toContain("Share this timeline");
    expect(markup).toContain("https://0509.io/timeline/nykaa.com?asOf=2026-08-15");
    expect(markup).toContain(`href="/artifacts/proof/${encodeURIComponent(SCREENSHOT_B)}"`);
    expect(markup).not.toContain("Sign in to view");
  });

  it("hides share chrome when the rollback flag is off", async () => {
    const markup = await render(data({ shareEnabled: false }));
    expect(markup).not.toContain("Share this timeline");
  });

  it("never overclaims a screenshot per state when a row has none (issues #1284, #1271)", async () => {
    const prooflessEntry = entry({
      id: "backfill-nike-20260715",
      capturedAt: "2026-07-15T09:00:00.000Z",
      dateLabel: "15 Jul 2026",
      canonicalUrl: "https://www.nike.com/",
      headline: "Nike. Just Do It.",
      ctaText: "Shop Now",
      priceText: null,
      formPresent: false,
      screenshotHref: null,
      pageTextHref: null,
      evidenceNote: "Captured on 15 Jul 2026, no screenshot",
      transition: null,
    });

    const timelineData = data({
      domain: "nike.com",
      brandName: "Nike",
      canonicalPath: "/timeline/nike.com",
      sharePath: "/timeline/nike.com",
      shareUrl: "https://0509.io/timeline/nike.com",
      entries: [prooflessEntry],
    });

    const markup = await render(timelineData);

    // The headline still renders (the data layer is what filters proof-less
    // rows; the component is defense-in-depth against the string itself).
    expect(markup).toContain("Nike. Just Do It.");
    // The "no screenshot" string must never appear on a public timeline page.
    expect(markup).not.toContain("no screenshot");
    expect(markup).not.toContain("Screenshot ·");
    expect(markup).not.toContain("Page text ·");
    // The intro must not promise a screenshot on every state.
    expect(markup).not.toContain("the screenshot and page text for each state");
    expect(markup).toContain("with page text and a screenshot when we stored one.");

    // The meta description must not promise a screenshot on every state either.
    const { meta } = await import("~/routes/timeline.$domain");
    const metas = meta({ loaderData: timelineData } as never) as Array<Record<string, string>>;
    const description = metas.find((m) => m.name === "description")?.content ?? "";
    expect(description).not.toContain("each with the stored screenshot and page text");
    expect(description).toContain("a screenshot when we stored one");
  });

  it("renders a collapsed run as one state with an honest run-extent note (issue #1957)", async () => {
    const collapsedEntry = entry({
      id: "calendly-burst-1",
      capturedAt: "2026-08-28T00:01:25.000Z",
      dateLabel: "28 Aug 2026",
      headline: "Brand Scaling Call - Adflex Digital",
      ctaText: "Show more",
      formPresent: false,
      transition: null,
      runExtentLabel: "unchanged since 28 Aug 2026",
    });

    const markup = await render(
      data({
        domain: "calendly.com",
        brandName: "Calendly",
        canonicalPath: "/timeline/calendly.com",
        sharePath: "/timeline/calendly.com",
        shareUrl: "https://0509.io/timeline/calendly.com",
        entries: [collapsedEntry],
      }),
    );

    // The collapse keeps the first capture's date as the visible state date.
    expect(markup).toContain("28 Aug 2026");
    // The run extent is shown honestly, not as repeated rows.
    expect(markup).toContain("unchanged since 28 Aug 2026");
    // A captured burst collapses to one row of the same offer.
    expect(markup.match(/Brand Scaling Call - Adflex Digital/g)).toHaveLength(1);
  });

  it("renders no run-extent note on a normal singleton state (issue #1957)", async () => {
    const markup = await render(data());
    expect(markup).not.toContain("unchanged since");
  });
});
