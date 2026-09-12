import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const realProofBrief = {
  competitorName: "Nykaa",
  website: "nykaa.com",
  adLibraryCountry: "India",
  fetchedAt: "2026-08-11T22:17:00.000Z",
  checkedAgoLabel: "about 4 hours ago",
  freshForLiveClaim: false,
  adCount: 6,
  activeAdCount: 4,
  summary:
    "6 public Meta ads link to nykaa.com in the India Ad Library. Every source below opens the same page any visitor can open.",
  decision: {
    subject: "4 of 6 cached ads are active on record",
    whatChanged: "The most repeated hook is “Routine-first bundle”, the CTA “Build your routine”.",
    whyItMatters:
      "These creatives are the angle Nykaa has on record in the Meta Ad Library — review the same pages before your next campaign refresh.",
    priority: "Review before the next campaign refresh",
    proofStatus: "Captured from the India Ad Library on Aug 11, 10:17 PM",
    source: "Meta Ad Library (public archive) — the India Ad Library",
    freshness: "Last checked about 4 hours ago — captured Aug 11, 10:17 PM",
    nextAction: "Open the same ad in the India Ad Library",
  },
  proofTrail: [
    {
      id: "ad-1:Ad hook",
      signal: "Ad hook",
      evidence: "Routine-first bundle — Build your routine",
      source: "Meta Ad Library — Nykaa Beauty",
      sourceUrl: "https://www.facebook.com/ads/library/?id=111",
      // Hours-ago clock instead of a hardcoded date: a fixed capture date
      // crosses the 30-day heroCaptureStale wall in PROOF_CAPTURE_FRESH_DAYS
      // (marketing.tsx) as real time passes and flips the attribution branch —
      // the time-bomb this fixture walked into on 2026-09-10. Keep the capture
      // fresh; withCaptureAge exercises the stale branch on purpose below.
      capturedAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
    },
    {
      id: "ad-2:Ad offer",
      signal: "Ad offer",
      evidence: "Up to 30% off this week",
      source: "Meta Ad Library — Nykaa Beauty",
      sourceUrl: "https://www.facebook.com/ads/library/?id=222",
      capturedAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
    },
  ],
  insights: {
    topHooks: ["Routine-first bundle", "Dermat approved", "Sale ending soon"],
    mediaMix: [
      { channel: "Meta Ad Library", count: 4 },
      { channel: "Landing pages", count: 2 },
    ],
    timeline: ["Creative started running Aug 8, 09:00 AM", "Brief generated from 6 real captures"],
  },
  reportRows: [
    "What is captured: 4 of 6 cached creatives are active",
    "Source trail: every row links to the same public India Ad Library page",
    "Next action: review the angle before your next campaign refresh",
  ],
};

function mockReactRouter(proofBrief: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useRouteLoaderData: vi.fn().mockReturnValue({
        pricingPlans: [],
        usageBundles: [],
        session: null,
      }),
      useLoaderData: vi.fn().mockReturnValue({
        pricingPreview: { available: false },
        commercialLaunch: {
          scoutSaleOpen: true,
          starterSaleOpen: true,
          agencySaleOpen: false,
        },
        proofBrief,
      }),
    };
  });
}

async function renderMarketing(): Promise<string> {
  const { default: MarketingRoute } = await import("~/routes/marketing");
  return renderToStaticMarkup(createElement(MarketingRoute));
}

function decisionSummaryRows(markup: string): Array<{ dt: string; dd: string }> {
  const firstDl = markup.match(/<dl>[\s\S]*?<\/dl>/)?.[0] ?? "";
  const divs = firstDl.match(/<div>[\s\S]*?<\/div>/g) ?? [];
  return divs.map((div) => ({
    dt: div.match(/<dt>(.*?)<\/dt>/)?.[1]?.trim() ?? "",
    dd: div.match(/<dd>(.*?)<\/dd>/)?.[1]?.trim() ?? "",
  }));
}

