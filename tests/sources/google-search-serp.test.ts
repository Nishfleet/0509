import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { reserveDecodoBudget } from "~/lib/decodo-budget.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  SerpProvider,
  SerpResult,
  SerpUnavailable,
} from "~/lib/sources/google-search/serp-provider";
import type { DecodoSerpProviderDeps } from "~/lib/sources/google-search/serp-provider-decodo.server";
import { fetchGoogleSerp } from "~/lib/sources/google-search/google-serp.server";

// The budget helper is mocked so no test can touch KV. The default answer
// (`ok: true`, `no_kv`) mirrors the real helper when the DECODO_BUDGET binding
// is absent: the gate is open. Same mock as google-search-serp-provider.test.ts.
vi.mock("~/lib/decodo-budget.server", () => ({
  reserveDecodoBudget: vi.fn(async () => ({ ok: true, reason: "no_kv" })),
}));

// Call through to the real Decodo provider, but record the exact input object
// the selection module hands it. That pins `gl`/`hl` literally instead of
// inferring them from the request body the provider builds.
const decodo = vi.hoisted(() => ({
  searches: [] as Array<{ query: string; gl: "us"; hl: "en" }>,
}));

vi.mock("~/lib/sources/google-search/serp-provider-decodo.server", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/lib/sources/google-search/serp-provider-decodo.server")
    >();
  return {
    ...actual,
    createDecodoSerpProvider: (env: AppEnv, deps?: DecodoSerpProviderDeps): SerpProvider => {
      const provider = actual.createDecodoSerpProvider(env, deps);
      return {
        search: async (input: { query: string; gl: "us"; hl: "en" }) => {
          decodo.searches.push(input);
          return provider.search(input);
        },
      };
    },
  };
});

const FIXTURE_DIR = resolve(__dirname, "../fixtures/google-search");
const DECODO_SCRAPE_URL = "https://scraper-api.decodo.com/v2/scrape";
/** base64 of "test-auth". Not a credential: the captures carry no auth. */
const TEST_AUTH = "dGVzdC1hdXRo";
const FIXED_FETCHED_AT = "2026-09-11T09:00:00.000Z";
/** A distinctive organic row, so "came from the injected fetch" is provable. */
const ORGANIC_ROW = {
  pos: 1,
  title: "From the injected fetch",
  url: "https://www.example.com/injected",
  desc: "snippet from the injected body",
};

function env(patch: { SERP_PROVIDER?: string; DECODO_SCRAPER_AUTH?: string }): AppEnv {
  return patch as unknown as AppEnv;
}

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, name), "utf8");
}

/**
 * A minimal Decodo success envelope: `results[0].content.results.results` is
 * the only block this mapper requires, and every status field it can carry is
 * optional. See google-search-serp-provider.test.ts for the full synonym set.
 */
