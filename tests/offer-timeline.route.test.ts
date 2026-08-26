import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import type { OfferLedgerEntry } from "~/lib/offer-timeline";

const SCREENSHOT = "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpeg";
const HTML = "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html";

function createContext(env: Record<string, unknown>) {
  return {
    cloudflare: {
      env,
    },
  };
}

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
    screenshotHref: `/artifacts/proof/${encodeURIComponent(SCREENSHOT)}`,
    pageTextHref: `/artifacts/page-text/${encodeURIComponent(HTML)}`,
    transition: null,
    ...overrides,
  };
}

interface MockOptions {
  env?: Record<string, unknown>;
  entries?: OfferLedgerEntry[];
  asOfState?: OfferLedgerEntry | null;
  rateLimitResponse?: Response | null;
  loadError?: Error;
}

function installMocks(options: MockOptions = {}) {
  const env = options.env ?? { DB: {} };
  const loadOfferTimeline = options.loadError
    ? vi.fn().mockRejectedValue(options.loadError)
    : vi.fn().mockResolvedValue({
        entries: options.entries ?? [entry(), entry({ id: "s2" }), entry({ id: "s3" })],
        asOfState: options.asOfState === undefined ? null : options.asOfState,
      });
  const enforcePublicBrandPageRateLimit = vi
    .fn()
    .mockResolvedValue(options.rateLimitResponse ?? null);

  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicBrandPageRateLimit,
  }));
  vi.doMock("~/lib/offer-timeline.server", () => ({
    loadOfferTimeline,
    isOfferTimelineShareEnabled: (appEnv: { PUBLIC_OFFER_TIMELINE_SHARE?: string }) =>
      appEnv.PUBLIC_OFFER_TIMELINE_SHARE?.trim() !== "0",
  }));

  return { env, loadOfferTimeline, enforcePublicBrandPageRateLimit };
}

async function runLoader(domain: string, url: string, env: Record<string, unknown>) {
  const { loader } = await import("~/routes/timeline.$domain");
  return loader({
    context: createContext(env),
    params: { domain },
    request: new Request(url),
  } as never);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.doUnmock("~/lib/offer-timeline.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/timeline/:domain loader", () => {
  it("returns three dated states from stored snapshots without requiring a session", async () => {
    const first = entry();
    const second = entry({
      id: "s2",
      capturedAt: "2026-08-10T10:00:00.000Z",
      dateLabel: "10 Aug 2026",
      headline: "Festive glow kit",
      screenshotHref: `/artifacts/proof/${encodeURIComponent("landing-pages/2026-08-10/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpeg")}`,
      transition: {
        headline: { before: "Glow serum", after: "Festive glow kit" },
        ctaText: null,
        priceText: null,
        formPresent: null,
      },
    });
    const third = entry({
      id: "s3",
      capturedAt: "2026-08-20T10:00:00.000Z",
      dateLabel: "20 Aug 2026",
      headline: "Festive glow kit",
      priceText: "₹599",
    });
    const mocks = installMocks({ entries: [first, second, third] });

    const result = await runLoader(
      "nykaa.com",
      "https://0509.io/timeline/nykaa.com",
      mocks.env,
    );

    expect(result.domain).toBe("nykaa.com");
    expect(result.entries).toHaveLength(3);
    expect(result.entries.every((item) => item.screenshotHref?.startsWith("/artifacts/proof/"))).toBe(
      true,
    );
    expect(result.sharePath).toBe("/timeline/nykaa.com");
    expect(result.shareUrl).toBe("https://0509.io/timeline/nykaa.com");
    expect(result.shareEnabled).toBe(true);
    expect(result.noindex).toBe(false);
    expect(mocks.enforcePublicBrandPageRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.loadOfferTimeline).toHaveBeenCalledWith(mocks.env, {
      domain: "nykaa.com",
      asOf: null,
    });
  });

  it("returns the offer state as of a given date", async () => {
    const asOfState = entry({ id: "s2", headline: "Festive glow kit" });
    const mocks = installMocks({
      entries: [entry(), asOfState, entry({ id: "s3" })],
      asOfState,
    });

    const result = await runLoader(
      "nykaa.com",
      "https://0509.io/timeline/nykaa.com?asOf=2026-08-15",
      mocks.env,
    );

    expect(result.asOf).toBe("2026-08-15");
    expect(result.asOfState?.id).toBe("s2");
    expect(result.sharePath).toBe("/timeline/nykaa.com?asOf=2026-08-15");
    expect(result.shareUrl).toBe("https://0509.io/timeline/nykaa.com?asOf=2026-08-15");
    expect(mocks.loadOfferTimeline).toHaveBeenCalledWith(mocks.env, {
      domain: "nykaa.com",
      asOf: "2026-08-15",
    });
  });

  it("hides share-link chrome when the rollback flag is off", async () => {
    const mocks = installMocks({
      env: { DB: {}, PUBLIC_OFFER_TIMELINE_SHARE: "0" },
    });

    const result = await runLoader(
      "nykaa.com",
      "https://0509.io/timeline/nykaa.com",
      mocks.env,
    );

    expect(result.shareEnabled).toBe(false);
  });

  it("404s an unparseable domain before touching D1", async () => {
    const mocks = installMocks();

    await expect(
      runLoader("not a domain", "https://0509.io/timeline/not%20a%20domain", mocks.env),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.loadOfferTimeline).not.toHaveBeenCalled();
  });

  it("degrades to an empty noindex ledger when the snapshot read fails", async () => {
    const mocks = installMocks({ loadError: new Error("d1_unavailable") });

    const result = await runLoader(
      "nykaa.com",
      "https://0509.io/timeline/nykaa.com",
      mocks.env,
    );

    expect(result.entries).toEqual([]);
    expect(result.noindex).toBe(true);
  });
});

describe("/timeline/:domain source contract", () => {
  it("is registered as a public route and never imports a session guard", () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain('route("timeline/:domain", "routes/timeline.$domain.tsx")');

    const source = readFileSync("app/routes/timeline.$domain.tsx", "utf8");
    expect(source).not.toMatch(/requireSession|getSession|requireUser|getOptionalSession/);
  });
});
