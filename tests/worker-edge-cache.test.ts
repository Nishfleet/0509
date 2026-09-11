import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #2950 — the anonymous public-HTML edge cache, proven at BOTH layers.
 *
 * Unit layer (injected MemoryCache): the eligibility gates, the
 * private→public licensing via the country key, the 5-minute TTL cap, the
 * (path, country, version) key isolation that IS the deploy invalidation, the
 * HEAD reply shape, and fail-open behaviour.
 *
 * Wiring layer (the REAL worker fetch handler, exactly like
 * tests/worker-csp-nonce.test.ts but with `caches` stubbed): the second
 * identical anonymous GET comes from the cache — the router is never called
 * again, the MISS→HIT stamps tell the truth, the HIT document's CSP header
 * authorises the very nonce embedded in its own body (the #2716 property that
 * killed #2388's cache), a cookie-carrying (logged-in) request always renders
 * fresh, and a new `CF_VERSION_METADATA.id` — what every deploy produces —
 * misses, re-renders, and re-arms. That last one IS the safe deploy
 * invalidation path, exercised end to end.
 *
 * Also proven: a HEAD after a warm GET gets the stored copy's headers with no
 * body (the `curl -sI` proof surface), and /pricing — not just the homepage —
 * participates.
 */
import {
  EDGE_CACHE_PROOF_HEADER,
  EDGE_HTML_CACHE_NAME,
  cacheKeyUrl,
  isEdgeCacheableHtmlRequest,
  isEdgeCacheableHtmlResponse,
  matchEdgeCache,
  parseEdgeCacheTtlSeconds,
  storeEdgeCache,
  type EdgeCacheRuntime,
} from "../workers/edge-cache";
import { EXPECTED_EDGE_CACHE_PROOF_HEADER } from "../scripts/check-live-public-home.mjs";

const EDGE_PROOF_HEADER = "x-0509-edge-cache";

function htmlResponse(
  init: ResponseInit & { headers?: Record<string, string> } = {},
  body = "<!doctype html><html>0509</html>",
) {
  return new Response(body, {
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...(init.headers ?? {}) },
  });
}

/** In-memory EdgeCacheRuntime double keyed by URL, like the Workers Cache. */
function memoryCache(): EdgeCacheRuntime & { keys: () => string[] } {
  const store = new Map<
    string,
    { body: ArrayBuffer; init: { status: number; statusText: string; headers: Headers } }
  >();
  return {
    keys: () => [...store.keys()],
    async match(key: Request | string) {
      const entry = store.get(new Request(key instanceof Request ? key.url : key).url);
      if (!entry) return undefined;
      return new Response(entry.body, {
        status: entry.init.status,
        statusText: entry.init.statusText,
        headers: new Headers(entry.init.headers),
      });
    },
    async put(key: Request, response: Response) {
      store.set(new URL(key.url).toString(), {
        body: (await response.clone().arrayBuffer()) as ArrayBuffer,
        init: {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        },
      });
    },
  };
}

function anonymousGet(url = "https://0509.io/", headers: Record<string, string> = {}) {
  return new Request(url, { method: "GET", headers });
}

