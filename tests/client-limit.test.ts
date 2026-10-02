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
});

describe("ipBucketKey", () => {
  it("keys an identified client by its IP", () => {
    expect(ipBucketKey("203.0.113.9")).toBe("ip:203.0.113.9");
  });

  it("puts a missing IP in one fixed bucket", () => {
    expect(ipBucketKey(null)).toBe("ip:absent");
  });

  // #6574 case 5 asks that ipBucketKey(null) differ from ipBucketKey("absent").
  // That cannot hold next to case 4: null is pinned to the literal "ip:absent",
  // so the string value "absent" maps to that same key (asserted below) and the
  // two can never differ. The satisfiable reading, and the one the issue's
  // Problem names ("instead of producing a key like `ip:null`"), is that a
  // missing IP never becomes a value-shaped key. The contradiction is reported
  // in the PR body.
  it("keeps the missing-IP bucket out of value-shaped and identified buckets", () => {
    expect(ipBucketKey(null)).not.toBe(ipBucketKey("null"));
    expect(ipBucketKey(null)).not.toBe(ipBucketKey("203.0.113.9"));
  });

  it("puts the literal string 'absent' in the same bucket as a missing IP", () => {
    // Characterises the collision #6574 case 5 calls impossible, so the finding
    // stays visible in code rather than only in the issue thread.
    expect(ipBucketKey("absent")).toBe(ipBucketKey(null));
  });
});