function decodoResponse(organic: unknown[], paid: unknown[] = []): Response {
  return new Response(
    JSON.stringify({ results: [{ content: { results: { results: { organic, paid } } } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/** A fetchImpl that answers every call from `factory` and records each call. */
function recordingFetch(factory: () => Response): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return factory();
  });
  return { fetchImpl: impl as unknown as typeof fetch, calls };
}

/** Narrow a result to the success shape, failing with the reason. */
function asSerp(result: SerpResult | SerpUnavailable): SerpResult {
  if ("unavailable" in result) {
    throw new Error(`expected a SerpResult, got ${result.reason}`);
  }
  return result;
}

describe("fetchGoogleSerp provider selection", () => {
  it("defaults to decodo when SERP_PROVIDER is unset", async () => {
    const { fetchImpl, calls } = recordingFetch(() => decodoResponse([ORGANIC_ROW]));

    const result = await fetchGoogleSerp(
      env({ DECODO_SCRAPER_AUTH: TEST_AUTH }),
      "nike",
      { fetchImpl, now: () => new Date(FIXED_FETCHED_AT) },
    );

    const serp = asSerp(result);
    expect(serp.provider).toBe("decodo");
    expect(serp.query).toBe("nike");
    expect(serp.fetched_at).toBe(FIXED_FETCHED_AT);
    // The values are exactly what the injected response carried, so the
    // organic block provably came from the injected fetch.
    expect(serp.organic).toEqual([
      {
        position: 1,
        domain: "example.com",
        title: "From the injected fetch",
        url: "https://www.example.com/injected",
        snippet: "snippet from the injected body",
      },
    ]);
    expect(serp.ads).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(DECODO_SCRAPE_URL);
  });

  it("resolves an explicit, blank or differently-cased decodo value to the same provider", async () => {
    for (const value of ["decodo", "DECODO", "  Decodo  ", "", "   "]) {
      const { fetchImpl } = recordingFetch(() => decodoResponse([ORGANIC_ROW]));

      const result = await fetchGoogleSerp(
        env({ SERP_PROVIDER: value, DECODO_SCRAPER_AUTH: TEST_AUTH }),
        "nike",
        { fetchImpl },
      );

      expect(asSerp(result).provider).toBe("decodo");
    }
  });

  it("throws the documented not-implemented error for gateway, with no fetch and no quota spend", async () => {
    vi.mocked(reserveDecodoBudget).mockClear();
    const { fetchImpl, calls } = recordingFetch(() => decodoResponse([ORGANIC_ROW]));

    // The throw is the contract, so it must not be swallowed into an
    // unavailable result, and it must happen before anything is spent.
    const pending = fetchGoogleSerp(
      env({ SERP_PROVIDER: "gateway", DECODO_SCRAPER_AUTH: TEST_AUTH }),
      "nike",
      { fetchImpl },
    );
    await expect(pending).rejects.toThrow(/not implemented/i);
    await expect(pending).rejects.toThrow('serp provider "gateway" is not implemented');

    expect(calls).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(vi.mocked(reserveDecodoBudget)).not.toHaveBeenCalled();
  });

  it("throws an unknown-provider error that names the value, with no fetch", async () => {
    for (const [value, named] of [
      ["bing", "bing"],
      ["  Bing  ", "bing"],
      ["duckduckgo", "duckduckgo"],
    ]) {
      const { fetchImpl, calls } = recordingFetch(() => decodoResponse([ORGANIC_ROW]));

      await expect(
        fetchGoogleSerp(env({ SERP_PROVIDER: value, DECODO_SCRAPER_AUTH: TEST_AUTH }), "nike", {
          fetchImpl,
        }),
      ).rejects.toThrow(`unknown serp provider "${named}"`);

      expect(calls).toHaveLength(0);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("hands the provider exactly { query, gl: us, hl: en } and passes a multi-word query through unchanged", async () => {
    decodo.searches.length = 0;
    const { fetchImpl, calls } = recordingFetch(() =>
      new Response(fixture("decodo-lawyer-query.json"), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchGoogleSerp(
      env({ SERP_PROVIDER: "decodo", DECODO_SCRAPER_AUTH: TEST_AUTH }),
      "personal injury lawyer",
      { fetchImpl },
    );

    expect(asSerp(result).organic).toHaveLength(9);
    // The literal input object is the contract.
    expect(decodo.searches).toEqual([
      { query: "personal injury lawyer", gl: "us", hl: "en" },
    ]);
    // And the query reaches the wire byte-for-byte, with the seam's fixed
    // US/English market.
    expect(calls[0].init?.body).toBe(
      '{"target":"google_search","query":"personal injury lawyer","parse":true,"geo":"United States","locale":"en-US"}',
    );
  });

  it("resolves to not_configured with no fetch and no budget reservation when DECODO_SCRAPER_AUTH is absent", async () => {
    for (const auth of [undefined, "", "   "]) {
      vi.mocked(reserveDecodoBudget).mockClear();
      const { fetchImpl, calls } = recordingFetch(() => decodoResponse([ORGANIC_ROW]));

      const result = await fetchGoogleSerp(env({ DECODO_SCRAPER_AUTH: auth }), "nike", {
        fetchImpl,
      });

      expect(result).toEqual({ unavailable: true, reason: "not_configured" });
      expect(calls).toHaveLength(0);
      expect(fetchImpl).not.toHaveBeenCalled();
      // The guard is the provider's own, not a duplicate in the selector.
      expect(vi.mocked(reserveDecodoBudget)).not.toHaveBeenCalled();
    }
  });
});
