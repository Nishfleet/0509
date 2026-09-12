import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reserveDecodoBudget } from "~/lib/decodo-budget.server";
import type { AppEnv } from "~/lib/env.server";
import { evaluatePresenceSourceCoverage } from "~/lib/presence-source-coverage.server";
import { GoogleSearchSection } from "~/components/sources/google-search";
import { getSourceAdapter } from "~/lib/sources/registry.server";
import { getLatestSourceSnapshot } from "~/lib/sources/run.server";
import {
  buildSnapshotPayload,
  type GoogleSerpSnapshotPayload,
} from "~/lib/sources/google-search/google-serp-snapshot.server";
import type { SourceFetchResult, SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";

/**
 * Adapter tests for the Google Search source — issue #2181.
 *
 * The fetch path is exercised end to end: the real
 * `fetchGoogleSerp` -> Decodo provider -> `mapDecodoResponse` chain runs
 * against a stubbed `globalThis.fetch`, and the real snapshot builder/diff
 * run. Only three boundaries are mocked (the linkedin/hiring pattern of
 * mocking the module at the boundary the adapter calls):
 *   - `~/lib/data/watchlists-core.server` `getWatchlist` -> D1 watchlist read
 *   - `~/lib/sources/run.server` `getLatestSourceSnapshot` -> prev snapshot
 *   - `~/lib/decodo-budget.server` `reserveDecodoBudget` -> monthly quota
 */

// --- Mocked seam state ----------------------------------------------------

let watchlist: { targetId: string } | null;
let latestSnapshot: SourceSnapshotRecord | null;
let budgetOk: boolean;
let fetchCalls: Array<{ url: string; init: RequestInit | undefined }>;
let fetchFactory: () => Response;

vi.mock("~/lib/data/watchlists-core.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/data/watchlists-core.server")>();
  return {
    ...actual,
    // Only `targetId` is read by the adapter; the record shape is cast loose
    // so the fixture stays one field deep.
    getWatchlist: vi.fn(async () => watchlist),
  };
});

// The adapter resolves this reader lazily (cycle safety); the mock answers it
// the same way either way. Only `getLatestSourceSnapshot` is imported from
// run.server anywhere in this test's module graph.
vi.mock("~/lib/sources/run.server", () => ({
  getLatestSourceSnapshot: vi.fn(async () => latestSnapshot),
}));

vi.mock("~/lib/decodo-budget.server", () => ({
  reserveDecodoBudget: vi.fn(async () =>
    budgetOk
      ? { ok: true, reason: "no_kv" }
      : { ok: false, reason: "quota", used: 1500, limit: 1500 },
  ),
}));

const { googleSearchAdapter } = await import("~/lib/sources/google-search.server");

// --- Fixtures --------------------------------------------------------------

/** base64 of "test-auth". Not a credential: the captures carry no auth. */
const TEST_AUTH = "dGVzdC1hdXRo";

const ORGANIC_ROW = {
  pos: 1,
  title: "Nike Official",
  url: "https://nike.com/",
  desc: "Just do it.",
};

const PAID_ROW = {
  pos: 1,
  url: "https://adidas.com/",
  url_shown: "www.adidas.com",
  title: "Adidas",
  desc: "Shop the latest.",
};

function makeWatchlist(targetId: string): { targetId: string } {
  // The adapter reads only `targetId` off the record getWatchlist returns.
  return { targetId };
}

function env(patch: Record<string, unknown> = {}): AppEnv {
  return { DECODO_SCRAPER_AUTH: TEST_AUTH, ...patch } as unknown as AppEnv;
}

