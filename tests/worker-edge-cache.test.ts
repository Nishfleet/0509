import { describe, expect, it } from "vitest";

/**
 * Issue #2950 — the anonymous public-HTML edge cache, proven at BOTH layers.
 *
 * Unit layer (injected MemoryCache): the eligibility gates, the
 * private→public licensing via the country key, the 5-minute TTL cap, the
 * (path, country, version) key isolation that IS the deploy invalidation, the
 * HEAD reply shape, and fail-open behaviour.
 *
 * Nonce-free variant layer: the stored copy's `script-src` must authorise its
 * own inline scripts by CONTENT HASH, not by a nonce. That is the #2716
 * condition ("any re-introduction … has to arrive with the nonce problem
 * actually solved") made mechanical: a nonce-bearing cached document would
 * hand the same secret-shaped token to every visitor of a colo for the cache
 * TTL — a hash is a commitment to specific bytes, not a shared credential.
 * The tests here compute the expected hashes independently (raw
 * crypto.subtle over known bodies) so the extractor, the CSP rewrite, and the
 * stored copy cannot silently drift.
 *
 * The wiring layer — the REAL worker fetch handler with `caches` stubbed —
 * lives in the sibling `tests/worker-edge-cache-wiring.test.ts` (the
 * file-size ratchet split, issue #2376). Shared doubles live in
 * `tests/helpers/edge-cache-kit.ts`.
 */
import {
  EDGE_CACHE_PROOF_HEADER,
  EDGE_STALE_WINDOW_SECONDS,
  cacheKeyUrl,
  extractInlineScriptBodies,
  inlineScriptHashSources,
  isEdgeCacheableHtmlRequest,
  isEdgeCacheableHtmlResponse,
  edgeCacheCopyAgeSeconds,
  edgeCacheCopyIsStale,
  edgeCacheCopyTtlSeconds,
  matchEdgeCache,
  nonceFreeScriptSrc,
  parseEdgeCacheTtlSeconds,
  storeEdgeCache,
  type EdgeCacheRuntime,
} from "../workers/edge-cache";
import {
  EDGE_PROOF_HEADER,
  anonymousGet,
  memoryCache,
  overwriteStoredCopy,
  sha256Source,
} from "./helpers/edge-cache-kit";
import { EXPECTED_EDGE_CACHE_PROOF_HEADER } from "../scripts/check-live-public-home.mjs";

function htmlResponse(
  init: ResponseInit & { headers?: Record<string, string> } = {},
  body = "<!doctype html><html>0509</html>",
) {
  return new Response(body, {
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...(init.headers ?? {}) },
  });
}

/** A response shaped like the real withSecurityHeaders output: HTML, a
 * max-age policy, and a nonce'd script-src (the live homepage's exact
 * directive shape). Optional set-cookie for the refusal gates. */
function htmlResponseWithCsp(cacheControl: string, body: string, setCookie?: string) {
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": cacheControl,
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-lNdj81Zx2XlGz7GhuBqKqljQ' https://siterep.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
    ].join("; "),
  };
  if (setCookie) {
    headers["set-cookie"] = setCookie;
  }
  return new Response(body, { status: 200, headers });
}

