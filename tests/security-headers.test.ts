import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, withDocumentSecurityHeaders } from "../app/lib/security-headers";

describe("document security headers", () => {
  it("allows scripts only by this response's nonce", () => {
    const policy = contentSecurityPolicy("abc");
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).not.toMatch(/img-src[^;]*https:/);
  });

  it("adds every header without dropping what a route set", () => {
    const route = new Headers({ "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" });
    const merged = withDocumentSecurityHeaders(route, "n1");
    expect(merged.get("referrer-policy")).toBe("no-referrer");
    expect(merged.get("cache-control")).toBe("no-store");
    expect(merged.get("strict-transport-security")).toContain("max-age=31536000");
    expect(merged.get("x-content-type-options")).toBe("nosniff");
    expect(merged.get("x-frame-options")).toBe("DENY");
    expect(merged.get("content-security-policy")).toContain("'nonce-n1'");
    expect(route.has("content-security-policy")).toBe(false);
  });
});