function sourceTrailItems(markup: string): Array<{ strong: string; text: string; em: string }> {
  const trailUl = markup.match(/<ul class="ld-trail">[\s\S]*?<\/ul>/)?.[0] ?? "";
  const items = trailUl.match(/<li>[\s\S]*?<\/li>/g) ?? [];
  return items.map((item) => ({
    strong: item.match(/<strong>(.*?)<\/strong>/)?.[1]?.trim() ?? "",
    text: item
      .replace(/<strong>[\s\S]*?<\/strong>/, "")
      .replace(/<[^>]+>/g, "")
      .trim(),
    em: item.match(/<em>(.*?)<\/em>/)?.[1]?.trim() ?? "",
  }));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

describe("anonymous homepage proof brief (real proof)", () => {
  it("renders a truthful non-empty value for every decision-summary field from real captures", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();
    const rows = decisionSummaryRows(markup);

    expect(rows.map((row) => row.dt)).toEqual([
      "What changed",
      "Why it matters",
      "Urgency",
      "Proof status",
      "Source",
      "Freshness",
      "Next action",
    ]);
    for (const row of rows) {
      expect(row.dd.length, `${row.dt} must not render blank`).toBeGreaterThan(0);
    }
    expect(rows.find((row) => row.dt === "What changed")?.dd).toContain("Routine-first bundle");
    expect(rows.find((row) => row.dt === "Proof status")?.dd).toContain("Captured from the India Ad Library");
    expect(rows.find((row) => row.dt === "Freshness")?.dd).toContain("about 4 hours ago");
  });

  it("never labels the brief or its evidence as sample or illustrative", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();

    expect(markup).not.toContain("Sample brief");
    expect(markup).not.toContain("Sample proof-backed");
    expect(markup).not.toContain("Sample morning brief");
    expect(markup).not.toContain("sample evidence");
    expect(markup).not.toContain("illustrative");
    expect(markup).not.toContain("no live captures are attached");
    expect(markup).not.toContain("Not available in this sample");
    expect(markup).not.toContain("birchandstone");
  });

  it("links every source-trail row to a real public source page", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();

    const items = sourceTrailItems(markup);
    expect(items.length).toBe(2);
    for (const item of items) {
      expect(item.strong.length).toBeGreaterThan(0);
      expect(item.text.length).toBeGreaterThan(0);
      expect(item.em).toContain("open the same page");
    }
    const trailBlock = markup.match(/<ul class="ld-trail">[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(trailBlock).toContain('href="https://www.facebook.com/ads/library/?id=111"');
    expect(trailBlock).toContain('href="https://www.facebook.com/ads/library/?id=222"');
  });

  it("states the trail is real and openable by the visitor", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();

    expect(markup).toContain("Every row above is a real capture.");
    expect(markup).toContain("ld-trail-note");
  });

  it("renders the honest no-live-proof state when no real capture exists", async () => {
    mockReactRouter(null);
    const markup = await renderMarketing();

    expect(markup).toContain("No live proof right now");
    expect(markup).toContain("We haven’t captured this competitor recently.");
    expect(markup).toContain("Run the search preview");
    expect(markup).not.toContain("Sample brief");
    expect(markup).not.toContain("illustrative");
    expect(markup).not.toContain("Verified evidence");
  });

  it("makes no fake time claims in the ticker when no proof exists", async () => {
    mockReactRouter(null);
    const markup = await renderMarketing();

    expect(markup).toContain("Proof-backed monitoring");
    expect(markup).toContain("No live proof yet");
    expect(markup).not.toMatch(/<b>(?:0\d|1\d|2[0-3]):\d{2}<\/b>/);
  });

  it("renders real capture clocks and the real proof label when proof exists", async () => {
    mockReactRouter(realProofBrief);
    const markup = await renderMarketing();

    expect(markup).toContain("Proof-backed brief");
    expect(markup).toContain('href="/capture-rules"');
    expect(markup).toContain("What we refuse to alert on");
    expect(markup).toContain("Proof brief");
    expect(markup).toContain("We saved the proof");
    expect(markup).toContain("Routine-first bundle");
    expect(markup).toContain("was the hook on 6 Meta ads");
  });
});

const DAY_MS = 86_400_000;
// PROOF_CAPTURE_FRESH_DAYS in marketing.tsx — the loader's existing
// freshness boundary: a capture older than 30 days is "on record".
const FRESH_BOUNDARY_DAYS = 30;

/** Clone the real proof brief with a capture clock relative to now so the
 *  hero wall's freshness gate can be exercised at a chosen age. */
function withCaptureAge(overrides: {
  hoursAgo?: number;
  daysAgo?: number;
  freshForLiveClaim?: boolean;
}) {
  const capturedAt =
    overrides.hoursAgo != null
      ? new Date(Date.now() - overrides.hoursAgo * 3_600_000).toISOString()
      : new Date(Date.now() - (overrides.daysAgo ?? 0) * DAY_MS).toISOString();
  return {
    ...realProofBrief,
    fetchedAt: capturedAt,
    freshForLiveClaim: overrides.freshForLiveClaim ?? false,
    proofTrail: realProofBrief.proofTrail.map((row, i) =>
      i === 0 ? { ...row, capturedAt } : row,
    ),
  };
}

