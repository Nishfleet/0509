import { describe, expect, it } from "vitest";

import {
  HTML_NO_STORE_HEADERS,
  SECURITY_HEADERS,
  withSecurityHeaders,
} from "../workers/security-headers";

describe("Worker security headers", () => {
  it("applies baseline security headers to responses", () => {
    const response = withSecurityHeaders(new Response("ok"));

    expect(response.headers.get("strict-transport-security")).toBe(
      SECURITY_HEADERS["strict-transport-security"],
    );
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
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
