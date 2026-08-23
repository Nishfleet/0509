import { describe, expect, it } from "vitest";

import {
  COUNTRY_VARYING_PUBLIC_HOME_CACHE_CONTROL,
  EXPECTED_PUBLIC_HOME_CACHE_CONTROL,
  EXPECTED_SCRIPT_SRC_BEACON_HOST,
} from "../scripts/check-live-public-home.mjs";
import {
  CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC,
  HTML_NO_STORE_HEADERS,
  PUBLIC_HTML_CACHE_CONTROL,
  SECURITY_HEADERS,
  withSecurityHeaders,
} from "../workers/security-headers";

const BASE_SCRIPT_SRC = `script-src 'self' 'unsafe-inline' ${CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC}`;

function htmlResponse(init: ResponseInit & { headers?: Record<string, string> } = {}) {
  return new Response("<!doctype html>", {
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...(init.headers ?? {}) },
  });
}

function cspDirective(response: Response, name: string) {
  const csp = response.headers.get("content-security-policy") ?? "";
  return csp
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `));
}

describe("Worker security headers", () => {
  it("applies baseline security headers to responses", () => {
    const response = withSecurityHeaders(new Response("ok"));

    expect(response.headers.get("strict-transport-security")).toBe(
      SECURITY_HEADERS["strict-transport-security"],
    );
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(cspDirective(response, "script-src")).toBe(BASE_SCRIPT_SRC);
    expect(cspDirective(response, "connect-src")).toBe("connect-src 'self' https:");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("allows the Cloudflare Web Analytics beacon script on HTML responses", () => {
    // Web Analytics is enabled for this zone with automatic (edge) injection:
    // Cloudflare inserts https://static.cloudflareinsights.com/beacon.min.js into
    // HTML responses as they pass the edge. If script-src drops the host, the
    // beacon is blocked and analytics silently records zero page views. The
    // beacon posts to /cdn-cgi/rum on the same origin, which connect-src 'self'
    // covers.
    // A non-public route (not the Site Rep widget homepage) so script-src is the
    // exact baseline without the widget host appended.
    const response = withSecurityHeaders(
      htmlResponse(),
      new Request("https://0509.io/app"),
    );
    const scriptSrc = cspDirective(response, "script-src") ?? "";
    expect(scriptSrc).toBe(BASE_SCRIPT_SRC);
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain(CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC);
    expect(cspDirective(response, "connect-src")).toBe("connect-src 'self' https:");
    expect(cspDirective(response, "connect-src")).toContain("'self'");
  });

  it("allows the Site Rep script only on public widget HTML routes", () => {
    const publicResponse = withSecurityHeaders(
      new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      new Request("https://0509.io/"),
    );
    const authResponse = withSecurityHeaders(
      new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      new Request("https://0509.io/api/auth/callback/google"),
    );
    const appResponse = withSecurityHeaders(
      new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      new Request("https://0509.io/app"),
    );
    const publicWithAuthCookieResponse = withSecurityHeaders(
      new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      new Request("https://0509.io/", {
        headers: { cookie: "better-auth.session_token=session-123" },
      }),
    );

    expect(cspDirective(publicResponse, "script-src")).toBe(
      `${BASE_SCRIPT_SRC} https://siterep.net`,
    );
    expect(cspDirective(authResponse, "script-src")).toBe(BASE_SCRIPT_SRC);
    expect(cspDirective(appResponse, "script-src")).toBe(BASE_SCRIPT_SRC);
    expect(cspDirective(publicWithAuthCookieResponse, "script-src")).toBe(BASE_SCRIPT_SRC);
  });

  it("prevents stale cached public HTML from surviving a rebuild", () => {
    const response = withSecurityHeaders(
      new Response("<!doctype html>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=31536000",
        },
      }),
    );

    expect(response.headers.get("cache-control")).toBe(HTML_NO_STORE_HEADERS["cache-control"]);
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });

	it("marks share-link responses noindex for the document and data requests", () => {
		const documentResponse = withSecurityHeaders(
			new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
			new Request("https://0509.io/share/abc"),
		);
		const dataResponse = withSecurityHeaders(
			new Response("{}", { headers: { "content-type": "application/json" } }),
			new Request("https://0509.io/share/abc.data"),
		);

		expect(documentResponse.headers.get("x-robots-tag")).toBe("noindex, nofollow");
		expect(dataResponse.headers.get("x-robots-tag")).toBe("noindex, nofollow");
	});

	it("marks case-variant and percent-encoded /share aliases noindex too", () => {
		// React Router matches routes case-insensitively and after percent
		// decoding, so these aliases serve the SAME report as /share/<token> and
		// must carry the same noindex header (Google treats them as distinct URLs).
		const aliases = [
			"https://0509.io/SHARE/abc",
			"https://0509.io/Share/abc",
			"https://0509.io/%73hare/abc",
			"https://0509.io/SHARE/abc.data",
			"https://0509.io/%53hare/abc",
		];

		for (const url of aliases) {
			const response = withSecurityHeaders(
				new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
				new Request(url),
			);
			expect(response.headers.get("x-robots-tag"), url).toBe("noindex, nofollow");
		}
	});

	it("survives malformed percent-encoding without throwing", () => {
		const response = withSecurityHeaders(
			new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
			new Request("https://0509.io/share%9/abc"),
		);

		// decodeURIComponent throws on "%9"; the check must fall back to the raw
		// pathname instead of crashing the worker response path.
		expect(response.headers.get("x-robots-tag")).toBeNull();
	});

	it("does not mark public marketing pages noindex", () => {
		const homeResponse = withSecurityHeaders(
			new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
			new Request("https://0509.io/"),
		);
		const helpResponse = withSecurityHeaders(
			new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
			new Request("https://0509.io/help"),
		);
		const noRequestResponse = withSecurityHeaders(new Response("ok"));

		expect(homeResponse.headers.has("x-robots-tag")).toBe(false);
		expect(helpResponse.headers.has("x-robots-tag")).toBe(false);
		expect(noRequestResponse.headers.has("x-robots-tag")).toBe(false);
	});

  describe("anonymous public HTML caching", () => {
    it("lets anonymous public pages carry short browser caching", () => {
      for (const path of ["/", "/help", "/docs", "/terms", "/ads/nike.com", "/compare/magicbrief", "/compare/visualping", "/compare/spyland", "/compare/pulzifi", "/compare/foreplay"]) {
        const response = withSecurityHeaders(
          htmlResponse(),
          new Request(`https://0509.io${path}`),
        );
        expect(response.headers.get("cache-control"), path).toBe(PUBLIC_HTML_CACHE_CONTROL);
        expect(response.headers.get("vary"), path).toBe("cookie");
        expect(response.headers.has("cloudflare-cdn-cache-control"), path).toBe(false);
        expect(response.headers.has("pragma"), path).toBe(false);
      }
    });

    it("keeps signed-in requests no-store even on public paths", () => {
      const response = withSecurityHeaders(
        htmlResponse(),
        new Request("https://0509.io/", {
          headers: { cookie: "better-auth.session_token=session-123" },
        }),
      );
      expect(response.headers.get("cache-control")).toBe(HTML_NO_STORE_HEADERS["cache-control"]);
      expect(response.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
    });

    it("keeps app, auth, search, share, and status HTML no-store", () => {
      for (const path of ["/app", "/auth/login", "/search", "/share/abc", "/status", "/unsubscribe"]) {
        const response = withSecurityHeaders(
          htmlResponse(),
          new Request(`https://0509.io${path}`),
        );
        expect(response.headers.get("cache-control"), path).toBe(
          HTML_NO_STORE_HEADERS["cache-control"],
        );
      }
    });

    it("never caches responses that set cookies, non-200s, or non-GETs", () => {
      const setCookie = withSecurityHeaders(
        htmlResponse({ headers: { "set-cookie": "state=1" } }),
        new Request("https://0509.io/"),
      );
      const notFound = withSecurityHeaders(
        htmlResponse({ status: 404 }),
        new Request("https://0509.io/ads/unknown"),
      );
      const post = withSecurityHeaders(
        htmlResponse(),
        new Request("https://0509.io/", { method: "POST" }),
      );
      for (const response of [setCookie, notFound, post]) {
        expect(response.headers.get("cache-control")).toBe(HTML_NO_STORE_HEADERS["cache-control"]);
      }
    });

    it("bounds the stale window: no stale-while-revalidate on rebuild-sensitive HTML", () => {
      // Deploys drop old hashed assets; HTML served stale for longer than
      // max-age could reference assets that no longer exist (2026-07-13
      // asset-skew incident class). Keep the policy SWR-free.
      expect(PUBLIC_HTML_CACHE_CONTROL).not.toContain("stale-while-revalidate");
      expect(PUBLIC_HTML_CACHE_CONTROL).toBe("public, max-age=300");
    });

    it("keeps the live public-home deploy gate coupled to the product policy", () => {
      // The scripts/check-live-public-home.mjs deploy gate asserts EXACT
      // cache-control values on https://0509.io/. If the product policy ever
      // changes without the gate's expectation moving with it (the 2026-07-20
      // stale-gate incident: gate still wanted no-store after PR #360 shipped
      // public, max-age=300), deploys would fail on a policy that is actually
      // correct. Import both constants and assert they can never diverge.
      expect(EXPECTED_PUBLIC_HOME_CACHE_CONTROL).toBe(PUBLIC_HTML_CACHE_CONTROL);
      // The SSR-pricing variant (private) must stay within the same bounded,
      // SWR-free stale window the gate enforces for the shared-cache variant.
      expect(COUNTRY_VARYING_PUBLIC_HOME_CACHE_CONTROL).toBe("private, max-age=300");
      expect(COUNTRY_VARYING_PUBLIC_HOME_CACHE_CONTROL).not.toContain("stale-while-revalidate");
    });

    it("honors an explicitly-set cache-control on public cacheable HTML", () => {
      // The marketing page embeds buyer-country Dodo prices in its SSR HTML,
      // so it sets `private, max-age=300` itself. The worker must respect that
      // instead of stamping the generic public policy — a shared cache must
      // never replay one country's prices for another visitor.
      const response = withSecurityHeaders(
        new Response("<!doctype html>", {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "private, max-age=300",
            "vary": "cookie",
          },
        }),
        new Request("https://0509.io/"),
      );

      expect(response.headers.get("cache-control")).toBe("private, max-age=300");
      expect(response.headers.get("vary")).toBe("cookie");
      // Security headers still apply to the private variant.
      expect(response.headers.get("strict-transport-security")).toBe(
        SECURITY_HEADERS["strict-transport-security"],
      );
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    });

    it("keeps the live deploy gate's beacon-CSP contract coupled to the product policy", () => {
      // The gate asserts the LIVE script-src still allows the Cloudflare Web
      // Analytics beacon (PR #610). If the product CSP ever drops the beacon
      // host without the gate moving with it, deploys would pass while analytics
      // silently records zero page views. Import both constants and assert they
      // can never diverge.
      expect(EXPECTED_SCRIPT_SRC_BEACON_HOST).toBe(CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC);
    });

    it("honors an app-set cache-control on cacheable HTML instead of stamping the public policy", () => {
      // The marketing page embeds buyer-country Dodo prices in its SSR HTML
      // and therefore serves `private, max-age=300` (browser-only: a shared
      // cache must never replay one country's prices for another). The worker
      // must not override that with the generic public policy, and must not
      // fall into the no-store branch either.
      const response = withSecurityHeaders(
        htmlResponse({
          headers: {
            "cache-control": COUNTRY_VARYING_PUBLIC_HOME_CACHE_CONTROL,
            vary: "cookie",
          },
        }),
        new Request("https://0509.io/"),
      );

      expect(response.headers.get("cache-control")).toBe(COUNTRY_VARYING_PUBLIC_HOME_CACHE_CONTROL);
      expect(response.headers.get("vary")).toBe("cookie");
      expect(response.headers.has("cloudflare-cdn-cache-control")).toBe(false);
      expect(response.headers.has("pragma")).toBe(false);
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      // The live deploy gate accepts both bounded policies so the SSR-pricing
      // variant cannot break the deploy chain.
      expect(
        [EXPECTED_PUBLIC_HOME_CACHE_CONTROL, COUNTRY_VARYING_PUBLIC_HOME_CACHE_CONTROL],
      ).toContain(response.headers.get("cache-control"));
    });
  });

  it("leaves non-HTML asset caching alone", () => {
    const response = withSecurityHeaders(
      new Response("console.log('asset')", {
        headers: {
          "content-type": "application/javascript",
          "cache-control": "public, max-age=31536000, immutable",
        },
      }),
    );

    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.has("cloudflare-cdn-cache-control")).toBe(false);
  });
});