describe("edge cache eligibility (issue #2950)", () => {
  it("admits anonymous GET/HEAD of the public marketing paths only", () => {
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/"))).toBe(true);
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/pricing"))).toBe(true);
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/ads/notion.so"))).toBe(true);
    expect(isEdgeCacheableHtmlRequest(new Request("https://0509.io/", { method: "HEAD" }))).toBe(
      true,
    );
    // Personalised / authenticated surfaces stay out by construction.
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/search"))).toBe(false);
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/compare/unknown-page"))).toBe(
      false,
    );
    const authed = anonymousGet("https://0509.io/", {
      cookie: "better-auth.session_token=x",
    });
    expect(isEdgeCacheableHtmlRequest(authed)).toBe(false);
  });

  it("stores only 200 text/html responses that carry a max-age and no set-cookie", () => {
    expect(
      isEdgeCacheableHtmlResponse(
        htmlResponse({ headers: { "cache-control": "public, max-age=300" } }),
      ),
    ).toBe(true);
    // The country-keyed license: a private browser-only directive still
    // reaches the (country, version)-keyed edge copy.
    expect(
      isEdgeCacheableHtmlResponse(
        htmlResponse({ headers: { "cache-control": "private, max-age=45" } }),
      ),
    ).toBe(true);
    expect(isEdgeCacheableHtmlResponse(new Response("x", { status: 404 }))).toBe(false);
    expect(
      isEdgeCacheableHtmlResponse(
        htmlResponse({ headers: { "cache-control": "no-store, no-cache, must-revalidate" } }),
      ),
    ).toBe(false);
    expect(
      isEdgeCacheableHtmlResponse(
        htmlResponse({
          headers: { "cache-control": "public, max-age=300", "set-cookie": "a=b" },
        }),
      ),
    ).toBe(false);
    expect(
      isEdgeCacheableHtmlResponse(
        new Response("{}", {
          headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
        }),
      ),
    ).toBe(false);
  });

  it("caps the edge TTL at the 5-minute skew bound and survives a broken directive", () => {
    expect(
      parseEdgeCacheTtlSeconds(htmlResponse({ headers: { "cache-control": "public, max-age=86400" } })),
    ).toBe(300);
    expect(
      parseEdgeCacheTtlSeconds(htmlResponse({ headers: { "cache-control": "public, max-age=45" } })),
    ).toBe(45);
    expect(
      parseEdgeCacheTtlSeconds(htmlResponse({ headers: { "cache-control": "public, max-age=oops" } })),
    ).toBe(300);
    expect(parseEdgeCacheTtlSeconds(htmlResponse())).toBe(300);
  });

  it("keeps the deploy gate's proof header coupled to the worker's stamp (house rule)", () => {
    // Same coupling shape as EXPECTED_PUBLIC_HOME_CACHE_CONTROL in
    // tests/worker-security-headers.test.ts: the #2950 proof asserted by
    // scripts/check-live-public-home.mjs and the header the worker actually
    // stamps can never silently diverge.
    expect(EDGE_CACHE_PROOF_HEADER).toBe(EXPECTED_EDGE_CACHE_PROOF_HEADER);
  });
});

