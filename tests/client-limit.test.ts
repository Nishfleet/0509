import { describe, expect, it } from "vitest";

import { clientIp, ipBucketKey } from "../app/lib/agent/client-limit.server";

describe("clientIp", () => {
  it("returns the IP the edge put in cf-connecting-ip", () => {
    const request = new Request("https://0509.io/", {
      headers: { "cf-connecting-ip": "203.0.113.9" },
    });
    expect(clientIp(request)).toBe("203.0.113.9");
  });

  it("returns null when no cf-connecting-ip header arrived", () => {
    expect(clientIp(new Request("https://0509.io/"))).toBeNull();
  });

  it("returns the raw header value when it is empty or whitespace", () => {
    expect(clientIp(new Request("https://0509.io/", { headers: { "cf-connecting-ip": "" } }))).toBe("");
    expect(clientIp(new Request("https://0509.io/", { headers: { "cf-connecting-ip": "   " } }))).toBe("");
  });

  it("returns a multi-value header verbatim, without parsing", () => {
    const request = new Request("https://0509.io/", {
      headers: { "cf-connecting-ip": "203.0.113.9, 10.0.0.1" },
    });
    expect(clientIp(request)).toBe("203.0.113.9, 10.0.0.1");
  });
});

describe("ipBucketKey", () => {
  it("keys an identified client by its IP", () => {
    expect(ipBucketKey("203.0.113.9")).toBe("ip:203.0.113.9");
  });

  it("puts a missing IP in one fixed bucket", () => {
    expect(ipBucketKey(null)).toBe("ip:absent");
  });

  it("keeps the missing-IP bucket out of value-shaped and identified buckets", () => {
    expect(ipBucketKey(null)).toBe("ip:absent");
    expect(ipBucketKey(null)).not.toBe(ipBucketKey("null"));
    expect(ipBucketKey(null)).not.toBe(ipBucketKey("203.0.113.9"));
  });

  it("gives an empty header its own bucket, not the missing-IP bucket", () => {
    expect(ipBucketKey("")).toBe("ip:");
    expect(ipBucketKey("")).not.toBe(ipBucketKey(null));
  });
});
