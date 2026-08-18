import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function mockReactRouter() {
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
  mockReactRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
  vi.doUnmock("~/lib/demo-proof");
});

describe("anonymous homepage sample brief", () => {
  it("renders a truthful non-empty value for every decision-summary proof field", async () => {
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
    expect(rows.find((row) => row.dt === "What changed")?.dd).toContain("Nykaa");
    expect(rows.find((row) => row.dt === "Urgency")?.dd).toContain("Review before next");
  });

  it("shows the explicit unavailable state for proof status instead of a verification claim", async () => {
    const markup = await renderMarketing();
    const rows = decisionSummaryRows(markup);

    expect(rows.find((row) => row.dt === "Proof status")?.dd).toBe(
      "Not available in this sample",
    );
    expect(markup).not.toContain("Verified evidence");
  });

  it("labels source and freshness as sample-bound", async () => {
    const markup = await renderMarketing();
    const rows = decisionSummaryRows(markup);

    expect(rows.find((row) => row.dt === "Source")?.dd).toContain("Sample sources");
    expect(rows.find((row) => row.dt === "Freshness")?.dd).toContain("Sample");
  });

  it("renders a non-empty source trail that is explicitly illustrative with no fake URLs", async () => {
    const markup = await renderMarketing();
    const items = sourceTrailItems(markup);

    expect(items.length).toBe(3);
    for (const item of items) {
      expect(item.strong.length).toBeGreaterThan(0);
      expect(item.text.length).toBeGreaterThan(0);
      expect(item.em.length).toBeGreaterThan(0);
      expect(item.em).toMatch(/^Illustrative — /);
    }
    const trailBlock = markup.match(/<ul class="ld-trail">[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(trailBlock.length).toBeGreaterThan(0);
    expect(trailBlock).not.toContain("<a ");
    expect(trailBlock).not.toContain("href=");
  });

  it("labels the whole trail as illustrative with the honest no-capture note", async () => {
    const markup = await renderMarketing();

    expect(markup).toContain("This sample trail is illustrative — no live captures are attached to this preview.");
    expect(markup).toContain("Saved watches attach real screenshots, page text, and original links.");
    expect(markup).toContain("ld-trail-note");
  });

  it("keeps the hero sample-brief strip honest about sample evidence", async () => {
    const markup = await renderMarketing();

    expect(markup).toContain("Sample evidence — no live captures attached. Next move ready by 05:09.");
    expect(markup).not.toContain("Screenshots saved");
  });

  it("renders the explicit unavailable state for every decision-summary field when the fixture is empty", async () => {
    const realDemoProof =
      await vi.importActual<typeof import("~/lib/demo-proof")>("~/lib/demo-proof");
    vi.doMock("~/lib/demo-proof", () => ({
      demoProof: {
        ...realDemoProof.demoProof,
        digestPreview: {
          ...realDemoProof.demoProof.digestPreview,
          whatChanged: "",
          whyItMatters: "",
          priority: "",
          proofStatus: "",
          source: "",
          freshness: "",
          recommendedMove: "",
        },
        proofTrail: realDemoProof.demoProof.proofTrail.map((item) => ({
          ...item,
          signal: "",
          evidence: "",
          source: "",
        })),
      },
    }));

    const markup = await renderMarketing();
    const rows = decisionSummaryRows(markup);

    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.dd).toBe("Not available in this sample");
    }
    expect(markup).not.toContain("Verified evidence");
    for (const item of sourceTrailItems(markup)) {
      expect(item.strong).toBe("Not available in this sample");
      expect(item.em).toBe("Not available in this sample");
    }
  });

  it("renders an empty fixture value as the explicit unavailable state", async () => {
    const { sampleProofValue } = await import("~/routes/marketing");

    expect(sampleProofValue("")).toBe("Not available in this sample");
    expect(sampleProofValue("   ")).toBe("Not available in this sample");
    expect(sampleProofValue("  A value  ")).toBe("A value");
  });

  it("renders the brief-export preview without leaking raw markdown syntax", async () => {
    const markup = await renderMarketing();

    expect(markup).toContain("Brief export");
    expect(markup).toContain("<strong>Nykaa changed the routine bundle angle</strong>");
    expect(markup).not.toContain("*Nykaa changed the routine bundle angle*");
    expect(markup).toContain("Priority: Review before next campaign refresh");
    expect(markup).toContain(
      "Sources: illustrative sample captures — landing-page snapshot, page text capture, Meta Ad Library capture",
    );
  });

  it("keeps the API digest-markdown fixture raw for /api/demo-proof", async () => {
    const { demoProof } = await import("~/lib/demo-proof");

    expect(demoProof.exports.digestMarkdown).toContain("*Nykaa changed the routine bundle angle*");
    expect(demoProof.exports.digestMarkdown).toContain("\nPriority:");
  });
});