describe("edge cache storage semantics", () => {
  it("returns a MISS-stamped reply, stores an unstamped public copy, then serves a HIT", async () => {
    const cache = memoryCache();
    const request = anonymousGet("https://0509.io/pricing?utm=b1");
    const miss = await storeEdgeCache(
      request,
      cache,
      "v1",
      htmlResponse({ headers: { "cache-control": "public, max-age=300" } }),
    );
    expect(miss.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");
    expect(await miss.text()).toContain("0509");

    // The stored copy: unstamped (stamping happens on serve), keyed by
    // (path, country, version).
    expect(cache.keys()).toHaveLength(1);
    expect(cache.keys()[0]).toContain("__edgec=");
    expect(cache.keys()[0]).toContain("__edgev=v1");

    const hit = await matchEdgeCache(request, cache, "v1");
    expect(hit).not.toBeNull();
    expect(hit?.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    expect(hit?.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await hit?.text()).toContain("0509");
  });

  it("keys (path, country, version) independently — a fresh version id never replays the old deploy", async () => {
    const cache = memoryCache();
    const request = anonymousGet("https://0509.io/");
    await storeEdgeCache(request, cache, "v1", htmlResponse({}, "<html>deploy-one</html>"), "US");

    expect((await matchEdgeCache(request, cache, "v1", "US"))?.headers.get(EDGE_PROOF_HEADER)).toBe(
      "HIT",
    );
    expect(await matchEdgeCache(request, cache, "v1", "DE")).toBeNull();
    expect(await matchEdgeCache(request, cache, "v2", "US")).toBeNull();

    // Same inputs → the same key, which is what makes the SECOND request hit.
    expect(cacheKeyUrl(new URL("https://0509.io/"), "US", "v1")).toBe(
      cacheKeyUrl(new URL("https://0509.io/"), "US", "v1"),
    );
  });

  it("rewrites the stored copy to public but leaves the caller's own headers untouched", async () => {
    const cache = memoryCache();
    const request = anonymousGet("https://0509.io/");
    const miss = await storeEdgeCache(
      request,
      cache,
      "v1",
      htmlResponse({ headers: { "cache-control": "private, max-age=45", "set-cookie": "sid=1" } }),
      "US",
    );
    // The browser sees the origin's own policy (plus the stamp).
    expect(miss.headers.get("cache-control")).toBe("private, max-age=45");
    expect(miss.headers.get("set-cookie")).toBe("sid=1");
    // The edge copy is shared and clean.
    const hit = await matchEdgeCache(request, cache, "v1", "US");
    expect(hit?.headers.get("cache-control")).toBe("public, max-age=45");
    expect(hit?.headers.has("set-cookie")).toBe(false);
  });

  it("serves a HEAD from the stored FULL-BODY copy and never poisons later GETs", async () => {
    const cache = memoryCache();
    const headRequest = new Request("https://0509.io/", { method: "HEAD" });
    // The worker wires an eligible HEAD through a GET-ified render, so what
    // reaches the store is the full-body secured response.
    const reply = await storeEdgeCache(
      headRequest,
      cache,
      "v1",
      htmlResponse({ headers: { "cache-control": "public, max-age=300" } }),
      "US",
    );
    expect(await reply.text()).toBe(""); // HEAD reply carries headers only
    expect(reply.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");

    const headHit = await matchEdgeCache(headRequest, cache, "v1");
    expect(headHit?.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    expect(await headHit?.text()).toBe("");

    const getHit = await matchEdgeCache(anonymousGet("https://0509.io/"), cache, "v1", "US");
    expect(await getHit?.text()).toContain("0509");
  });

  it("is fail-open: a broken or absent cache never breaks the render", async () => {
    const broken: EdgeCacheRuntime = {
      match: async () => {
        throw new Error("colo on fire");
      },
      put: async () => {
        throw new Error("colo on fire");
      },
    };
    const request = anonymousGet("https://0509.io/");
    expect(await matchEdgeCache(request, broken, "v1")).toBeNull();
    // A put failure still answers the client (stamped MISS — truthfully a miss).
    const miss = await storeEdgeCache(
      request,
      broken,
      "v1",
      htmlResponse({ headers: { "cache-control": "public, max-age=300" } }),
    );
    expect(miss.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");
    // No cache at all (Node harness): everything passes through untouched.
    expect(await matchEdgeCache(request, null, "v1")).toBeNull();
    const passthrough = htmlResponse({ headers: { "cache-control": "public, max-age=300" } });
    expect(await storeEdgeCache(request, null, "v1", passthrough)).toBe(passthrough);
  });
});

// ---------------------------------------------------------------------------
// Wiring layer: the REAL worker fetch handler, caches stubbed.
// ---------------------------------------------------------------------------

const SYMBOL_FOR_TEST = Symbol("cloudflareRuntimeContext");

async function loadWorker() {
  let capturedNonce: string | undefined;
  const htmlDocument = () =>
    new Response(
      `<!doctype html><html><head><script nonce="${capturedNonce ?? ""}">/*boot*/</script></head><body>0509</body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );

  vi.doMock("react-router", () => ({
    createRequestHandler:
      () => async (_request: Request, context: { get: (k: unknown) => unknown }) => {
        const value = context.get(SYMBOL_FOR_TEST) as { cspNonce?: string } | undefined;
        capturedNonce = value?.cspNonce;
        return htmlDocument();
      },
    RouterContextProvider: class RouterContextProvider {
      private readonly store = new Map<unknown, unknown>();
      set(key: unknown, value: unknown) {
        this.store.set(key, value);
      }
      get(key: unknown) {
        return this.store.get(key);
      }
    },
  }));
  vi.doMock("../app/lib/cloudflare-context", () => ({
    cloudflareRuntimeContext: SYMBOL_FOR_TEST,
  }));
  vi.doMock("../app/lib/locale-markets", () => ({ isBuyerSurfaceLocaleId: () => false }));
  vi.doMock("../workers/primary-domain", () => ({ primaryDomainRedirect: () => null }));
  vi.doMock("../app/lib/seo", () => ({ publicSeoFileForPathname: () => null }));
  vi.doMock("../app/lib/public-markdown", () => ({
    PUBLIC_MARKDOWN: "# markdown",
    buildLlmsText: () => "# llms",
    isPublicMarkdownPage: () => false,
    wantsPublicMarkdown: () => false,
  }));
  vi.doMock("../app/lib/sitemap.server", () => ({ publicSitemapForPathname: () => null }));
  vi.doMock("../app/lib/social-cards.server", () => ({ publicSocialCardForRequest: () => null }));
  vi.doMock("../app/lib/creative-thumbnail.server", () => ({
    parseCreativeArtifactPathname: () => null,
    serveCreativeArtifact: async () => null,
  }));
  vi.doMock("../app/lib/proof-screenshot", () => ({ parseProofScreenshotPathname: () => null }));
  vi.doMock("../app/lib/proof-screenshot.server", () => ({ serveProofScreenshot: async () => null }));
  vi.doMock("../app/lib/proof-page-text", () => ({ parseProofPageTextPathname: () => null }));
  vi.doMock("../app/lib/proof-page-text.server", () => ({ serveProofPageText: async () => null }));
  vi.doMock("../app/lib/marketing-page-html.server", () => ({
    marketingPageHtmlForPathname: () => null,
  }));
  vi.doMock("../workers/monitoring-workflow", () => ({ MonitoringWorkflow: class {} }));
  vi.doMock("../workers/delivery-recovery", () => ({
    scheduleBillingLifecycleEmailRecovery: vi.fn(),
  }));
  vi.doMock("../workers/digest-schedule-recovery", () => ({
    scheduleDigestScheduleExhaustionRecovery: vi.fn(),
  }));

  const workerModule = await import("../workers/app");
  return { worker: workerModule.default, capturedNonce: () => capturedNonce };
}

interface FetchOptions {
  path?: string;
  env?: Record<string, unknown>;
  headers?: Record<string, string>;
  method?: string;
}

async function fetchDocument(
  worker: { fetch: unknown },
  { path = "/", env = {}, headers = {}, method = "GET" }: FetchOptions = {},
) {
  return (
    worker.fetch as (request: Request, e: unknown, c: unknown) => Promise<Response>
  )(
    new Request(`https://0509.io${path}`, {
      method,
      headers: { accept: "text/html", ...headers },
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
}

function cspNonceOf(response: Response): string | undefined {
  const scriptSrc = (response.headers.get("content-security-policy") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("script-src "));
  return /'nonce-([^']+)'/.exec(scriptSrc ?? "")?.[1];
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("edge cache through the real worker fetch handler (issue #2950)", () => {
  it("serves the second identical anonymous GET from the cache; the router never runs again", async () => {
    const stub = memoryCache();
    vi.stubGlobal("caches", {
      open: async (name: string) => {
        expect(name).toBe(EDGE_HTML_CACHE_NAME);
        return stub;
      },
    });
    const { worker, capturedNonce: nonceSeen } = await loadWorker();

    const first = await fetchDocument(worker);
    expect(first.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");
    const firstBody = await first.text();
    const firstNonce = cspNonceOf(first);

    const second = await fetchDocument(worker);
    expect(second.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    const secondBody = await second.text();
    expect(secondBody).toBe(firstBody);
    // The HIT skipped the render: the nonce the worker handed the router is
    // still the FIRST request's, while the second response's CSP header
    // authorises exactly the nonce embedded in its own stored body — the
    // #2716 self-consistency property, end to end.
    expect(nonceSeen()).toBe(firstNonce);
    const secondNonce = cspNonceOf(second);
    expect(secondNonce).toBeTruthy();
    expect(secondBody.includes(`nonce="${secondNonce}"`)).toBe(true);
  });

  it("keeps logged-in (cookie) requests fresh: never stored, never replayed", async () => {
    const stub = memoryCache();
    vi.stubGlobal("caches", { open: async () => stub });
    const { worker, capturedNonce: nonceSeen } = await loadWorker();

    const anonymousFirst = await fetchDocument(worker);
    const anonymousNonce = cspNonceOf(anonymousFirst);
    const anonymousBody = await anonymousFirst.clone().text();
    expect(anonymousFirst.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");

    const authed = await fetchDocument(worker, {
      headers: { cookie: "better-auth.session_token=abc" },
    });
    // Not stamped: it never touched the cache. And it is a FRESH render, not
    // the anonymous one (the root loader embeds the session in the document).
    expect(authed.headers.has(EDGE_PROOF_HEADER)).toBe(false);
    expect(cspNonceOf(authed)).not.toBe(anonymousNonce);
    expect(nonceSeen()).toBe(cspNonceOf(authed));

    // And the anonymous variant is still the one being served afterwards.
    const anonymousSecond = await fetchDocument(worker);
    expect(anonymousSecond.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    expect(await anonymousSecond.text()).toBe(anonymousBody);
  });

  it("re-renders after a deploy: a new CF_VERSION_METADATA.id misses, re-renders, re-arms", async () => {
    const stub = memoryCache();
    vi.stubGlobal("caches", { open: async () => stub });
    const { worker, capturedNonce: nonceSeen } = await loadWorker();
    const envFor = (id: string) => ({ CF_VERSION_METADATA: { id } });

    expect(
      (await fetchDocument(worker, { env: envFor("v1") })).headers.get(EDGE_PROOF_HEADER),
    ).toBe("MISS");
    expect(nonceSeen()).toBeTruthy();
    const deployOneNonce = nonceSeen();
    expect((await fetchDocument(worker, { env: envFor("v1") })).headers.get(EDGE_PROOF_HEADER)).toBe(
      "HIT",
    );

    // The deploy: fresh version id -> fresh key -> a real render again.
    const afterDeploy = await fetchDocument(worker, { env: envFor("v2") });
    expect(afterDeploy.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");
    expect(cspNonceOf(afterDeploy)).not.toBe(deployOneNonce);
    expect((await fetchDocument(worker, { env: envFor("v2") })).headers.get(EDGE_PROOF_HEADER)).toBe(
      "HIT",
    );
  });

  it("answers a HEAD after a warm GET with the stored copy's headers and no body (the curl -sI proof)", async () => {
    const stub = memoryCache();
    vi.stubGlobal("caches", { open: async () => stub });
    const { worker } = await loadWorker();

    await fetchDocument(worker);
    const headHit = await fetchDocument(worker, { method: "HEAD" });
    expect(headHit.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    expect(headHit.status).toBe(200);
    expect(headHit.headers.get("content-type")).toContain("text/html");
    expect(headHit.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await headHit.text()).toBe("");

    // The stored GET survived the headOf reply untouched.
    const warmed = await fetchDocument(worker);
    expect(warmed.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    expect(await warmed.text()).toContain("0509");
  });

  it("covers the other marketing pages, and leaves ineligible renders unstamped", async () => {
    const stub = memoryCache();
    vi.stubGlobal("caches", { open: async () => stub });
    const { worker } = await loadWorker();

    const pricingMiss = await fetchDocument(worker, { path: "/pricing" });
    expect(pricingMiss.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");
    expect((await fetchDocument(worker, { path: "/pricing" })).headers.get(EDGE_PROOF_HEADER)).toBe(
      "HIT",
    );

    // Not in PUBLIC_CACHEABLE_HTML_PATHS: no stamp, no key.
    const outsider = await fetchDocument(worker, { path: "/compare/unknown-page" });
    expect(outsider.headers.has(EDGE_PROOF_HEADER)).toBe(false);
    expect(stub.keys()).toHaveLength(1);
  });
});