describe("hero wall live flag freshness gate (issue #2313)", () => {
  it("renders no ld-flag when the proof capture is 16h old (on record, not live)", async () => {
    mockReactRouter(withCaptureAge({ hoursAgo: 16, freshForLiveClaim: false }));
    const markup = await renderMarketing();

    expect(markup).not.toContain("ld-flag");
    expect(markup).toContain("right now.");
  });

  it("renders the ld-flag at the loader's existing freshness boundary (30 days, PROOF_CAPTURE_FRESH_DAYS) when freshForLiveClaim is true", async () => {
    mockReactRouter(
      withCaptureAge({ daysAgo: FRESH_BOUNDARY_DAYS, freshForLiveClaim: true }),
    );
    const markup = await renderMarketing();

    expect(markup).toContain("ld-flag");
  });
});

/** Clone the real proof brief, attaching a real captured creative thumbnail
 *  URL to each proof-trail row so the hero shot cards can render real `<img>`. */
function withCreativeImages(urls: Array<string | null>) {
  return {
    ...realProofBrief,
    proofTrail: realProofBrief.proofTrail.map((row, i) => ({
      ...row,
      creativeImageUrl: urls[i] ?? null,
    })),
  };
}

describe("hero shot cards render the real captured creative (issue #2323)", () => {
  it("renders a real <img> for each trail row that carries a creativeImageUrl, inside the ld-shot link", async () => {
    mockReactRouter(
      withCreativeImages([
        "https://cdn.example.test/nykaa-creative-1.jpg",
        "https://cdn.example.test/nykaa-creative-2.jpg",
      ]),
    );
    const markup = await renderMarketing();

    // The shot cards are the ld-shot links; each must wrap a real creative img.
    const shotCards = markup.match(/<a[^>]*class="ld-shot"[^>]*>[\s\S]*?<\/a>/g) ?? [];
    expect(shotCards.length).toBeGreaterThanOrEqual(1);
    expect(markup).toContain('src="https://cdn.example.test/nykaa-creative-1.jpg"');
    expect(markup).toContain('src="https://cdn.example.test/nykaa-creative-2.jpg"');
    // The honest alt text names the brand the featured-proof loader resolved.
    expect(markup).toContain('alt="Ad creative from Nykaa"');
    // The existing "Open the same public page" link is preserved.
    expect(markup).toContain("Open the same public page");
    // The fake browser chrome (three-dot bar) is gone now that real creatives render.
    expect(markup).not.toContain("ld-shot-bar");
  });

  it("loads the first hero card eager and the rest lazy so the LCP image is not deferred", async () => {
    mockReactRouter(
      withCreativeImages([
        "https://cdn.example.test/nykaa-creative-1.jpg",
        "https://cdn.example.test/nykaa-creative-2.jpg",
      ]),
    );
    const markup = await renderMarketing();

    const imgs = markup.match(/<img[^>]*f9-ads-thumb-img[^>]*>/g) ?? [];
    expect(imgs.length).toBe(2);
    expect(imgs[0]).toContain('loading="eager"');
    expect(imgs[1]).toContain('loading="lazy"');
  });

  it("reserves fixed dimensions via the f9-ads-thumb aspect-ratio box so the creative never causes CLS", async () => {
    mockReactRouter(
      withCreativeImages(["https://cdn.example.test/nykaa-creative-1.jpg"]),
    );
    const markup = await renderMarketing();

    // The thumbnail sits in the f9-ads-thumb box (aspect-ratio: 16/10 in CSS),
    // which reserves space before the image bytes arrive — no layout shift.
    expect(markup).toContain('class="f9-ads-thumb"');
    expect(markup).toContain('class="f9-ads-thumb-img"');
  });

  it("renders the honest on-brand mock (no <img>) when a trail row has no captured creative", async () => {
    mockReactRouter(withCreativeImages([null, null]));
    const markup = await renderMarketing();

    expect(markup).not.toContain("f9-ads-thumb-img");
    // The mock still shows the real captured hook text, never a fake screenshot.
    expect(markup).toContain("f9-ads-thumb-mock");
    expect(markup).toContain("Routine-first bundle");
  });
});
