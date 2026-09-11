import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { reserveDecodoBudget } from "~/lib/decodo-budget.server";
import type { AppEnv } from "~/lib/env.server";
import type { SerpResult, SerpUnavailable } from "~/lib/sources/google-search/serp-provider";
import {
  DECODO_SERP_DEFAULT_TIMEOUT_MS,
  buildDecodoRequestBody,
  createDecodoSerpProvider,
  mapDecodoResponse,
} from "~/lib/sources/google-search/serp-provider-decodo.server";

// The budget helper is mocked so no test can touch KV. The default answer
// (`ok: true`, `no_kv`) mirrors the real helper when the DECODO_BUDGET binding
// is absent: the gate is open. The one denying test overrides a single call.
vi.mock("~/lib/decodo-budget.server", () => ({
  reserveDecodoBudget: vi.fn(async () => ({ ok: true, reason: "no_kv" })),
}));

const FIXTURE_DIR = resolve(__dirname, "../fixtures/google-search");
const DECODO_SCRAPE_URL = "https://scraper-api.decodo.com/v2/scrape";
/** base64 of "test-auth". Not a credential: the captures carry no auth. */
const TEST_AUTH = "dGVzdC1hdXRo";
const FIXED_FETCHED_AT = "2026-09-11T09:00:00.000Z";
const NIKE_INPUT: { query: string; gl: "us"; hl: "en" } = { query: "nike", gl: "us", hl: "en" };
const LAWYER_INPUT: { query: string; gl: "us"; hl: "en" } = {
  query: "personal injury lawyer",
  gl: "us",
  hl: "en",
};

const env = { DECODO_SCRAPER_AUTH: TEST_AUTH } as unknown as AppEnv;

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, name), "utf8");
}

/** The parts of a captured Decodo body these assertions read. */
interface CapturedDecodo {
  results: Array<{
    status_code?: number;
    content?: {
      status_code?: number;
      errors?: unknown[];
      results?: {
        parse_status_code?: number;
        results?: {
          organic?: Array<{ desc?: string; url?: string }>;
          paid?: unknown[];
        };
      };
    };
  }>;
}

function capture(name: string): CapturedDecodo {
  return JSON.parse(fixture(name)) as CapturedDecodo;
}

function capturedOrganic(json: CapturedDecodo): Array<{ desc?: string; url?: string }> {
  return json.results[0]?.content?.results?.results?.organic ?? [];
}

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/** A fetchImpl that answers every call from `factory` and records each call.
 * `factory` runs per call, so a response body is never read twice. */
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

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

/** Narrow a provider result to the success shape, failing with the reason. */
function asSerp(result: SerpResult | SerpUnavailable): SerpResult {
  if ("unavailable" in result) {
    throw new Error(`expected a SerpResult, got ${result.reason}`);
  }
  return result;
}

/**
 * A synthetic Decodo success envelope. Synthetic because every live capture
 * only ever shows `status_code` 200 with `parse_status_code` 12000,
 * `content.status_code` 12000, an empty `content.errors` and an empty `paid`
 * list; the branches below cannot be reached from a capture.
 */
function decodoBody(
  blocks: Record<string, unknown>,
  overrides: {
    status?: number;
    parseStatus?: number | null;
    contentStatus?: number | null;
    contentErrors?: unknown[];
  } = {},
): unknown {
  return {
    results: [
      {
        ...(overrides.status === undefined ? {} : { status_code: overrides.status }),
        content: {
          ...(overrides.contentStatus === null
            ? {}
            : { status_code: overrides.contentStatus ?? 12_000 }),
          ...(overrides.contentErrors === undefined ? {} : { errors: overrides.contentErrors }),
          results: {
            ...(overrides.parseStatus === null
              ? {}
              : { parse_status_code: overrides.parseStatus ?? 12_000 }),
            results: blocks,
          },
        },
      },
    ],
  };
}

const MAP_INPUT = { query: "nike", fetchedAt: FIXED_FETCHED_AT };

describe("buildDecodoRequestBody", () => {
  it("builds the documented google_search body and never sends proxy_pool", () => {
    const raw = buildDecodoRequestBody("nike");

    expect(Object.keys(JSON.parse(raw) as Record<string, unknown>).sort()).toEqual([
      "geo",
      "locale",
      "parse",
      "query",
      "target",
    ]);
    expect(JSON.parse(raw)).toEqual({
      target: "google_search",
      query: "nike",
      parse: true,
      geo: "United States",
      locale: "en-US",
    });
    // The live API answers HTTP 400 to this key for the google_search target.
    // See tests/fixtures/google-search/decodo-error-400-proxy-pool.json.
    expect(raw).not.toContain("proxy_pool");
  });
});

