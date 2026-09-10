import { describe, expect, it } from "vitest";

import { withSecurityHeaders } from "../../workers/security-headers";
import worker, {
  EDGE_CACHE_STATUS_HEADER,
  EDGE_CACHE_TTL_SECONDS,
  edgeCacheKeyForRequest,
  isEdgeCacheableHtmlResponse,
  readEdgeCachedResponse,
  storeEdgeCachedHtmlResponse,
} from "../../workers/app";

/**
 * Issue #2388 — the anonymous public HTML edge cache.
 *
 * These run on the real workerd runtime (the `workers` vitest project), so
 * `caches.default` is the real Cache API, not a stub: a `put` here is the same
 * `put` production performs, and the country bucket, the cookie bypass, and
 * the poisoning guards are asserted against bytes the runtime really stored.
 *
 * The response under test is the one the Worker actually caches — the route
 * response AFTER `withSecurityHeaders` — so the `public, max-age=300` the
 * security layer stamps on anonymous public HTML is the same value the cache
 * gate reads. Asserting that coupling here is the point: if the security layer
 * ever stops marking these routes public, the edge cache goes dead and this
 * suite fails instead of silently serving nothing.
 */

const HTML_BODY = "<!doctype html><html><body>nike brand page</body></html>";

function htmlResponse(): Response {
  return new Response(HTML_BODY, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function drain(waitUntilCalls: Promise<unknown>[]): Promise<void> {
  await Promise.all(waitUntilCalls);
}

function collectingContext() {
  const waitUntilCalls: Promise<unknown>[] = [];
  return {
    waitUntilCalls,
    ctx: { waitUntil: (promise: Promise<unknown>) => void waitUntilCalls.push(promise) },
  };
}

function anonymousRequest(path: string, country?: string): Request {
  const request = new Request(`https://0509.io${path}`, {
    method: "GET",
    headers: { accept: "text/html" },
  });
  if (country) {
    // The edge populates `cf` on the incoming request; the test populates it
    // the same way so the country bucket is exercised, not assumed.
    Object.defineProperty(request, "cf", { value: { country }, configurable: true });
  }
  return request;
}

describe("edge cache key eligibility", () => {
  it("keys an anonymous GET on a public programmatic path", () => {
    const key = edgeCacheKeyForRequest(anonymousRequest("/ads/nike.com"));
    expect(key).not.toBeNull();
    expect(key!.url).toContain("/ads/nike.com");
  });

  it("leaves every non-GET method out of the cache", () => {
    expect(
      edgeCacheKeyForRequest(
        new Request("https://0509.io/ads/nike.com", { method: "POST" }),
      ),
    ).toBeNull();
    expect(
      edgeCacheKeyForRequest(new Request("https://0509.io/ads/nike.com", { method: "HEAD" })),
    ).toBeNull();
  });

  it("bypasses any request carrying a cookie", () => {
    expect(
      edgeCacheKeyForRequest(
        new Request("https://0509.io/ads/nike.com", {
          method: "GET",
          headers: { cookie: "better-auth.session_token=abc" },
        }),
      ),
    ).toBeNull();
    // Even a cookie that is not the auth cookie: the session document is the
    // reason this bypass exists, and any cookie at all is the conservative rule.
    expect(
      edgeCacheKeyForRequest(
        new Request("https://0509.io/ads/nike.com", {
          method: "GET",
          headers: { cookie: "tracking=1" },
        }),
      ),
    ).toBeNull();
  });

  it("stays off paths outside /ads/*, /compare/*, /timeline/*", () => {
    for (const path of ["/", "/pricing", "/app/watchlists", "/api/health"]) {
      expect(edgeCacheKeyForRequest(anonymousRequest(path))).toBeNull();
    }
  });

  it("gives each country its own entry and collapses a missing country to one bucket", () => {
    const us = edgeCacheKeyForRequest(anonymousRequest("/ads/nike.com", "US"))!;
    const de = edgeCacheKeyForRequest(anonymousRequest("/ads/nike.com", "DE"))!;
    const missing = edgeCacheKeyForRequest(anonymousRequest("/ads/nike.com"))!;

    expect(us.url).not.toBe(de.url);
    expect(missing.url).not.toBe(us.url);
    expect(missing.url).toBe(
      edgeCacheKeyForRequest(anonymousRequest("/ads/nike.com", "  "))!.url,
    );
  });
});

describe("edge cache storability guards", () => {
  it("stores only 200 HTML with an explicit public cache-control", () => {
    const publicHtml = withSecurityHeaders(
      htmlResponse(),
      anonymousRequest("/ads/nike.com"),
    );
    expect(publicHtml.headers.get("cache-control")).toBe(`public, max-age=${EDGE_CACHE_TTL_SECONDS}`);
    expect(isEdgeCacheableHtmlResponse(publicHtml)).toBe(true);
  });

  it("refuses non-200, cookie-setting, private, and non-HTML responses", async () => {
    const request = anonymousRequest("/ads/nike.com");
    const publicCacheControl = { "cache-control": "public, max-age=300" };

    expect(
      isEdgeCacheableHtmlResponse(
        new Response("not found", {
          status: 404,
          headers: { "content-type": "text/html", ...publicCacheControl },
        }),
      ),
    ).toBe(false);

    expect(
      isEdgeCacheableHtmlResponse(
        new Response(HTML_BODY, {
          headers: {
            "content-type": "text/html",
            "set-cookie": "better-auth.session_token=abc; Path=/; HttpOnly",
            ...publicCacheControl,
          },
        }),
      ),
    ).toBe(false);

    // The SSR pricing pages set this themselves. They sit outside the three
    // cached prefixes, so this is the guard for the general case: a `private`
    // document under a cached prefix must still be refused.
    const privateHtml = withSecurityHeaders(
      new Response(HTML_BODY, {
        headers: { "content-type": "text/html", "cache-control": "private, max-age=300" },
      }),
      anonymousRequest("/pricing"),
    );
    expect(privateHtml.headers.get("cache-control")).toBe("private, max-age=300");
    expect(isEdgeCacheableHtmlResponse(privateHtml)).toBe(false);

    const { ctx: privateCtx, waitUntilCalls: privateWaitUntilCalls } = collectingContext();
    const privateReturned = storeEdgeCachedHtmlResponse(
      anonymousRequest("/ads/edge-cache-private.example"),
      privateHtml,
      privateCtx,
    );
    expect(privateReturned.headers.has(EDGE_CACHE_STATUS_HEADER)).toBe(false);
    expect(privateWaitUntilCalls).toHaveLength(0);
    expect(
      await readEdgeCachedResponse(anonymousRequest("/ads/edge-cache-private.example")),
    ).toBeNull();

    expect(isEdgeCacheableHtmlResponse(new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json", ...publicCacheControl },
    }))).toBe(false);

    // ...and the same request that stores a HTML document stores nothing for a
    // response the guards reject.
    const { ctx, waitUntilCalls } = collectingContext();
    const rejected = storeEdgeCachedHtmlResponse(
      request,
      new Response("not found", {
        status: 404,
        headers: { "content-type": "text/html", ...publicCacheControl },
      }),
      ctx,
    );
    expect(rejected.headers.has(EDGE_CACHE_STATUS_HEADER)).toBe(false);
    expect(waitUntilCalls).toHaveLength(0);
  });
});

