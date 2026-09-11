import { describe, expect, it } from "vitest";

import { csrfOriginGuardResponse, isCsrfGatedRequest } from "../workers/csrf-origin";

describe("csrf origin guard (issue #2986)", () => {
  it("403s a bare cross-site-style POST under /app/* with no origin evidence", () => {
    const response = csrfOriginGuardResponse(
      new Request("https://0509.io/app/collections/list-1/items/pizza", {
        method: "POST",
      }),
    );
    expect(response?.status).toBe(403);
  });

  it("403s bare POST/PUT/DELETE under /api/v1/*", () => {
    expect(
      csrfOriginGuardResponse(new Request("https://0509.io/api/v1/actions", { method: "POST" }))
        ?.status,
    ).toBe(403);
    expect(
      csrfOriginGuardResponse(
        new Request("https://0509.io/api/v1/collections/abc", { method: "PUT" }),
      )?.status,
    ).toBe(403);
    expect(
      csrfOriginGuardResponse(
        new Request("https://0509.io/api/v1/collections/list-1", { method: "DELETE" }),
      )?.status,
    ).toBe(403);
  });

  it("allows Sec-Fetch-Site same-origin and none", () => {
    const sameOrigin = csrfOriginGuardResponse(
      new Request("https://0509.io/app/collections/list-1", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(sameOrigin).toBeNull();
    const none = csrfOriginGuardResponse(
      new Request("https://0509.io/app/settings", {
        method: "POST",
        headers: { "sec-fetch-site": "none" },
      }),
    );
    expect(none).toBeNull();
  });

  it("allows a matching Origin header even without Fetch Metadata", () => {
    const matching = csrfOriginGuardResponse(
      new Request("https://0509.io/api/v1/actions", {
        method: "POST",
        headers: { origin: "https://0509.io" },
      }),
    );
    expect(matching).toBeNull();
    // Different port or host must not pass the Origin comparison.
    const wrongPort = csrfOriginGuardResponse(
      new Request("https://0509.io/api/v1/actions", {
        method: "POST",
        headers: { origin: "https://0509.io:8443" },
      }),
    );
    expect(wrongPort?.status).toBe(403);
  });

  it("403s a foreign Origin header", () => {
    const response = csrfOriginGuardResponse(
      new Request("https://0509.io/app/billing", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(response?.status).toBe(403);
  });

  it("403s cross-site Fetch Metadata even when the Origin header is absent", () => {
    const sameSite = csrfOriginGuardResponse(
      new Request("https://0509.io/app/billing", {
        method: "POST",
        headers: { "sec-fetch-site": "same-site" },
      }),
    );
    expect(sameSite?.status).toBe(403);
  });

  it("allows bearer-authenticated machine clients under /api/v1/* only", () => {
    const bearer = csrfOriginGuardResponse(
      new Request("https://0509.io/api/v1/actions", {
        method: "POST",
        headers: { authorization: "Bearer fnk_test_123" },
      }),
    );
    expect(bearer).toBeNull();
    // A bare Authorization header does NOT exempt /app/* — cookie-session
    // territory keeps the full same-origin requirement.
    const appBearer = csrfOriginGuardResponse(
      new Request("https://0509.io/app/billing", {
        method: "POST",
        headers: { authorization: "Bearer whatever" },
      }),
    );
    expect(appBearer?.status).toBe(403);
  });

  it("is inert outside /app/* and /api/v1/* and on safe methods", () => {
    // GET under gated paths is never blocked.
    expect(
      csrfOriginGuardResponse(new Request("https://0509.io/app/watchlists")),
    ).toBeNull();
    // /api/mcp (not /api/v1) and webhooks stay open for external callers.
    expect(
      csrfOriginGuardResponse(new Request("https://0509.io/api/mcp", { method: "POST" })),
    ).toBeNull();
    expect(
      csrfOriginGuardResponse(new Request("https://0509.io/api/webhooks/stripe", { method: "POST" })),
    ).toBeNull();
    // Public pricing POST (e.g. a future public form) stays untouched.
    expect(
      csrfOriginGuardResponse(new Request("https://0509.io/pricing", { method: "POST" })),
    ).toBeNull();
  });

  it("gates exactly POST/PUT/DELETE under /app or /api/v1", () => {
    expect(
      isCsrfGatedRequest(new Request("https://0509.io/app/x", { method: "PATCH" })),
    ).toBe(false);
    expect(
      isCsrfGatedRequest(new Request("https://0509.io/api/v1/actions", { method: "POST" })),
    ).toBe(true);
    // Segment boundary: /app-evil and /api/v10 are NOT gated.
    expect(
      isCsrfGatedRequest(new Request("https://0509.io/app-evil/status", { method: "POST" })),
    ).toBe(false);
    expect(
      isCsrfGatedRequest(new Request("https://0509.io/api/v10/webhook", { method: "POST" })),
    ).toBe(false);
  });
});
