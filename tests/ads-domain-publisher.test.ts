import { describe, expect, it } from "vitest";

import {
  classifySeedListVerdict,
  PUBLISHER_SEED_LIST_MAX_DOMAINS,
  resolveSeedList,
  SEED_LISTS,
  validateSeedList,
  type SeedList,
} from "~/lib/ads-domain-publisher.server";

const validList: SeedList = {
  cluster: "test-cluster",
  asOf: "2026-09-01",
  domains: [
    { domain: "nike.com", brand: "Nike" },
    { domain: "stockx.com" },
  ],
};

describe("classifySeedListVerdict (BET 5a publish floor)", () => {
  it("publishes with one verified ad", () => {
    expect(classifySeedListVerdict(1, 0)).toBe("publish");
  });

  it("publishes with one likely ad", () => {
    expect(classifySeedListVerdict(0, 1)).toBe("publish");
  });

  it("publishes with verified + likely mixed", () => {
    expect(classifySeedListVerdict(3, 2)).toBe("publish");
  });

  it("skips unmatched-only coverage — the page would ship an unproven wall", () => {
    expect(classifySeedListVerdict(0, 0)).toBe("skip");
  });

  it("skips empty coverage", () => {
    expect(classifySeedListVerdict(0, 0)).toBe("skip");
  });
});

describe("validateSeedList", () => {
  it("accepts a well-formed list", () => {
    expect(validateSeedList(validList)).toEqual([]);
  });

  it("rejects a missing cluster name", () => {
    expect(validateSeedList({ ...validList, cluster: "" })).toContain(
      "cluster must be a non-empty string",
    );
  });

  it("rejects a missing asOf", () => {
    expect(validateSeedList({ ...validList, asOf: "" })).toContain(
      "asOf must be a non-empty string",
    );
  });

  it("rejects an empty domains array", () => {
    expect(validateSeedList({ ...validList, domains: [] })).toContain(
      "domains must be a non-empty array",
    );
  });

  it("rejects an entry with no domain", () => {
    expect(
      validateSeedList({
        ...validList,
        domains: [{ domain: "nike.com" }, { domain: "" }],
      }),
    ).toContainEqual(expect.stringContaining("entry with missing domain"));
  });

  it("rejects a non-http(s) entry", () => {
    expect(
      validateSeedList({
        ...validList,
        domains: [{ domain: "nike.com" }, { domain: "ftp://nike.com" }],
      }),
    ).toContainEqual(
      expect.stringContaining('domain "ftp://nike.com" is not a valid http(s) hostname'),
    );
  });

  it("rejects duplicate domains case-insensitively", () => {
    expect(
      validateSeedList({
        ...validList,
        domains: [{ domain: "nike.com" }, { domain: "Nike.COM" }],
      }),
    ).toContain('duplicate domain "Nike.COM"');
  });

  it("rejects a list over the domain ceiling", () => {
    const domains = Array.from({ length: PUBLISHER_SEED_LIST_MAX_DOMAINS + 1 }, (_, i) => ({
      domain: `brand${i}.com`,
    }));
    expect(validateSeedList({ ...validList, domains })).toContain(
      `domains exceeds the ${PUBLISHER_SEED_LIST_MAX_DOMAINS} entry ceiling`,
    );
  });
});

describe("SEED_LISTS registry", () => {
  it("registers the sneaker-resale list (market-signal cluster, issue #1547)", () => {
    expect(SEED_LISTS["sneaker-resale"]).toBeDefined();
  });

  it("sneaker-resale list validates clean and carries enough entries to clear the 15-domain publish gate", () => {
    const list = SEED_LISTS["sneaker-resale"];
    expect(validateSeedList(list)).toEqual([]);
    // The issue's verify gate is ≥15 domains WOULD publish; the seed list must
    // at least carry that many candidates or the gate is structurally dead.
    expect(list.domains.length).toBeGreaterThanOrEqual(15);
  });

  it("rejects unknown list names", () => {
    expect(resolveSeedList("not-a-list")).toBeNull();
  });
});