describe("edge cache eligibility (issue #2950)", () => {
  it("admits anonymous GET/HEAD of the public marketing paths only", () => {
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/"))).toBe(true);
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/pricing"))).toBe(true);
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/ads/notion.so"))).toBe(true);
    // Issue #3193: the rest of the public marketing route families the TTFB
    // contract names ride the same anonymous edge cache.
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/brands"))).toBe(true);
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/brands/eco-brands"))).toBe(true);
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/guides"))).toBe(true);
    expect(
      isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/guides/how-to-track-competitor-ads")),
    ).toBe(true);
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/compare/bigspy"))).toBe(true);
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/compare/minea"))).toBe(true);
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/compare/keeptabz"))).toBe(true);
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/compare/gethookd"))).toBe(true);
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/compare/poweradspy"))).toBe(true);
    expect(isEdgeCacheableHtmlRequest(anonymousGet("https://0509.io/switch/magicbrief"))).toBe(true);
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
    // Issue #3193: an Authorization header is a credential too — bearer/API-key
    // traffic is never anonymous, so it bypasses the shared cache both ways.
    expect(
      isEdgeCacheableHtmlRequest(
        anonymousGet("https://0509.io/", { authorization: "Bearer eye-lab-1" }),
      ),
    ).toBe(false);
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

  it("ages a stored copy from its stored-at stamp and fails safe on a missing stamp (#3247)", () => {
    const stamped = htmlResponse({
      headers: { "x-0509-edge-stored-at": String(Math.floor(Date.now() / 1000) - 120) },
    });
    expect(edgeCacheCopyAgeSeconds(stamped)).toBe(120);
    // No stamp (pre-#3247 copies) → never punished by the age gate.
    expect(edgeCacheCopyAgeSeconds(htmlResponse({}, ""))).toBeNull();
    // Broken stamp and clock skew (future stamp) → treated as missing.
    expect(
      edgeCacheCopyAgeSeconds(htmlResponse({ headers: { "x-0509-edge-stored-at": "oops" } })),
    ).toBeNull();
    expect(
      edgeCacheCopyAgeSeconds(
        htmlResponse({ headers: { "x-0509-edge-stored-at": String(Math.floor(Date.now() / 1000) + 60) } }),
      ),
    ).toBeNull();
  });

  it("serves a stale copy as HIT inside the serve-stale window and hard-expires past it (#3247)", async () => {
    const cache = memoryCache();
    const request = anonymousGet("https://0509.io/");
    await storeEdgeCache(
      request,
      cache,
      "v1",
      htmlResponseWithCsp("public, max-age=300", "<html>probe</html>"),
      "US",
    );
    // Fresh copy: a HIT (unchanged behaviour).
    const freshHit = await matchEdgeCache(request, cache, "v1", "US");
    expect(freshHit?.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    const storedAt = Number.parseInt(freshHit?.headers.get("x-0509-edge-stored-at") ?? "", 10);
    expect(Math.abs(Date.now() / 1000 - storedAt)).toBeLessThan(10);

    // Aged 12 minutes (over the 300s fresh bound, inside the stale window):
    // still a HIT — this is the probe-at-T+12min shape that produced the
    // #3247 home_edge=NONE regression. The stored copy's own stretched
    // max-age is what keeps it matchable here at all: the platform's
    // cache.match self-enforces the stored cache-control.
    await overwriteStoredCopy(cache, request, "US", "v1", 720, "<html>stale-in-window</html>");
    const staleHit = await matchEdgeCache(request, cache, "v1", "US");
    expect(staleHit?.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    expect(await staleHit?.text()).toContain("stale-in-window");
    // The served reply keeps the origin's browser contract (the deploy gate
    // asserts exactly `public, max-age=300`), not the stretched stored value.
    expect(staleHit?.headers.get("cache-control")).toBe("public, max-age=300");

    // Aged past fresh-bound + stale window: a hard miss — the next request
    // re-renders and re-stores.
    await overwriteStoredCopy(
      cache,
      request,
      "US",
      "v1",
      300 + EDGE_STALE_WINDOW_SECONDS + 300,
      "<html>hard-stale</html>",
    );
    expect(await matchEdgeCache(request, cache, "v1", "US")).toBeNull();
  });

  it("stamps the stored copy's fresh ttl and reads it back over the stretched cache-control (#3247)", async () => {
    // The stored copy's cache-control is the matchable lifetime (ttl +
    // window); edgeCacheCopyTtlSeconds recovers the fresh bound from the
    // stamp, falling back to the capped parse when the stamp is absent.
    const stamped = htmlResponse({
      headers: {
        "cache-control": `public, max-age=${45 + EDGE_STALE_WINDOW_SECONDS}`,
        "x-0509-edge-ttl": "45",
      },
    });
    expect(edgeCacheCopyTtlSeconds(stamped)).toBe(45);
    expect(
      edgeCacheCopyTtlSeconds(htmlResponse({ headers: { "cache-control": "public, max-age=45" } })),
    ).toBe(45);
    expect(
      edgeCacheCopyTtlSeconds(
        htmlResponse({ headers: { "cache-control": "public, max-age=86400" } }),
      ),
    ).toBe(300); // capped parse fallback
    expect(edgeCacheCopyTtlSeconds(htmlResponse())).toBe(300);

    // edgeCacheCopyIsStale: past the fresh bound but inside the window — and
    // fail-safe on a missing stored-at stamp (never refresh-loop on it).
    const staleCopy = htmlResponse({
      headers: {
        "cache-control": `public, max-age=${300 + EDGE_STALE_WINDOW_SECONDS}`,
        "x-0509-edge-ttl": "300",
        "x-0509-edge-stored-at": String(Math.floor(Date.now() / 1000) - 720),
      },
    });
    expect(edgeCacheCopyIsStale(staleCopy)).toBe(true);
    const freshCopy = htmlResponse({
      headers: {
        "x-0509-edge-ttl": "300",
        "x-0509-edge-stored-at": String(Math.floor(Date.now() / 1000) - 60),
      },
    });
    expect(edgeCacheCopyIsStale(freshCopy)).toBe(false);
    expect(edgeCacheCopyIsStale(htmlResponse())).toBe(false);
  });

  it("keeps the deploy gate's proof header coupled to the worker's stamp (house rule)", () => {
    // Same coupling shape as EXPECTED_PUBLIC_HOME_CACHE_CONTROL in
    // tests/worker-security-headers.test.ts: the #2950 proof asserted by
    // scripts/check-live-public-home.mjs and the header the worker actually
    // stamps can never silently diverge.
    expect(EDGE_CACHE_PROOF_HEADER).toBe(EXPECTED_EDGE_CACHE_PROOF_HEADER);
  });
});

describe("nonce-free variant (the #2716 condition, made mechanical)", () => {
  const BOOT = `(function(){try{var s=localStorage.getItem("f9-theme")}catch(e){}})();`;
  const HYDRATION = `window.__reactRouterContext.streamController.enqueue("[{\\"_1\\":2}]");`;

  const document = [
    "<!doctype html><html><head>",
    `<script data-x="a>b" nonce="AAAA">${BOOT}</script>`,
    `<script type="application/ld+json">{"@context":"https://schema.org"}</script>`,
    `<script src="/assets/root-abc.js" type="module"></script>`,
    `<script type="module" async="" nonce="BBBB">${HYDRATION}</script>`,
    "</head><body>0509</body></html>",
  ].join("");

  it("extracts exactly the inline executable script bodies, byte-exact", () => {
    expect(extractInlineScriptBodies(document)).toEqual([BOOT, HYDRATION]);
    // External (src) and data-block (ld+json) scripts are not hashed.
    expect(extractInlineScriptBodies('<script src="/x.js">ignored</script>')).toEqual([]);
    expect(
      extractInlineScriptBodies('<script type="application/ld+json">{}</script>'),
    ).toEqual([]);
    // Whitespace inside the body is part of the hashed bytes.
    expect(extractInlineScriptBodies("<script>\n  a();\n</script>")).toEqual(["\n  a();\n"]);
  });

  it("ends a script at a whitespace-tolerant end tag (`</script >`)", () => {
    // HTML lets an end tag carry whitespace and ignored junk before the `>`, and
    // browsers end the script there. Missing that would swallow the rest of the
    // document into one "body", so the hashes we advertise would not match the
    // bytes the browser hashes. CodeQL js/bad-html-filtering-regexp flagged the
    // tight form; its own example is the `</script\t\n bar>` case below.
    expect(extractInlineScriptBodies("<script>a();</script ><script>b();</script>")).toEqual([
      "a();",
      "b();",
    ]);
    expect(extractInlineScriptBodies("<script>a();</script\t\n bar>")).toEqual(["a();"]);
    expect(extractInlineScriptBodies("<script>a();</script foo>")).toEqual(["a();"]);
    // The bytes after the end tag are not part of any body.
    expect(extractInlineScriptBodies("<script>a();</script ><p>tail</p>")).toEqual(["a();"]);
  });

  it("hashes the extracted bodies to CSP sha256 sources, deterministically", async () => {
    const sources = await inlineScriptHashSources(document);
    expect(sources).toEqual([await sha256Source(BOOT), await sha256Source(HYDRATION)]);
    for (const source of sources) {
      expect(source).toMatch(/^'sha256-[A-Za-z0-9+/]+={0,2}'$/);
    }
    // Deterministic for the same document.
    expect(await inlineScriptHashSources(document)).toEqual(sources);
  });

  it("rewrites script-src: nonce tokens out, hashes in, every other token and directive untouched", async () => {
    const csp = [
      "default-src 'self'",
      "script-src 'self' https://static.cloudflareinsights.com/beacon.min.js 'nonce-lNdj81' https://siterep.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
    ].join("; ");
    const rewritten = nonceFreeScriptSrc(csp, ["'sha256-AAA='", "'sha256-BBB='"]);
    expect(rewritten).toBe(
      [
        "default-src 'self'",
        "script-src 'self' https://static.cloudflareinsights.com/beacon.min.js https://siterep.net 'sha256-AAA=' 'sha256-BBB='",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
      ].join("; "),
    );
    // A body with no inline scripts still loses the nonce (nonce-free, period).
    expect(nonceFreeScriptSrc("script-src 'self' 'nonce-x'", [])).toBe("script-src 'self'");
    // No script-src directive → header passes through unchanged.
    expect(nonceFreeScriptSrc("default-src 'self'", ["'sha256-AAA='"])).toBe("default-src 'self'");
  });
});

describe("edge cache storage semantics", () => {
  it("returns a MISS-stamped NONCE-FREE reply, stores the same variant, then serves a HIT", async () => {
    const cache = memoryCache();
    const request = anonymousGet("https://0509.io/pricing?utm=b1");
    const scriptBody = "var boot=1;";
    const miss = await storeEdgeCache(
      request,
      cache,
      "v1",
      htmlResponseWithCsp(
        "public, max-age=300",
        `<html><head><script>${scriptBody}</script></head></html>`,
      ),
    );
    expect(miss.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");
    expect(await miss.text()).toContain(scriptBody);
    // The caller's own reply is ALREADY the nonce-free variant — the same
    // bytes and headers the edge will serve. The hash authorises the script
    // BODY (what the browser hashes), not the tag.
    const scriptSrc = miss.headers.get("content-security-policy") ?? "";
    expect(scriptSrc).not.toContain("'nonce-");
    expect(scriptSrc).toContain(await sha256Source(scriptBody));

    // The stored copy: unstamped (stamping happens on serve), keyed by
    // (path, country, version), identical variant. Its cache-control is the
    // stretched match lifetime (ttl + stale window) — what cache.match
    // enforces — while the stamped ttl preserves the fresh bound.
    expect(cache.keys()).toHaveLength(1);
    expect(cache.keys()[0]).toContain("__edgec=");
    expect(cache.keys()[0]).toContain("__edgev=v1");
    const stored = await cache.match(new Request(cache.keys()[0]));
    expect(stored?.headers.get("cache-control")).toBe(
      `public, max-age=${300 + EDGE_STALE_WINDOW_SECONDS}`,
    );
    expect(stored?.headers.get("x-0509-edge-ttl")).toBe("300");

    const hit = await matchEdgeCache(request, cache, "v1");
    expect(hit).not.toBeNull();
    expect(hit?.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    expect(hit?.headers.get("cache-control")).toBe("public, max-age=300");
    expect(hit?.headers.get("content-security-policy")).toBe(scriptSrc);
    expect(await hit?.text()).toContain("boot=1");
  });

  it("keys (path, country, version) independently — a fresh version id never replays the old deploy", async () => {
    const cache = memoryCache();
    const request = anonymousGet("https://0509.io/");
    await storeEdgeCache(
      request,
      cache,
      "v1",
      htmlResponseWithCsp("public, max-age=300", "<html>deploy-one</html>"),
      "US",
    );

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
    // A set-cookie response is refused by the storage gate outright — it is
    // never shared, so the caller's own reply is returned unchanged.
    const cookieResponse = htmlResponseWithCsp("private, max-age=45", "<html>x</html>", "sid=1");
    const refused = await storeEdgeCache(request, cache, "v1", cookieResponse, "US");
    expect(refused.headers.get("cache-control")).toBe("private, max-age=45");
    expect(refused.headers.get("set-cookie")).toBe("sid=1");
    expect(refused.headers.get(EDGE_PROOF_HEADER)).toBeNull();
    expect(cache.keys()).toHaveLength(0);
    expect((await matchEdgeCache(request, cache, "v1", "US"))).toBeNull();

    const miss = await storeEdgeCache(
      request,
      cache,
      "v1",
      htmlResponseWithCsp("private, max-age=45", "<html>x</html>"),
      "US",
    );
    // The stored copy is shared and clean; the caller's reply carries the
    // same shared policy (it IS the variant).
    expect(miss.headers.get("cache-control")).toBe("public, max-age=45");
    const hit = await matchEdgeCache(request, cache, "v1", "US");
    expect(hit?.headers.get("cache-control")).toBe("public, max-age=45");
    expect(hit?.headers.has("set-cookie")).toBe(false);
  });

  it("serves a HEAD from the stored FULL-BODY copy and never poisons later GETs", async () => {
    const cache = memoryCache();
    const headRequest = new Request("https://0509.io/", { method: "HEAD", headers: { "cf-ipcountry": "US" } });
    // The worker wires an eligible HEAD through a GET-ified render, so what
    // reaches the store is the full-body secured response.
    const reply = await storeEdgeCache(
      headRequest,
      cache,
      "v1",
      htmlResponseWithCsp("public, max-age=300", "<html><script>a()</script></html>"),
      "US",
    );
    expect(await reply.text()).toBe(""); // HEAD reply carries headers only
    expect(reply.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");

    const headHit = await matchEdgeCache(headRequest, cache, "v1", "US");
    expect(headHit?.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    expect(await headHit?.text()).toBe("");

    const getHit = await matchEdgeCache(anonymousGet("https://0509.io/", { "cf-ipcountry": "US" }), cache, "v1");
    expect(await getHit?.text()).toContain("a()");
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
    // A put failure still answers the client (the nonce-free variant, stamped
    // MISS — truthfully a miss: nothing was stored).
    const miss = await storeEdgeCache(
      request,
      broken,
      "v1",
      htmlResponseWithCsp("public, max-age=300", "<html><script>a()</script></html>"),
    );
    expect(miss.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");
    // No cache at all (Node harness): everything passes through untouched,
    // nonce'd CSP included.
    expect(await matchEdgeCache(request, null, "v1")).toBeNull();
    const passthrough = htmlResponseWithCsp("public, max-age=300", "<html>x</html>");
    const returned = await storeEdgeCache(request, null, "v1", passthrough);
    expect(returned).toBe(passthrough);
    expect(returned.headers.get(EDGE_PROOF_HEADER)).toBeNull();
  });
});
