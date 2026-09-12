import { describe, expect, it } from "vitest";

import {
  EXPECTED_FONT_SRC_FONTS_HOST,
  EXPECTED_PUBLIC_HOME_CACHE_CONTROL,
  EXPECTED_SCRIPT_SRC_BEACON_HOST,
  EXPECTED_STYLE_SRC_FONTS_HOST,
  FORBIDDEN_CONNECT_SRC_WILDCARD,
  FORBIDDEN_SCRIPT_SRC_KEYWORD,
  cspContract,
} from "../scripts/check-live-public-home.mjs";
import {
  CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC,
  CONNECT_SRC,
  cspAllowsReactRouterManifest,
  generateCspNonce,
  HTML_NO_STORE_HEADERS,
  PUBLIC_HTML_CACHE_CONTROL,
  REACT_ROUTER_MANIFEST_PATH,
  SECURITY_HEADERS,
  SITE_REP_WIDGET_HOST,
  withSecurityHeaders,
} from "../workers/security-headers";

// Baseline script-src has NO 'unsafe-inline' (issue #2348). A per-request nonce
// is injected by withSecurityHeaders when one is supplied; without a nonce the
// directive is 'self' + the edge-injected beacon only.
const BASE_SCRIPT_SRC = `script-src 'self' ${CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC}`;

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
    expect(cspDirective(response, "connect-src")).toBe(CONNECT_SRC);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("never allows 'unsafe-inline' in script-src (issue #2348)", () => {
    // Dropping 'unsafe-inline' is the whole point of the nonce move: a single
    // stored XSS must not be able to run an arbitrary inline script. This must
    // hold on every response — with a nonce, without one, on widget pages, and
    // on non-HTML responses.
    const cases = [
      withSecurityHeaders(new Response("ok")),
      withSecurityHeaders(htmlResponse(), new Request("https://0509.io/")),
      withSecurityHeaders(htmlResponse(), new Request("https://0509.io/app")),
      withSecurityHeaders(htmlResponse(), new Request("https://0509.io/"), "test-nonce-abc"),
      withSecurityHeaders(
        htmlResponse(),
        new Request("https://0509.io/", { headers: { cookie: "better-auth.session_token=x" } }),
        "test-nonce-abc",
      ),
    ];
    for (const response of cases) {
      const scriptSrc = cspDirective(response, "script-src") ?? "";
      expect(scriptSrc, response.headers.get("content-security-policy") ?? "").not.toContain(
        "'unsafe-inline'",
      );
    }
  });

  it("never allows a bare 'https:' wildcard in connect-src (issue #2348)", () => {
    // The bare `https:` wildcard let a single injected script exfiltrate
    // session data to any HTTPS host. connect-src must be an explicit allowlist
    // ('self' + the Site Rep widget host on widget pages) — never the scheme
    // wildcard. This must hold on every response.
    const cases = [
      withSecurityHeaders(new Response("ok")),
      withSecurityHeaders(htmlResponse(), new Request("https://0509.io/")),
      withSecurityHeaders(htmlResponse(), new Request("https://0509.io/app")),
      withSecurityHeaders(htmlResponse(), new Request("https://0509.io/"), "test-nonce-abc"),
    ];
    for (const response of cases) {
      const connectSrc = cspDirective(response, "connect-src") ?? "";
      // Match the bare scheme token `https:` only — not a full URL like
      // `https://siterep.net` which legitimately appears on widget pages.
      const tokens = connectSrc.split(/\s+/);
      expect(tokens, connectSrc).not.toContain("https:");
    }
  });

  it("injects the per-request nonce into script-src on HTML responses", () => {
    const nonce = generateCspNonce();
    const response = withSecurityHeaders(
      htmlResponse(),
      new Request("https://0509.io/app"),
      nonce,
    );
    const scriptSrc = cspDirective(response, "script-src") ?? "";
    expect(scriptSrc).toBe(`script-src 'self' ${CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC} 'nonce-${nonce}'`);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    // Without a nonce the directive stays the baseline (no nonce, no unsafe-inline).
    const noNonce = withSecurityHeaders(htmlResponse(), new Request("https://0509.io/app"));
    expect(cspDirective(noNonce, "script-src")).toBe(BASE_SCRIPT_SRC);
  });

  it("allows the Google Fonts stylesheet and font-file hosts so the fonts paths stay reachable", () => {
    // The deploy gate (scripts/check-live-public-home.mjs) fails a live deploy
    // when either Google Fonts host drops out of the CSP. Without this the
    // `@font-face` files are blocked, display=swap keeps the text readable, and
    // the only symptom is a wrong typeface nobody files a bug about. Both
    // halves — the stylesheet (style-src) and the font files (font-src) — are
    // asserted here so a tightening cannot silently drop one.
    const response = withSecurityHeaders(htmlResponse(), new Request("https://0509.io/"));
    expect(cspDirective(response, "style-src")).toContain(EXPECTED_STYLE_SRC_FONTS_HOST);
    expect(cspDirective(response, "font-src")).toContain(EXPECTED_FONT_SRC_FONTS_HOST);
    // The gate constants must stay coupled to the product policy: if the worker
    // stops serving a host the gate still requires, deploys fail on a policy
    // that is actually correct (the stale-gate incident class).
    expect(EXPECTED_STYLE_SRC_FONTS_HOST).toBe("https://fonts.googleapis.com");
    expect(EXPECTED_FONT_SRC_FONTS_HOST).toBe("https://fonts.gstatic.com");
  });

  it("keeps the live deploy gate's nonce-CSP contract coupled to the product policy", () => {
    // Issue #2348. The gate fails a live deploy on 'unsafe-inline' in
    // script-src or a bare `https:` in connect-src. Assert the gate's forbidden
    // tokens are exactly the ones the product policy does not emit, so the two
    // can never silently diverge in either direction.
    expect(FORBIDDEN_SCRIPT_SRC_KEYWORD).toBe("'unsafe-inline'");
    expect(FORBIDDEN_CONNECT_SRC_WILDCARD).toBe("https:");
    // Scope the check to script-src: 'unsafe-inline' legitimately REMAINS in
    // style-src (React Router's <Links /> emits inline <style>), and the issue
    // only asks for script-src. Asserting over the whole header would be a
    // false pass the moment style-src changed for an unrelated reason.
    const productCsp = SECURITY_HEADERS["content-security-policy"];
    const productScriptSrc = productCsp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("script-src ")) ?? "";
    expect(productScriptSrc).not.toContain(FORBIDDEN_SCRIPT_SRC_KEYWORD);
    // The bare scheme token must be absent while full-URL hosts remain allowed.
    expect(CONNECT_SRC.split(/\s+/)).not.toContain(FORBIDDEN_CONNECT_SRC_WILDCARD);
  });

  it("the deploy gate's cspContract flags the exact holes issue #2348 closed", () => {
    // A gate that cannot fail is not a gate. Pin the REAL header 0509.io served
    // when the issue was filed (curled 2026-09-09) and assert the gate flags
    // both holes, then assert the shipped policy passes. Without this, a future
    // edit could neuter cspContract and every other test would stay green.
    const liveHeader =
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com/beacon.min.js https://siterep.net; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self' https:; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    const liveVerdict = cspContract(liveHeader);
    expect(liveVerdict.unsafeInlineScriptSrc).toBe(true);
    expect(liveVerdict.connectSrcWildcard).toBe(true);
    // ...and the fonts paths were already fine, so the gate is not just always-fail.
    expect(liveVerdict.fontsStyleSrc).toBe(true);
    expect(liveVerdict.fontsFontSrc).toBe(true);

    const shipped = SECURITY_HEADERS["content-security-policy"];
    const shippedVerdict = cspContract(shipped);
    expect(shippedVerdict.unsafeInlineScriptSrc).toBe(false);
    expect(shippedVerdict.connectSrcWildcard).toBe(false);
    expect(shippedVerdict.fontsStyleSrc).toBe(true);
    expect(shippedVerdict.fontsFontSrc).toBe(true);

    // A full-URL host must never be mistaken for the bare scheme wildcard, or
    // the gate would fail on a correct policy.
    expect(
      cspContract("connect-src 'self' https://fonts.gstatic.com").connectSrcWildcard,
    ).toBe(false);

    // Sources are matched as whole tokens, never as substrings of a longer
    // token: a host smuggled inside another source's query string is NOT that
    // host. A substring match would credit it and let the gate pass a policy
    // that blocks the real fonts host. (CodeQL js/incomplete-url-substring-sanitization.)
    const smuggled = cspContract(
      "script-src 'self'; style-src 'self' https://evil.example/?u=https://fonts.googleapis.com; " +
        "font-src 'self' https://evil.example/#https://fonts.gstatic.com; connect-src 'self'",
    );
    expect(smuggled.fontsStyleSrc).toBe(false);
    expect(smuggled.fontsFontSrc).toBe(false);
    // ...and the same rule applies to the forbidden tokens, so an injected
    // keyword cannot hide inside a legitimately-shaped source either.
    expect(
      cspContract("script-src 'self' https://evil.example/?u='unsafe-inline'").unsafeInlineScriptSrc,
    ).toBe(false);
  });

  it("generates a fresh base64 nonce on each call", () => {
    const a = generateCspNonce();
    const b = generateCspNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(b).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
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
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toContain(CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC);
    expect(cspDirective(response, "connect-src")).toBe(CONNECT_SRC);
    expect(cspDirective(response, "connect-src")).toContain("'self'");
  });

  it("allows the Site Rep script + connect only on public widget HTML routes", () => {
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

    // The widget loads its script from AND makes API calls to siterep.net, so
    // both script-src and connect-src get the host on widget pages (issue #2348).
    expect(cspDirective(publicResponse, "script-src")).toBe(
      `${BASE_SCRIPT_SRC} ${SITE_REP_WIDGET_HOST}`,
    );
    expect(cspDirective(publicResponse, "connect-src")).toBe(
      `connect-src 'self' ${SITE_REP_WIDGET_HOST}`,
    );
    expect(cspDirective(authResponse, "script-src")).toBe(BASE_SCRIPT_SRC);
    expect(cspDirective(authResponse, "connect-src")).toBe(CONNECT_SRC);
    expect(cspDirective(appResponse, "script-src")).toBe(BASE_SCRIPT_SRC);
    expect(cspDirective(appResponse, "connect-src")).toBe(CONNECT_SRC);
    expect(cspDirective(publicWithAuthCookieResponse, "script-src")).toBe(BASE_SCRIPT_SRC);
    expect(cspDirective(publicWithAuthCookieResponse, "connect-src")).toBe(CONNECT_SRC);
  });

  it("combines the nonce and the Site Rep widget host in script-src on widget pages", () => {
    const nonce = generateCspNonce();
    const response = withSecurityHeaders(
      htmlResponse(),
      new Request("https://0509.io/"),
      nonce,
    );
    expect(cspDirective(response, "script-src")).toBe(
      `script-src 'self' ${CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC} 'nonce-${nonce}' ${SITE_REP_WIDGET_HOST}`,
    );
    expect(cspDirective(response, "connect-src")).toBe(
      `connect-src 'self' ${SITE_REP_WIDGET_HOST}`,
    );
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

	it("marks parameterised /search noindex, but keeps bare /search clean (issue #2965)", () => {
		// Every distinct query is otherwise an indexable URL — the mechanical
		// fix is the same edge-layer header /share/ already carries.
		const noindexed = [
			"https://0509.io/search?q=adidas",
			"https://0509.io/search?website=nike.com",
			"https://0509.io/search?q=",
			"https://0509.io/search?utm_source=x",
			"https://0509.io/search.data?q=adidas",
		];
		for (const url of noindexed) {
			const response = withSecurityHeaders(
				new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
				new Request(url),
			);
			expect(response.headers.get("x-robots-tag"), url).toBe("noindex, nofollow");
		}
		// Bare /search ("?" alone carries no parameter) is handled by the route
		// loader's 302 to /brands, not by this header — and an unknown-locale
		// /xx/search prefix must NOT match, so a future real /xx/search route
		// is never silently noindexed.
		const clean = ["https://0509.io/search?", "https://0509.io/xx/search?q=adidas"];
		for (const url of clean) {
			const response = withSecurityHeaders(
				new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
				new Request(url),
			);
			expect(response.headers.has("x-robots-tag"), url).toBe(false);
		}
	});

	it("marks buyer-surface locale /search twins noindex when parameterised", () => {
		for (const path of ["/de/search?q=adidas", "/ja/search?q=adidas", "/fr/search.data?q=nike"]) {
			const response = withSecurityHeaders(
				new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
				new Request(`https://0509.io${path}`),
			);
			expect(response.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
		}
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
      for (const path of ["/", "/help", "/docs", "/terms", "/ads/nike.com", "/timeline/nike.com", "/compare/visualping", "/compare/visualping-ad-library", "/compare/visualping-ad-libraries", "/compare/spyland", "/compare/pulzifi", "/compare/foreplay", "/compare/foreplay-spyder", "/compare/panoramata", "/compare/adspyder", "/compare/adspy", "/switch/panoramata", "/switch/visualping", "/switch/magicbrief", "/switch/adspy", "/methodology", "/methodology/ad-aggression-score"]) {
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
      // The last SSR-pricing private variant is gone (#2694); no second policy
      // is accepted by the gate anymore.
      expect(PUBLIC_HTML_CACHE_CONTROL).not.toContain("private");
    });

    it("honors an explicitly-set cache-control on public cacheable HTML", () => {
      // The worker must respect an app-set cache-control instead of stamping
      // the generic public policy (e.g. any future page that pins itself to a
      // browser-only variant — a shared cache must never replay one visitor's
      // state for another).
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
      // Security headers still apply to the explicitly-set private variant.
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
      // The worker must not override an app-set cache-control with the
      // generic public policy, and must not fall into the no-store branch
      // either.
      const response = withSecurityHeaders(
        htmlResponse({
          headers: {
            "cache-control": "private, max-age=300",
            vary: "cookie",
          },
        }),
        new Request("https://0509.io/"),
      );

      expect(response.headers.get("cache-control")).toBe("private, max-age=300");
      expect(response.headers.get("vary")).toBe("cookie");
      expect(response.headers.has("cloudflare-cdn-cache-control")).toBe(false);
      expect(response.headers.has("pragma")).toBe(false);
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
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

  it("enforces CSP on /trust and /app/billing HTML so the React Router manifest is not a Report-Only gap", () => {
    // Issue #1051: Firefox logged a Report-Only connect-src warning for the
    // auth-shell __manifest loader on these two pages. The worker must keep
    // the policy ENFORCED (not Report-Only) and connect-src must allow the
    // same-origin /__manifest fetch React Router lazy discovery makes.
    // /trust is a Site Rep widget page so its connect-src carries the widget
    // host too; /app/billing is an app route so it gets the baseline. Both
    // must still allow the same-origin __manifest fetch.
    for (const pathname of ["/trust", "/app/billing"]) {
      const response = withSecurityHeaders(
        htmlResponse(),
        new Request(`https://0509.io${pathname}`),
      );
      expect(response.headers.has("content-security-policy")).toBe(true);
      expect(response.headers.has("content-security-policy-report-only")).toBe(false);
      expect(
        cspAllowsReactRouterManifest(response.headers.get("content-security-policy") ?? ""),
      ).toBe(true);
    }
  });

  it("treats connect-src 'self' as covering the React Router __manifest fetch", () => {
    expect(REACT_ROUTER_MANIFEST_PATH).toBe("/__manifest");
    expect(cspAllowsReactRouterManifest("default-src 'self'; connect-src 'self' https:")).toBe(true);
    expect(cspAllowsReactRouterManifest("default-src 'self'; connect-src 'none'")).toBe(false);
    expect(cspAllowsReactRouterManifest("default-src 'none'")).toBe(false);
    expect(cspAllowsReactRouterManifest("script-src 'self'")).toBe(true);
    expect(
      cspAllowsReactRouterManifest(`default-src 'self'; connect-src https://0509.io${REACT_ROUTER_MANIFEST_PATH}`),
    ).toBe(true);
  });
});
