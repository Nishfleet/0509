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
      new Request("https://0509.io/auth/stytch/callback"),
    );
    const appResponse = withSecurityHeaders(
      new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      new Request("https://0509.io/app"),
    );
    const publicWithAuthCookieResponse = withSecurityHeaders(
      new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      new Request("https://0509.io/", {
        headers: { cookie: "f9_stytch_session=session-123" },
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
