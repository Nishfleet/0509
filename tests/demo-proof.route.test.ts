import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const liveBrief = {
  status: "live",
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
      capturedAt: "2026-08-11T22:17:00.000Z",
    },
  ],
  insights: {
    topHooks: ["Routine-first bundle"],
    mediaMix: [{ channel: "Meta Ad Library", count: 4 }],
    timeline: ["Creative started running Aug 8, 09:00 AM", "Brief generated from 6 real captures"],
  },
  reportRows: ["What is captured: 4 of 6 cached creatives are active"],
};

function mockPublicProofBrief(returnValue: unknown) {
  vi.doMock("~/lib/public-proof.server", () => ({
    loadPublicProofBrief: vi.fn().mockResolvedValue(returnValue),
  }));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/public-proof.server");
});

describe("public proof brief API", () => {
  it("serves the real proof brief JSON when a live capture exists", async () => {
    mockPublicProofBrief(liveBrief);
    const { loader } = await import("~/routes/api.demo-proof");
    const response = await loader({
      request: new Request("https://0509.io/api/demo-proof"),
      context: { cloudflare: { env: {} } },
    } as never);
    const body = (await response.json()) as { status: string; proofTrail: unknown[] };

    // The payload is now visitor-country-scoped (issue #1468: the home brief
    // must read the SAME cache row its linked brand page reads), so a shared
    // cache must never serve one country's count to another visitor — private,
    // never public.
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(body.status).toBe("live");
    expect(body.proofTrail.length).toBeGreaterThanOrEqual(1);
  });

  it("serves the real proof brief markdown for agent and buyer review", async () => {
    mockPublicProofBrief(liveBrief);
    const { loader } = await import("~/routes/api.demo-proof");
    const response = await loader({
      request: new Request("https://0509.io/api/demo-proof?format=markdown"),
      context: { cloudflare: { env: {} } },
    } as never);
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(body).toContain("Status: live");
    expect(body).toContain("## Source Trail");
    expect(body).toContain("https://www.facebook.com/ads/library/?id=111");
    expect(body).not.toContain("sample only");
    expect(body).not.toContain("Illustrative");
  });

  it("states the unavailable state explicitly when no live capture exists", async () => {
    mockPublicProofBrief(null);
    const { loader } = await import("~/routes/api.demo-proof");
    const response = await loader({
      request: new Request("https://0509.io/api/demo-proof"),
      context: { cloudflare: { env: {} } },
    } as never);
    const body = (await response.json()) as { status: string; message: string };

    expect(body.status).toBe("unavailable");
    expect(body.message).toContain("No live proof capture is available right now");
    expect(JSON.stringify(body)).not.toContain("Nykaa weekly");
  });

  it("never serves sample fixture data as proof", async () => {
    mockPublicProofBrief(liveBrief);
    const { loader } = await import("~/routes/api.demo-proof");
    const response = await loader({
      request: new Request("https://0509.io/api/demo-proof"),
      context: { cloudflare: { env: {} } },
    } as never);
    const body = await response.text();

    expect(body).not.toContain("sample_only");
    expect(body).not.toContain("Illustrative —");
    expect(body).not.toContain("Not available in this sample");
  });
});
