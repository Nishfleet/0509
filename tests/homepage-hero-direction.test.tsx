import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const NOW = new Date("2026-08-26T00:19:48.000Z");

const proofBrief = {
  competitorName: "Nykaa",
  website: "nykaa.com",
  adLibraryCountry: "India",
  fetchedAt: "2026-08-22T10:46:00.000Z",
  checkedAgoLabel: "moments ago",
  freshForLiveClaim: false,
  adCount: 12,
  activeAdCount: 12,
  summary: "12 public Meta ads link to nykaa.com in the India Ad Library.",
  decision: {
    subject: "12 of 12 cached ads are active right now",
    whatChanged: 'The most repeated hook is "Unlock the secret to radiant skin".',
    whyItMatters: "These creatives are the angle Nykaa is testing in the Meta Ad Library.",
    priority: "Review before the next campaign refresh",
    proofStatus: "Captured from the India Ad Library on Aug 22, 10:46 AM",
    source: "Meta Ad Library (public archive) — the India Ad Library",
    freshness: "Checked moments ago — captured Aug 22, 10:46 AM",
    nextAction: "Open the same ad in the India Ad Library",
  },
  proofTrail: [
    {
      id: "ad-1:Ad hook",
      signal: "Ad hook",
      evidence: "Unlock the secret to radiant skin — Learn more",
      source: "Meta Ad Library — Nykaa Beauty",
      sourceUrl: "https://www.facebook.com/ads/library/?id=1",
      capturedAt: "2026-08-22",
    },
  ],
  insights: {
    topHooks: ["Unlock the secret to radiant skin"],
    mediaMix: [{ channel: "Meta Ad Library", count: 12 }],
    timeline: ["Creative started running Aug 22", "Brief generated from 12 real captures"],
  },
  reportRows: [
    "What is captured: 12 of 12 cached creatives are active",
    "Source trail: every row links to the same public India Ad Library page",
    "Next action: review the angle before your next campaign refresh",
  ],
};

function mockReactRouter(brief: unknown) {
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
        proofBrief: brief,
      }),
    };
  });
}

async function renderMarketing(): Promise<string> {
  const { default: MarketingRoute } = await import("~/routes/marketing");
  return renderToStaticMarkup(createElement(MarketingRoute));
}

function heroH1(markup: string): string {
  return markup.match(/<h1[^>]*ld-wall[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? "";
}

function proofStrip(markup: string): string {
  return markup.match(/<aside class="ld-proof-strip"[^>]*>[\s\S]*?<\/aside>/)?.[0] ?? "";
}

/** The `<span class="ld-row">` lines of the hero wall, in document order. */
function heroWallRows(h1: string): string[] {
  return Array.from(h1.matchAll(/<span class="ld-row[^"]*">/g)).map((match) => match[0]);
}

/** The inner HTML of a `class`-tagged span inside a rendered block. */
function spanBody(block: string, className: string): string {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    block.match(new RegExp(`<span class="${escaped}">([\\s\\S]*?)</span>`))?.[1] ?? ""
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

describe("BET 9 chosen hero direction (#1173)", () => {
  it("records Safe as the chosen direction", () => {
    const chosen = readFileSync("docs/design/hero-directions/CHOSEN.md", "utf8");
    // Structural: the doc names Safe, points at a numbered direction artifact,
    // and cites the issue that chose it — without pinning the exact filename
    // or issue number.
    expect(chosen).toMatch(/\*\*Safe\*\*/);
    expect(chosen).toMatch(/\b0\d-[a-z-]+\.html\b/);
    expect(chosen).toMatch(/#\d+/);
  });

  it("leads with the free live-search promise and shows the live flag when live Nykaa proof is present (#2170, #2313)", async () => {
    // Issue #2313 gates the "live" flag: it only renders when the loader's
    // heroProofLive is true, so a genuinely fresh live proof keeps the flag.
    mockReactRouter({ ...proofBrief, freshForLiveClaim: true });
    const markup = await renderMarketing();
    const h1 = heroH1(markup);

    // Structural shape of the wall (#2170): four ld-row lines, the third
    // carrying the indented callout, with the live flag only when the proof
    // is genuinely live. Copy is free to change without rewriting this test.
    expect(heroWallRows(h1)).toHaveLength(4);
    expect(h1).toContain('<span class="ld-row ld-row-indent">');
    expect(h1).toContain('<ins class="ld-ins">');
    expect(h1).toMatch(/<i class="ld-flag">live<\/i>/);
    // The wall never carries the proof hook, a proof quote, or a competitor address.
    expect(h1).not.toContain("ld-proof-quote");
    expect(h1).not.toContain(proofBrief.insights.topHooks[0]);
    expect(h1).not.toContain(proofBrief.website);
  });

  it("hides the live flag when the proof is not live (on record) but keeps the wall (#2313)", async () => {
    mockReactRouter(proofBrief);
    const markup = await renderMarketing();
    const h1 = heroH1(markup);

    expect(heroWallRows(h1)).toHaveLength(4);
    expect(h1).not.toMatch(/<i class="ld-flag">live<\/i>/);
  });

  it("uses the same live-search H1 when there is no live proof", async () => {
    mockReactRouter(proofBrief);
    const withProof = await renderMarketing();

    vi.resetModules();
    mockReactRouter(null);
    const empty = await renderMarketing();

    expect(heroH1(empty)).toBe(heroH1(withProof));
  });

  it("demotes live proof to a strip under the H1", async () => {
    mockReactRouter(proofBrief);
    const markup = await renderMarketing();
    const h1 = heroH1(markup);
    const strip = proofStrip(markup);

    expect(strip.length).toBeGreaterThan(0);
    expect(strip).toContain('data-proof-state="on-record"');
    // The strip renders the loader's real proof, not a canned sentence.
    expect(strip).toContain('class="ld-proof-quote"');
    expect(spanBody(strip, "ld-proof-quote")).toContain(proofBrief.insights.topHooks[0]);
    expect(spanBody(strip, "ld-proof-attrib")).toContain(proofBrief.website);
    expect(spanBody(strip, "ld-proof-attrib")).toContain(String(proofBrief.adCount));
    expect(strip).toContain(proofBrief.website);

    const h1Index = markup.indexOf(h1);
    const stripIndex = markup.indexOf(strip);
    expect(h1Index).toBeGreaterThan(-1);
    expect(stripIndex).toBeGreaterThan(h1Index);
  });

  it("renders an honest empty proof strip when no capture exists", async () => {
    mockReactRouter(null);
    const markup = await renderMarketing();
    const strip = proofStrip(markup);

    expect(heroWallRows(heroH1(markup))).toHaveLength(4);
    expect(strip).toContain('data-proof-state="empty"');
    // Honest empty state: no captured hook, no trail rows, no sample label.
    expect(strip).not.toContain(proofBrief.insights.topHooks[0]);
    expect(strip).not.toContain('class="ld-proof-trail"');
    expect(strip).not.toMatch(/\bsample\b|\billustrative\b/i);
  });
});
