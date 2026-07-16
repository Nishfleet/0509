import { describe, expect, it } from "vitest";

import {
  HTML_NO_STORE_HEADERS,
  SECURITY_HEADERS,
  withSecurityHeaders,
} from "../workers/security-headers";

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
    expect(cspDirective(response, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(cspDirective(response, "connect-src")).toBe("connect-src 'self' https:");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
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
      "script-src 'self' 'unsafe-inline' https://siterep.net",
    );
    expect(cspDirective(authResponse, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(cspDirective(appResponse, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(cspDirective(publicWithAuthCookieResponse, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
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
