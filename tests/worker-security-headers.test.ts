import { describe, expect, it } from "vitest";

import { SECURITY_HEADERS, withSecurityHeaders } from "../workers/security-headers";

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
});