describe("edge cache on the real Cache API", () => {
  it("serves the second anonymous GET from cache with the security headers intact", async () => {
    const request = anonymousRequest("/ads/edge-cache-hit.example", "US");
    const final = withSecurityHeaders(htmlResponse(), request);
    const { ctx, waitUntilCalls } = collectingContext();

    const first = storeEdgeCachedHtmlResponse(request, final, ctx);
    expect(first.headers.get(EDGE_CACHE_STATUS_HEADER)).toBe("MISS");
    await drain(waitUntilCalls);

    const second = await readEdgeCachedResponse(request);
    expect(second).not.toBeNull();
    expect(second!.headers.get(EDGE_CACHE_STATUS_HEADER)).toBe("HIT");
    expect(await second!.text()).toBe(HTML_BODY);
    // The stored copy is the post-security-headers response, not the raw route
    // response, so a cache HIT cannot ship a document without a CSP.
    expect(second!.headers.get("content-security-policy")).toBe(
      first.headers.get("content-security-policy"),
    );
    expect(second!.headers.get("content-type")).toContain("text/html");
  });

  it("never stores for a cookie request, and a cookieless reader cannot see it either", async () => {
    const path = "/ads/edge-cache-cookie.example";
    const cookieRequest = new Request(`https://0509.io${path}`, {
      method: "GET",
      headers: { cookie: "better-auth.session_token=abc" },
    });
    const { ctx, waitUntilCalls } = collectingContext();

    const returned = storeEdgeCachedHtmlResponse(
      cookieRequest,
      withSecurityHeaders(htmlResponse(), cookieRequest),
      ctx,
    );
    expect(returned.headers.has(EDGE_CACHE_STATUS_HEADER)).toBe(false);
    expect(waitUntilCalls).toHaveLength(0);
    await drain(waitUntilCalls);

    expect(await readEdgeCachedResponse(cookieRequest)).toBeNull();
    // The signed-in response set no shared entry for the anonymous visitor.
    expect(await readEdgeCachedResponse(anonymousRequest(path))).toBeNull();
  });

  it("cannot read an entry that the anonymous visitor already stored", async () => {
    const path = "/ads/edge-cache-cookie-read.example";
    const { ctx, waitUntilCalls } = collectingContext();
    const anonymous = anonymousRequest(path);

    storeEdgeCachedHtmlResponse(anonymous, withSecurityHeaders(htmlResponse(), anonymous), ctx);
    await drain(waitUntilCalls);
    expect(await readEdgeCachedResponse(anonymous)).not.toBeNull();

    // Read-side bypass, not just the write-side one: an entry exists under this
    // exact URL, and a Cookie request must still not be served it.
    for (const cookie of ["better-auth.session_token=abc", "tracking=1"]) {
      const cookieRequest = new Request(`https://0509.io${path}`, {
        method: "GET",
        headers: { cookie },
      });
      expect(await readEdgeCachedResponse(cookieRequest)).toBeNull();
    }
  });

  it("serves the worker's own fetch entry point from cache on the second request", async () => {
    const path = "/ads/edge-cache-fetch-wiring.example";
    const request = anonymousRequest(path, "US");
    const { ctx, waitUntilCalls } = collectingContext();

    storeEdgeCachedHtmlResponse(request, withSecurityHeaders(htmlResponse(), request), ctx);
    await drain(waitUntilCalls);

    // The real `fetch` handler, not the helpers: this is the wiring the accept
    // criterion's second `curl` exercises. The cache read happens before the
    // React Router tree, so a HIT never reaches the router (which the test
    // runtime cannot build — that is exactly why a HIT is provable here and a
    // MISS is not).
    type WorkerFetch = (request: Request, env: unknown, ctx: unknown) => Promise<Response>;
    const response = await (worker.fetch as WorkerFetch)(request, {}, ctx);

    expect(response.headers.get(EDGE_CACHE_STATUS_HEADER)).toBe("HIT");
    expect(await response.text()).toBe(HTML_BODY);
  });

  it("keeps countries apart: a US document is not replayed for a DE request", async () => {
    const path = "/ads/edge-cache-country.example";
    const usRequest = anonymousRequest(path, "US");
    const deRequest = anonymousRequest(path, "DE");
    const { ctx, waitUntilCalls } = collectingContext();

    storeEdgeCachedHtmlResponse(
      usRequest,
      withSecurityHeaders(htmlResponse(), usRequest),
      ctx,
    );
    await drain(waitUntilCalls);

    expect(await readEdgeCachedResponse(usRequest)).not.toBeNull();
    expect(await readEdgeCachedResponse(deRequest)).toBeNull();
  });

  it("does not serve a cached document across a no-country request", async () => {
    const path = "/ads/edge-cache-no-country.example";
    const { ctx, waitUntilCalls } = collectingContext();
    storeEdgeCachedHtmlResponse(
      anonymousRequest(path, "US"),
      withSecurityHeaders(htmlResponse(), anonymousRequest(path, "US")),
      ctx,
    );
    await drain(waitUntilCalls);

    expect(await readEdgeCachedResponse(anonymousRequest(path))).toBeNull();
  });
});
