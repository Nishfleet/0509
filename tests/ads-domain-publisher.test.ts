import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADS_DOMAIN_PUBLISHER_CAP_DEFAULT,
  classifySeedListVerdict,
  isSeededBrandDomain,
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

describe("festive-india-2026 seed list (issue #2140)", () => {
  it("registers the festive-india-2026 list", () => {
    expect(SEED_LISTS["festive-india-2026"]).toBeDefined();
    expect(resolveSeedList("festive-india-2026")).not.toBeNull();
  });

  it("validates clean and carries exactly 30 domains, each with a brand display name", () => {
    const list = SEED_LISTS["festive-india-2026"];
    expect(validateSeedList(list)).toEqual([]);
    expect(list.domains).toHaveLength(30);
    for (const entry of list.domains) {
      expect(entry.brand?.trim()).toBeTruthy();
    }
  });

  it("fits under the publisher cap so the whole cohort runs in one nightly pass", () => {
    const list = SEED_LISTS["festive-india-2026"];
    expect(list.domains.length).toBeLessThanOrEqual(ADS_DOMAIN_PUBLISHER_CAP_DEFAULT);
  });

  it("marks its domains as seeded brand domains", () => {
    expect(isSeededBrandDomain("sugarcosmetics.com")).toBe(true);
    expect(isSeededBrandDomain("boat-lifestyle.com")).toBe(true);
    expect(isSeededBrandDomain("COUNTRYDELIGHT.IN")).toBe(true);
  });

  it("publish floor keeps only domains with at least one verified ad", () => {
    expect(classifySeedListVerdict(1, 0)).toBe("publish");
    expect(classifySeedListVerdict(0, 1)).toBe("publish");
    expect(classifySeedListVerdict(0, 0)).toBe("skip");
  });
});

describe("isSeededBrandDomain (issue #1306 retire-scope guard)", () => {
  // The /ads/:domain loader uses this to decide whether a thin (0
  // verified-linked ads) page retires to /search or renders noindex. The
  // sneaker-resale cluster's marketplace nouns must resolve true so goat.com
  // retires, while an unrelated thin domain resolves false so #1442's
  // render-noindex behavior is preserved for direct visitors.
  it.each([
    "stockx.com",
    "goat.com",
    "nike.com",
    "saucony.com",
    "hoka.com",
    "STOCKX.COM",
    "goat.com.",
  ])("recognizes %s as a seeded brand", (domain) => {
    expect(isSeededBrandDomain(domain)).toBe(true);
  });

  it.each(["nykaa.com", "notion.so", "oura.com", "", "  ", "example.com"])(
    "does not recognize %s as a seeded brand (keeps #1442 render-noindex)",
    (domain) => {
      expect(isSeededBrandDomain(domain)).toBe(false);
    },
  );
});

describe("publishSeedListDomain warming verdict (issue #2210)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("~/lib/ad-source.server");
    vi.doUnmock("~/lib/ad-persistence.server");
    vi.doUnmock("~/lib/search-rollout.server");
    vi.doUnmock("~/lib/search-v2.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("classifies a resolver warming placeholder as warming, not skip, and counts it under warming in the run summary", async () => {
    const warmingResult = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "degraded",
      discoveryProgress: "warming",
      discoverySummary: "Commercial discovery is warming this query.",
      discoveryFailureClass: null,
    };

    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(warmingResult),
    }));
    vi.doMock("~/lib/ad-persistence.server", () => ({
      hydrateAdsWithPersistedCreatives: vi.fn(async (_env: unknown, ads: unknown[]) => ads),
    }));
    vi.doMock("~/lib/search-rollout.server", () => ({
      shouldApplySearchV2: vi.fn(() => true),
    }));
    vi.doMock("~/lib/search-v2.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/search-v2.server")>(
        "~/lib/search-v2.server",
      );
      return {
        ...actual,
        buildSearchV2Context: vi.fn().mockResolvedValue({
          queryIntent: { intent: "domain", raw: "nike.com", normalized: "nike.com" },
          scope: "exact",
          displayDomain: "nike.com",
          identityAliases: [],
          domainAliases: [],
          advertiserPageId: null,
        }),
      };
    });

    const { runAdsDomainPublisher } = await import("~/lib/ads-domain-publisher.server");
    const summary = await runAdsDomainPublisher(
      { DB: {} } as never,
      { waitUntil: () => {} } as never,
      { list: "sneaker-resale", cap: 1 },
    );

    expect(summary.warming).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.published).toBe(0);
    expect(summary.outcomes).toHaveLength(1);
    expect(summary.outcomes[0].verdict).toBe("warming");
    expect(summary.outcomes[0].reason).not.toContain("No verified/likely coverage");
    expect(summary.outcomes[0].reason).toContain("warming");
  });
});