/** A minimal Decodo success envelope (same shape as google-search-serp.test.ts). */
function decodoResponse(organic: unknown[], paid: unknown[] = []): Response {
  return new Response(
    JSON.stringify({ results: [{ content: { results: { results: { organic, paid } } } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function snapshotRecord(
  payload: GoogleSerpSnapshotPayload,
  fetchedAt = "2000-01-01T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
): SourceSnapshotRecord {
  return {
    id: "snap-1",
    watchlistId: "wl-1",
    sourceId: "google",
    fetchedAt,
    payload,
    createdAt: fetchedAt,
  };
}

const competitor = { competitorId: "wl-1", competitorLabel: "Nike" };

/** Narrow a fetch result to the success shape, failing with the reason. */
function asSnapshot(result: SourceFetchResult): SourceSnapshotInput {
  if (result.unavailable === true) {
    throw new Error(`expected snapshot, got ${result.reason}`);
  }
  return result;
}

// --- Tests ----------------------------------------------------------------

describe("googleSearchAdapter", () => {
  beforeEach(() => {
    watchlist = makeWatchlist("https://nike.com");
    latestSnapshot = null;
    budgetOk = true;
    fetchCalls = [];
    fetchFactory = () => decodoResponse([ORGANIC_ROW], [PAID_ROW]);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      fetchCalls.push({ url: String(input), init });
      return fetchFactory();
    });
    vi.mocked(reserveDecodoBudget).mockClear();
    vi.mocked(getLatestSourceSnapshot).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports the identity the seam registry and coverage rule depend on", () => {
    expect(googleSearchAdapter.id).toBe("google");
    expect(googleSearchAdapter.label).toBe("Google Search");
    expect(googleSearchAdapter.kind).toBe("search");
    expect(googleSearchAdapter.cadence).toBe("daily");
    expect(googleSearchAdapter.implemented).toBe(true);
    expect(googleSearchAdapter.Section).toBe(GoogleSearchSection);
    expect(getSourceAdapter("google")).toBe(googleSearchAdapter);
  });

  it("requiresEnv is true only for the decodo provider with a non-empty token", () => {
    expect(googleSearchAdapter.requiresEnv(env())).toBe(true);
    expect(googleSearchAdapter.requiresEnv(env({ SERP_PROVIDER: "decodo" }))).toBe(true);
    expect(googleSearchAdapter.requiresEnv(env({ SERP_PROVIDER: "  Decodo  " }))).toBe(true);
    expect(googleSearchAdapter.requiresEnv(env({ SERP_PROVIDER: "" }))).toBe(true);
    // No credential -> not configured.
    expect(googleSearchAdapter.requiresEnv({} as AppEnv)).toBe(false);
    expect(googleSearchAdapter.requiresEnv(env({ DECODO_SCRAPER_AUTH: undefined }))).toBe(false);
    expect(googleSearchAdapter.requiresEnv(env({ DECODO_SCRAPER_AUTH: "   " }))).toBe(false);
    // A provider that cannot serve fetches must not claim coverage.
    expect(googleSearchAdapter.requiresEnv(env({ SERP_PROVIDER: "gateway" }))).toBe(false);
    expect(googleSearchAdapter.requiresEnv(env({ SERP_PROVIDER: "bogus" }))).toBe(false);
  });

  it("flips the seam's coverage state with and without DECODO_SCRAPER_AUTH", async () => {
    const configured = await evaluatePresenceSourceCoverage(env(), "google", "competitor");
    expect(configured.status).toBe("configured");
    expect(configured.coverageLabel).toBe("OFFICIAL_PUBLIC_API");

    const missing = await evaluatePresenceSourceCoverage({} as AppEnv, "google", "competitor");
    expect(missing.status).toBe("coming_soon");
    expect(missing.reasonCode).toBe("not_implemented");
  });

  it("fetch returns watchlist_not_found without touching the provider", async () => {
    watchlist = null;
    const result = await googleSearchAdapter.fetch(env(), competitor);
    expect(result).toEqual({ unavailable: true, reason: "watchlist_not_found" });
    expect(vi.mocked(getLatestSourceSnapshot)).not.toHaveBeenCalled();
    expect(vi.mocked(reserveDecodoBudget)).not.toHaveBeenCalled();
    expect(fetchCalls).toHaveLength(0);
  });

  it("fetch returns no_domain when the watchlist target has no registrable domain", async () => {
    watchlist = makeWatchlist("https://localhost");
    const result = await googleSearchAdapter.fetch(env(), competitor);
    expect(result).toEqual({ unavailable: true, reason: "no_domain" });
    expect(vi.mocked(reserveDecodoBudget)).not.toHaveBeenCalled();
    expect(fetchCalls).toHaveLength(0);
  });

  it("fetch passes a provider unavailable through verbatim (quota)", async () => {
    budgetOk = false;
    const result = await googleSearchAdapter.fetch(env(), competitor);
    expect(result).toEqual({ unavailable: true, reason: "quota" });
    // The provider's reserve-before-request order holds through the adapter:
    // a denied month spends zero requests.
    expect(vi.mocked(reserveDecodoBudget)).toHaveBeenCalledTimes(1);
    expect(fetchCalls).toHaveLength(0);
  });

  it("fetch passes a decodo transport failure through verbatim", async () => {
    fetchFactory = () => new Response("upstream error", { status: 503 });
    const result = await googleSearchAdapter.fetch(env(), competitor);
    expect(result).toEqual({ unavailable: true, reason: "decodo_http_503" });
  });

  it("fetch returns not_configured when the token is absent, with no quota spend", async () => {
    const result = await googleSearchAdapter.fetch(env({ DECODO_SCRAPER_AUTH: "" }), competitor);
    expect(result).toEqual({ unavailable: true, reason: "not_configured" });
    expect(vi.mocked(reserveDecodoBudget)).not.toHaveBeenCalled();
    expect(fetchCalls).toHaveLength(0);
  });

  it("fetch surfaces a thrown fetchGoogleSerp as serp_provider_config", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await googleSearchAdapter.fetch(env({ SERP_PROVIDER: "bogus" }), competitor);
    expect(result).toEqual({ unavailable: true, reason: "serp_provider_config" });
    // The throw is logged once (the seam swallows it otherwise) and the log
    // carries the provider name, never a credential.
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0].map(String).join(" ");
    expect(logged).toContain('unknown serp provider "bogus"');
    expect(logged).not.toContain(TEST_AUTH);
    expect(fetchCalls).toHaveLength(0);
    expect(vi.mocked(reserveDecodoBudget)).not.toHaveBeenCalled();
  });

  it("fetch gates to one SERP per UTC calendar day, before any quota is spent", async () => {
    latestSnapshot = snapshotRecord(
      buildSnapshotPayload({
        domain: "nike.com",
        query: "Nike",
        provider: "decodo",
        fetchedAt: new Date().toISOString(),
        ads: [],
        organic: [],
        prev: null,
      }),
      new Date().toISOString(),
    );

    const result = await googleSearchAdapter.fetch(env(), competitor);
    expect(result).toEqual({ unavailable: true, reason: "daily_gate" });
    // The gate is the whole point: no Decodo reservation, no request.
    expect(vi.mocked(getLatestSourceSnapshot)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getLatestSourceSnapshot)).toHaveBeenCalledWith(env(), "wl-1", "google");
    expect(vi.mocked(reserveDecodoBudget)).not.toHaveBeenCalled();
    expect(fetchCalls).toHaveLength(0);
  });

  it("fetch runs when the previous snapshot is from a different UTC day", async () => {
    latestSnapshot = snapshotRecord(
      buildSnapshotPayload({
        domain: "nike.com",
        query: "Nike",
        provider: "decodo",
        fetchedAt: "2000-01-01T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
        ads: [],
        organic: [
          { position: 7, domain: "nike.com", title: "Nike", url: "https://nike.com/", snippet: "" },
        ],
        prev: null,
      }),
    );

    const result = asSnapshot(await googleSearchAdapter.fetch(env(), competitor));
    const payload = result.payload as GoogleSerpSnapshotPayload;

    expect(payload.domain).toBe("nike.com");
    expect(payload.query).toBe("Nike");
    expect(payload.provider).toBe("decodo");
    expect(typeof payload.fetchedAt).toBe("string");
    expect(payload.sponsoredAdvertisers).toEqual(["adidas.com"]);
    expect(payload.organic).toHaveLength(1);
    expect(payload.organic[0]).toMatchObject({
      position: 1,
      domain: "nike.com",
      url: "https://nike.com/",
      // prevPosition wired from the stored snapshot's same-url row.
      prevPosition: 7,
    });

    // One SERP request, one budget reservation, one snapshot read.
    expect(fetchCalls).toHaveLength(1);
    expect(vi.mocked(reserveDecodoBudget)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getLatestSourceSnapshot)).toHaveBeenCalledTimes(1);
  });

  it("fetch uses the competitor label as the query, else the domain stem", async () => {
    const labeled = await googleSearchAdapter.fetch(env(), competitor);
    if ("unavailable" in labeled) throw new Error("expected snapshot");
    expect(JSON.parse(String(fetchCalls[0].init?.body))).toMatchObject({ query: "Nike" });

    fetchCalls = [];
    const unlabeled = await googleSearchAdapter.fetch(env(), {
      competitorId: "wl-1",
      competitorLabel: "   ",
    });
    if ("unavailable" in unlabeled) throw new Error("expected snapshot");
    // "nike.com" -> displayNameFromDomain -> "Nike".
    expect(JSON.parse(String(fetchCalls[0].init?.body))).toMatchObject({ query: "Nike" });
    expect((unlabeled.payload as GoogleSerpSnapshotPayload).query).toBe("Nike");
  });

  it("diff delegates to diffGoogleSerpSnapshots: baseline -> [], new advertiser -> ad_new", () => {
    const prevPayload = buildSnapshotPayload({
      domain: "nike.com",
      query: "Nike",
      provider: "decodo",
      fetchedAt: "2000-01-01T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
      ads: [
        {
          position: 1,
          advertiser_domain: "adidas.com",
          title: "Adidas",
          url: "https://adidas.com/",
          snippet: "",
        },
      ],
      organic: [
        { position: 1, domain: "nike.com", title: "Nike", url: "https://nike.com/", snippet: "" },
      ],
      prev: null,
    });
    const next: SourceSnapshotInput = {
      payload: buildSnapshotPayload({
        domain: "nike.com",
        query: "Nike",
        provider: "decodo",
        fetchedAt: "2000-01-02T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
        ads: [
          {
            position: 1,
            advertiser_domain: "adidas.com",
            title: "Adidas",
            url: "https://adidas.com/",
            snippet: "",
          },
          {
            position: 2,
            advertiser_domain: "puma.com",
            title: "Puma",
            url: "https://puma.com/",
            snippet: "",
          },
        ],
        organic: [
          { position: 1, domain: "nike.com", title: "Nike", url: "https://nike.com/", snippet: "" },
        ],
        prev: null,
      }),
    };

    expect(googleSearchAdapter.diff(null, next)).toEqual([]);

    const changes = googleSearchAdapter.diff(snapshotRecord(prevPayload), next);
    expect(changes.length).toBeGreaterThan(0);
    const added = changes.find((c) => c.metadata.category === "new_sponsored_advertisers");
    expect(added).toBeDefined();
    expect(added?.eventType).toBe("ad_new");
    expect(added?.metadata.advertiserDomains).toEqual(["puma.com"]);
  });
});