describe("createDecodoSerpProvider on the live captures", () => {
  it("maps the nike capture to 6 organic rows, www stripped, snippet from desc, no ads", async () => {
    const body = fixture("decodo-nike.json");
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(body));

    const result = await createDecodoSerpProvider(env, {
      fetchImpl,
      now: () => new Date(FIXED_FETCHED_AT),
    }).search(NIKE_INPUT);

    const serp = asSerp(result);
    expect(serp.query).toBe("nike");
    expect(serp.provider).toBe("decodo");
    expect(serp.fetched_at).toBe(FIXED_FETCHED_AT);
    expect(serp.organic).toHaveLength(6);
    expect(serp.organic[0].position).toBe(1);
    expect(serp.organic[0].domain).toBe("nike.com");
    expect(serp.organic[0].snippet).toBe(capturedOrganic(capture("decodo-nike.json"))[0]?.desc);
    expect(serp.organic[0].url).toBe(capturedOrganic(capture("decodo-nike.json"))[0]?.url);
    expect(serp.ads).toEqual([]);
    expect(calls).toHaveLength(1);
    // The fixture is committed, so it never carries the Google Shopping
    // `popular_products` block: its product `token` fields trip the Gitleaks
    // generic-api-key rule. The mapper ignores that block by contract.
    expect(body).not.toContain("popular_products");
    // The auth token goes on the wire and nowhere else.
    expect(JSON.stringify(serp)).not.toContain(TEST_AUTH);
  });

  it("maps the personal injury lawyer capture to 9 organic rows with a domain and a numeric position each", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse(fixture("decodo-lawyer-query.json")));

    const result = await createDecodoSerpProvider(env, { fetchImpl }).search(LAWYER_INPUT);

    const serp = asSerp(result);
    expect(serp.query).toBe("personal injury lawyer");
    expect(capturedOrganic(capture("decodo-lawyer-query.json"))).toHaveLength(9);
    expect(serp.organic).toHaveLength(9);
    for (const row of serp.organic) {
      expect(row.domain.length).toBeGreaterThan(0);
      expect(row.domain.startsWith("www.")).toBe(false);
      expect(Number.isFinite(row.position)).toBe(true);
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.url.startsWith("https://")).toBe(true);
    }
    expect(serp.ads).toEqual([]);
  });
});

