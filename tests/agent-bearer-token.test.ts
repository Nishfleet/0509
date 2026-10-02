import { describe, expect, it } from "vitest";

import { bearerToken } from "../app/lib/agent/keys.server";

function requestWith(authorization?: string): Request {
  return new Request("https://0509.io/", authorization === undefined ? {} : { headers: { authorization } });
}

describe("bearerToken (0509#6573)", () => {
  it("returns the token from a Bearer header", () => {
    expect(bearerToken(requestWith("Bearer abc"))).toBe("abc");
  });

  it("reads the scheme case-insensitively", () => {
    expect(bearerToken(requestWith("bearer abc"))).toBe("abc");
    expect(bearerToken(requestWith("BEARER abc"))).toBe("abc");
  });

  it("ignores padding around the scheme and the token", () => {
    expect(bearerToken(requestWith("  Bearer   abc  "))).toBe("abc");
  });

  it("returns null when the request carries no authorization header", () => {
    expect(bearerToken(requestWith())).toBeNull();
  });

  it("returns null for another scheme", () => {
    expect(bearerToken(requestWith("Basic abc"))).toBeNull();
  });

  it("returns null when Bearer carries no token", () => {
    expect(bearerToken(requestWith("Bearer"))).toBeNull();
  });

  it("returns null when Bearer carries a third part", () => {
    expect(bearerToken(requestWith("Bearer a b"))).toBeNull();
  });
});
