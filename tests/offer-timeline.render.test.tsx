import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OfferTimelineLoaderData } from "~/routes/timeline.$domain";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";

let currentData: OfferTimelineLoaderData;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useLoaderData: () => currentData,
      useRouteLoaderData: () => undefined,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
    };
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
    noindex: false,
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
});
