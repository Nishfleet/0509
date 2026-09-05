import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OfferLedgerEntry } from "~/lib/offer-timeline";

const SCREENSHOT_A = "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpeg";
const SCREENSHOT_B = "landing-pages/2026-08-10/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpeg";
const SCREENSHOT_C = "landing-pages/2026-08-20/cccccccccccccccccccccccccccccccc.jpeg";
const HTML_A = "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html";
const HTML_B = "landing-pages/2026-08-10/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.html";
const HTML_C = "landing-pages/2026-08-20/cccccccccccccccccccccccccccccccccccc.html";

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

function createContext(env: Record<string, unknown>) {
  return {
    cloudflare: {
      env,
    },
  };
}

interface MockOptions {
  env?: Record<string, unknown>;
  entries?: OfferLedgerEntry[];
  rateLimitResponse?: Response | null;
}

function installMocks(options: MockOptions = {}) {
  const env = options.env ?? { DB: {} };
  const loadOfferTimeline = vi.fn().mockResolvedValue({
    entries: options.entries ?? [],
    asOfState: null,
  });
  const enforcePublicBrandPageRateLimit = vi
    .fn()
    .mockResolvedValue(options.rateLimitResponse ?? null);

  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/lib/cloudflare-context", () => ({
    getOptionalCloudflareContext: vi.fn(() => undefined),
  }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicBrandPageRateLimit,
  }));
  vi.doMock("~/lib/offer-timeline.server", () => ({
    loadOfferTimeline,
  }));

  return { env, loadOfferTimeline, enforcePublicBrandPageRateLimit };
}

async function runLoader(domain: string, env: Record<string, unknown>) {
  const { loader } = await import("~/routes/ads.$domain.timeline");
  return loader({
    context: createContext(env),
    params: { domain },
    request: new Request(`http://localhost/ads/${encodeURIComponent(domain)}/timeline`),
  } as never);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/cloudflare-context");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.doUnmock("~/lib/offer-timeline.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/ads/:domain/timeline JSON feed", () => {
  it("404s a malformed domain without touching D1", async () => {
    const mocks = installMocks({});
    const response = await runLoader("not a domain", mocks.env);

    expect(response.status).toBe(404);
    expect(mocks.loadOfferTimeline).not.toHaveBeenCalled();
    expect(mocks.enforcePublicBrandPageRateLimit).not.toHaveBeenCalled();
  });

  it("returns a JSON feed with timestamps, source URLs, and change types", async () => {
    const mocks = installMocks({ entries: threeStates });

    const response = await runLoader("nykaa.com", mocks.env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.version).toBe("https://jsonfeed.org/version/1.1");
    expect(body.title).toBe("Nykaa offer timeline");
    expect(body.home_page_url).toBe("https://0509.io/ads/nykaa.com");
    expect(body.feed_url).toBe("https://0509.io/ads/nykaa.com/timeline");
    expect(body._license).toBe("https://0509.io/terms");
    expect(body._datePublished).toBe("2026-08-01T10:00:00.000Z");
    expect(body._dateModified).toBe("2026-08-20T10:00:00.000Z");

    const items = body.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);

    const first = items[0] ?? {};
    expect(first.id).toBe("s1");
    expect(first.date_published).toBe("2026-08-01T10:00:00.000Z");
    expect(first.external_url).toBe("https://nykaa.com/glow");
    expect(first.title).toBe("Glow serum");
    expect(first._changeTypes).toEqual([]);

    const second = items[1] ?? {};
    expect(second._changeTypes).toEqual(["Landing-page copy", "CTA", "Price"]);
    expect(second._transition).toMatchObject({
      headline: { before: "Glow serum", after: "Festive glow kit" },
      ctaText: { before: "Shop now", after: "Get the kit" },
      priceText: { before: "₹499", after: "₹799" },
    });

    const third = items[2] ?? {};
    expect(third._changeTypes).toEqual(["Price"]);
    expect(third._transition).toMatchObject({
      priceText: { before: "₹799", after: "₹599" },
    });

    expect(mocks.loadOfferTimeline).toHaveBeenCalledWith(mocks.env, {
      domain: "nykaa.com",
      asOf: null,
    });
  });

  it("returns an empty feed for a valid domain with no stored timeline", async () => {
    const mocks = installMocks({ entries: [] });

    const response = await runLoader("allbirds.com", mocks.env);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.items).toEqual([]);
    expect(body._count).toBe(0);
  });

  it("passes through a rate-limit response when the bucket is exhausted", async () => {
    const limited = new Response("Too many requests", { status: 429 });
    installMocks({ rateLimitResponse: limited });

    const response = await runLoader("nykaa.com", { DB: {} });

    expect(response.status).toBe(429);
  });
});
