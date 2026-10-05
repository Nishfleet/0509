import { describe, expect, it } from "vitest";

import { allowedRedirectUri } from "../../app/lib/agent/redirect-uri";

describe("allowedRedirectUri", () => {
  it("accepts https and loopback http", () => {
    expect(allowedRedirectUri("https://app.example/callback")).toBe(true);
    expect(allowedRedirectUri("http://localhost:8787/cb")).toBe(true);
    expect(allowedRedirectUri("http://127.0.0.1/cb")).toBe(true);
    expect(allowedRedirectUri("http://[::1]/cb")).toBe(true);
    expect(allowedRedirectUri("http://127.0.0.8/cb")).toBe(true);
  });

  it("rejects remote http, custom schemes, and garbage", () => {
    expect(allowedRedirectUri("http://evil.example/callback")).toBe(false);
    expect(allowedRedirectUri("cursor://callback")).toBe(false);
    expect(allowedRedirectUri("not a uri")).toBe(false);
  });
});
