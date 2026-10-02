import { describe, expect, it } from "vitest";

import { clientIp, ipBucketKey } from "../app/lib/agent/client-limit.server";

// clientIp and ipBucketKey (app/lib/agent/client-limit.server.ts) choose the key
// every sign-in and agent rate-limit bucket uses, so the pair decides who shares
// a budget. Neither had a node test. The module imports nothing, so the plain
// node project runs it with no stub.
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
    // The edge always sends one real IP, so this only pins the passthrough: an
    // empty value is not turned into null, and its bucket is its own.
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
    // #6574 case 5 asks that ipBucketKey(null) differ from ipBucketKey("absent"),
    // but case 4 pins null to the literal "ip:absent", so the string "absent"
    // maps to that same key and the two can never differ. The satisfiable
    // reading, and the one the Problem names ("instead of producing a key like
    // `ip:null`"), is that a missing IP never becomes a value-shaped key. The
    // contradiction is reported in the PR body and issue #6581.
    expect(ipBucketKey(null)).toBe("ip:absent");
    expect(ipBucketKey(null)).not.toBe(ipBucketKey("null"));
    expect(ipBucketKey(null)).not.toBe(ipBucketKey("203.0.113.9"));
  });

  it("gives an empty header its own bucket, not the missing-IP bucket", () => {
    expect(ipBucketKey("")).toBe("ip:");
    expect(ipBucketKey("")).not.toBe(ipBucketKey(null));
  });
});