describe("createDecodoSerpProvider request contract", () => {
  it("reserves the std budget first and posts one request to the Decodo endpoint", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(fixture("decodo-nike.json")));

    await createDecodoSerpProvider(env, { fetchImpl }).search(NIKE_INPUT);

    expect(reserveDecodoBudget).toHaveBeenCalledWith(env, "std");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe(DECODO_SCRAPE_URL);
    expect(call.init?.method).toBe("POST");
    expect(call.init?.headers).toEqual({
      "content-type": "application/json",
      authorization: `Basic ${TEST_AUTH}`,
    });
    expect(call.init?.body).toBe(
      '{"target":"google_search","query":"nike","parse":true,"geo":"United States","locale":"en-US"}',
    );
    // The 60s default is the AbortSignal the request carries.
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the exported 60s default timeout when the caller injects none", async () => {
    expect(DECODO_SERP_DEFAULT_TIMEOUT_MS).toBe(60_000);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const { fetchImpl } = recordingFetch(() => jsonResponse(fixture("decodo-nike.json")));

    try {
      await createDecodoSerpProvider(env, { fetchImpl }).search(NIKE_INPUT);

      expect(timeoutSpy).toHaveBeenCalledWith(DECODO_SERP_DEFAULT_TIMEOUT_MS);
      expect(timeoutSpy.mock.calls).toEqual([[60_000]]);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("returns not_configured with no budget reservation and no fetch when the auth is missing or blank", async () => {
    for (const auth of [undefined, "", "   "]) {
      vi.mocked(reserveDecodoBudget).mockClear();
      const { fetchImpl, calls } = recordingFetch(() => jsonResponse(fixture("decodo-nike.json")));

      const result = await createDecodoSerpProvider({ DECODO_SCRAPER_AUTH: auth } as unknown as AppEnv, {
        fetchImpl,
      }).search(NIKE_INPUT);

      expect(result).toEqual({ unavailable: true, reason: "not_configured" });
      expect(vi.mocked(reserveDecodoBudget)).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("returns quota and makes no request at all when the budget denies", async () => {
    vi.mocked(reserveDecodoBudget).mockResolvedValueOnce({ ok: false, reason: "quota" });
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(fixture("decodo-nike.json")));

    const result = await createDecodoSerpProvider(env, { fetchImpl }).search(NIKE_INPUT);

    expect(result).toEqual({ unavailable: true, reason: "quota" });
    expect(calls).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns decodo_http_400 for the live proxy_pool rejection after exactly one attempt", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse(fixture("decodo-error-400-proxy-pool.json"), 400),
    );

    const result = await createDecodoSerpProvider(env, { fetchImpl }).search(NIKE_INPUT);

    expect(result).toEqual({ unavailable: true, reason: "decodo_http_400" });
    expect(calls).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns decodo_bad_json when a 2xx body is not JSON", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse("not json at all"));

    const result = await createDecodoSerpProvider(env, { fetchImpl }).search(NIKE_INPUT);

    expect(result).toEqual({ unavailable: true, reason: "decodo_bad_json" });
    expect(calls).toHaveLength(1);
  });

  it("returns fetch_error when fetch rejects (network error and timeout abort), with no retry", async () => {
    const failures = [
      new Error("network"),
      Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      }),
    ];

    for (const failure of failures) {
      const fetchImpl = vi.fn(async () => {
        throw failure;
      }) as unknown as typeof fetch;

      const result = await createDecodoSerpProvider(env, { fetchImpl }).search(NIKE_INPUT);

      expect(result).toEqual({ unavailable: true, reason: "fetch_error" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
});

describe("mapDecodoResponse failure reasons", () => {
  it("returns decodo_no_result when the response carries no result object", () => {
    const bodies: unknown[] = [{}, { results: [] }, { results: [null] }, "not an object", null];

    for (const body of bodies) {
      expect(mapDecodoResponse(body, MAP_INPUT)).toEqual({
        unavailable: true,
        reason: "decodo_no_result",
      });
    }
  });

  it("returns decodo_status_613 on Decodo's own failure code with no results array (the real tiktok capture shape)", () => {
    // Decodo's real error body, the same one the tiktok adapter handles.
    const body = JSON.parse(
      readFileSync(resolve(FIXTURE_DIR, "../tiktok-ad-library/decodo-613.json"), "utf8"),
    ) as unknown;
    expect(body).toEqual({ status: 613, message: "quota exceeded" });

    expect(mapDecodoResponse(body, MAP_INPUT)).toEqual({
      unavailable: true,
      reason: "decodo_status_613",
    });
  });

  it("returns decodo_status_613 for a results[0].status_code failure (synthetic body)", () => {
    const body = decodoBody({ organic: [], paid: [] }, { status: 613 });

    expect(mapDecodoResponse(body, MAP_INPUT)).toEqual({
      unavailable: true,
      reason: "decodo_status_613",
    });
  });

  it("fails closed on content.status_code and content.errors (synthetic bodies)", () => {
    // Live captures carry content.status_code 12000 and content.errors [];
    // any other status, or a non-empty error list, is a failure.
    expect(
      mapDecodoResponse(decodoBody({ organic: [], paid: [] }, { contentStatus: 613 }), MAP_INPUT),
    ).toEqual({ unavailable: true, reason: "decodo_status_613" });
    expect(
      mapDecodoResponse(
        decodoBody({ organic: [], paid: [] }, { contentErrors: [{ message: "parse failed" }] }),
        MAP_INPUT,
      ),
    ).toEqual({ unavailable: true, reason: "decodo_parse_break" });
    // The live values are accepted: 12000, and an empty error list.
    expect(
      asSerp(
        mapDecodoResponse(
          decodoBody({ organic: [], paid: [] }, { contentStatus: 12_000, contentErrors: [] }),
          MAP_INPUT,
        ),
      ).organic,
    ).toEqual([]);
  });

  it("returns decodo_parse_break when the parse block, the inner results object, or the parse status is broken (synthetic bodies)", () => {
    const bodies: unknown[] = [
      // content.results missing
      { results: [{ status_code: 200, content: {} }] },
      // content.results.results missing
      { results: [{ status_code: 200, content: { results: { parse_status_code: 12_000 } } }] },
      // parse_status_code is a failure
      decodoBody({ organic: [], paid: [] }, { parseStatus: 500 }),
    ];

    for (const body of bodies) {
      expect(mapDecodoResponse(body, MAP_INPUT)).toEqual({
        unavailable: true,
        reason: "decodo_parse_break",
      });
    }
  });

  it("accepts the live parse_status_code 12000 and the generic 200, and a missing one (synthetic bodies)", () => {
    for (const parseStatus of [12_000, 200, null]) {
      const body = decodoBody({ organic: [], paid: [] }, { parseStatus });
      expect(mapDecodoResponse(body, MAP_INPUT)).toEqual({
        query: "nike",
        fetched_at: FIXED_FETCHED_AT,
        provider: "decodo",
        ads: [],
        organic: [],
      });
    }
  });
});

describe("mapDecodoResponse rows", () => {
  it("treats an absent or empty organic/paid block as a valid empty list", () => {
    const emptyBlocks: Array<Record<string, unknown>> = [{}, { organic: [], paid: [] }];

    for (const blocks of emptyBlocks) {
      const serp = asSerp(mapDecodoResponse(decodoBody(blocks), MAP_INPUT));
      expect(serp.organic).toEqual([]);
      expect(serp.ads).toEqual([]);
    }
  });

  it("takes position from pos, then pos_overall, then the row index", () => {
    const body = decodoBody({
      organic: [
        { title: "index", url: "https://a.example.com/", desc: "" },
        { pos: 7, pos_overall: 9, title: "pos", url: "https://b.example.com/", desc: "" },
        { pos_overall: 4, title: "overall", url: "https://c.example.com/", desc: "" },
      ],
      paid: [],
    });

    const serp = asSerp(mapDecodoResponse(body, MAP_INPUT));

    expect(serp.organic.map((row) => row.position)).toEqual([1, 7, 4]);
  });

  it("skips organic rows with no usable http(s) url (synthetic body)", () => {
    const body = decodoBody({
      organic: [
        { pos: 1, title: "Good", url: "https://www.example.com/a", desc: "ok" },
        { pos: 2, title: "Not http", url: "ftp://example.com/f", desc: "dropped" },
        { pos: 3, title: "Relative", url: "/goto?url=abc", desc: "dropped" },
        { pos: 4, title: "Bare host", url: "example.org", desc: "dropped" },
        { pos: 5, title: "No url", desc: "dropped" },
      ],
      paid: [],
    });

    const serp = asSerp(mapDecodoResponse(body, MAP_INPUT));

    expect(serp.organic).toEqual([
      {
        position: 1,
        domain: "example.com",
        title: "Good",
        url: "https://www.example.com/a",
        snippet: "ok",
      },
    ]);
  });

  it("maps a synthetic paid row to exactly one ad, advertiser_domain from url_shown, www stripped", () => {
    // Synthetic: every live probe came back with an empty paid list.
    const body = decodoBody({
      paid: [
        {
          pos: 1,
          title: "Nike Shoes - Official Site",
          url: "https://www.nike.com/w?cid=paid",
          url_shown: "www.nike.com",
          desc: "Shop the latest.",
        },
        { pos: 2, title: "Not a host", url: "/goto?url=abc", url_shown: "Sponsored", desc: "dropped" },
      ],
      organic: [],
    });

    const serp = asSerp(mapDecodoResponse(body, MAP_INPUT));

    expect(serp.ads).toEqual([
      {
        position: 1,
        advertiser_domain: "nike.com",
        title: "Nike Shoes - Official Site",
        url: "https://www.nike.com/w?cid=paid",
        snippet: "Shop the latest.",
      },
    ]);
    expect(serp.organic).toEqual([]);
  });

  it("keeps a relative paid click url as an empty string and an absolute one verbatim (synthetic)", () => {
    const body = decodoBody({
      paid: [
        {
          pos: 1,
          title: "Relative click url",
          url: "/goto?url=abc",
          url_shown: "shop.example.com",
          desc: "keep the row, drop the link",
        },
        {
          pos: 2,
          title: "Absolute click url",
          url: "https://www.example.com/click?cid=paid",
          url_shown: "www.example.com",
          desc: "keep both",
        },
      ],
      organic: [],
    });

    const serp = asSerp(mapDecodoResponse(body, MAP_INPUT));

    expect(serp.ads).toEqual([
      {
        position: 1,
        advertiser_domain: "shop.example.com",
        title: "Relative click url",
        url: "",
        snippet: "keep the row, drop the link",
      },
      {
        position: 2,
        advertiser_domain: "example.com",
        title: "Absolute click url",
        url: "https://www.example.com/click?cid=paid",
        snippet: "keep both",
      },
    ]);
  });

  it("falls back to the url host for advertiser_domain when url_shown is not a host (synthetic)", () => {
    const body = decodoBody({
      paid: [
        {
          pos: 1,
          title: "Display text, not a host",
          url: "https://ads.example.com/click",
          url_shown: "2.3M+ followers",
          desc: "",
        },
        {
          pos: 2,
          title: "Breadcrumb display",
          url: "https://www.example.net/click",
          url_shown: "example.net › shop",
          desc: "",
        },
      ],
      organic: [],
    });

    const serp = asSerp(mapDecodoResponse(body, MAP_INPUT));

    expect(serp.ads.map((ad) => ad.advertiser_domain)).toEqual(["ads.example.com", "example.net"]);
  });
});
