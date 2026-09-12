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

describe("beauty-personal-care seed list (issue #3123)", () => {
  it("registers the beauty-personal-care list", () => {
    expect(SEED_LISTS["beauty-personal-care"]).toBeDefined();
    expect(resolveSeedList("beauty-personal-care")).not.toBeNull();
  });

  it("validates clean and carries exactly 29 domains, each with a real brand display name", () => {
    const list = SEED_LISTS["beauty-personal-care"];
    expect(validateSeedList(list)).toEqual([]);
    expect(list.domains).toHaveLength(29);
    // A brand display name ships as published page copy, so a literal
    // "placeholder" stub or a whitespace-only value must fail this pin —
    // the phase-1 review caught exactly that error class on credobeauty.com.
    for (const entry of list.domains) {
      const brand = entry.brand?.trim() ?? "";
      expect(brand.length > 0 && brand.toLowerCase() !== "placeholder").toBe(true);
    }
  });

  it("fits under the publisher cap so a targeted single-list run covers the whole cohort", () => {
    const list = SEED_LISTS["beauty-personal-care"];
    expect(list.domains.length).toBeLessThanOrEqual(ADS_DOMAIN_PUBLISHER_CAP_DEFAULT);
  });

  it("marks its domains as seeded brand domains", () => {
    expect(isSeededBrandDomain("sephora.com")).toBe(true);
    expect(isSeededBrandDomain("nykaa.com")).toBe(true);
    expect(isSeededBrandDomain("ELFCOSMETICS.COM")).toBe(true);
  });
});

describe("saas-software seed list (issue #3123)", () => {
  it("registers the saas-software list", () => {
    expect(SEED_LISTS["saas-software"]).toBeDefined();
    expect(resolveSeedList("saas-software")).not.toBeNull();
  });

  it("validates clean and carries exactly 36 domains, each with a real brand display name", () => {
    const list = SEED_LISTS["saas-software"];
    expect(validateSeedList(list)).toEqual([]);
    expect(list.domains).toHaveLength(36);
    // Same pin as beauty-personal-care: "placeholder" literals and
    // whitespace-only display names must fail here, not ship as page copy.
    for (const entry of list.domains) {
      const brand = entry.brand?.trim() ?? "";
      expect(brand.length > 0 && brand.toLowerCase() !== "placeholder").toBe(true);
    }
  });

  it("fits under the publisher cap so a targeted single-list run covers the whole cohort", () => {
    const list = SEED_LISTS["saas-software"];
    expect(list.domains.length).toBeLessThanOrEqual(ADS_DOMAIN_PUBLISHER_CAP_DEFAULT);
  });

  it("marks its domains as seeded brand domains", () => {
    expect(isSeededBrandDomain("hubspot.com")).toBe(true);
    expect(isSeededBrandDomain("notion.so")).toBe(true);
    expect(isSeededBrandDomain("SLACK.COM")).toBe(true);
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

  // nykaa.com and notion.so used to pin the false side here, but issue #3123
  // registered them via the beauty-personal-care and saas-software cohorts, so
  // they resolve true by design now. Swapped for genuinely unseeded domains —
  // the pin's job is that an UNRELATED thin domain keeps #1442 render-noindex.
  it.each(["wayfair.com", "bestbuy.com", "oura.com", "", "  ", "example.com"])(
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

  // Issue #3123 phase 3: pin the publish floor at the LIST-INPUT boundary, not
  // just the classifySeedListVerdict unit. A registered-list domain whose
  // coverage resolves to 0 verified + 0 likely (with a READY discovery, i.e.
  // genuinely proven-empty, not still warming) must come out of the run as a
  // skip that contributes NOTHING to the published surface, while a
  // neighbouring ≥1-verified domain in the same list publishes. This is the
  // boundary the nightly publisher actually gates on.
  it("skips a proven-empty (ready, 0+0) list domain and publishes its ≥1-verified neighbour — the publish floor at the list-input boundary", async () => {
    const [publishDomain, skipDomain] = SEED_LISTS["beauty-personal-care"]
      .domains.slice(0, 2)
      .map((entry) => entry.domain);

    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue({
        ads: [],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "miss",
      }),
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
      const countsFor = (displayDomain: string) =>
        displayDomain === publishDomain
          ? { verifiedCount: 1, likelyCount: 0, unmatchedCount: 0, discoveryEmptyReason: null }
          : {
              verifiedCount: 0,
              likelyCount: 0,
              unmatchedCount: 0,
              discoveryEmptyReason: "empty_search",
            };
      return {
        ...actual,
        buildSearchV2Context: vi.fn().mockImplementation(async (domain: string) => ({
          queryIntent: { intent: "domain", raw: domain, normalized: domain },
          scope: "exact",
          displayDomain: domain,
          identityAliases: [],
          domainAliases: [],
          advertiserPageId: null,
        })),
        applySearchV2PostFilter: vi.fn().mockImplementation(async (
          _env: unknown,
          _result: unknown,
          v2Context: { displayDomain: string },
        ) => ({
          ...countsFor(v2Context.displayDomain),
          discoveryProgress: "ready",
          discoveryStatus: "ok",
          discoverySummary: null,
          provider: "meta_library_browser",
          source: "meta_library_browser",
          cacheStatus: "miss",
        })),
      };
    });

    const { runAdsDomainPublisher } = await import("~/lib/ads-domain-publisher.server");
    const summary = await runAdsDomainPublisher(
      { DB: {} } as never,
      { waitUntil: () => {} } as never,
      { list: "beauty-personal-care", cap: 2 },
    );

    expect(summary.attempted).toBe(2);
    expect(summary.published).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.warming).toBe(0);
    expect(summary.failed).toBe(0);
    // Exactly the ≥1-verified domain counts toward the published surface; the
    // proven-empty one never does.
    expect(
      summary.outcomes.filter((o) => o.verdict === "publish").map((o) => o.domain),
    ).toEqual([publishDomain]);
    expect(summary.outcomes[0].verdict).toBe("publish");
    expect(summary.outcomes[0].verifiedCount).toBe(1);
    expect(summary.outcomes[1].verdict).toBe("skip");
    expect(summary.outcomes[1].domain).toBe(skipDomain);
    expect(summary.outcomes[1].reason).toContain(
      `No verified/likely coverage (0 verified, 0 likely`,
    );
    expect(summary.outcomes[1].reason).toContain(`empty reason: empty_search`);
  });
});

/**
 * Issue #2361: the nightly all-lists run iterates ALL SEED_LISTS as one
 * flattened queue, stops starting new scrapes at a ~10-minute internal
 * deadline, persists a last_offset cursor so the next night resumes where
 * this one stopped, and emits ads_domain_publisher_run with truncated:true
 * when the deadline bites. These cover the deadline/cursor logic against an
 * in-memory D1 cursor; the real migration read/write path is covered by
 * tests/integration/ads-domain-publisher-cursor.integration.test.ts.
 */
describe("runAdsDomainPublisher all-lists deadline + cursor (issue #2361)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("~/lib/ad-source.server");
    vi.doUnmock("~/lib/ad-persistence.server");
    vi.doUnmock("~/lib/search-rollout.server");
    vi.doUnmock("~/lib/search-v2.server");
    vi.doUnmock("~/lib/data/d1.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // The flattened all-lists queue: festive-india-2026 (30), sneaker-resale
  // (24), beauty-personal-care (29), saas-software (36) = 119 entries, in
  // Object.keys(SEED_LISTS) order. Issue #3123 grew the registry past
  // ADS_DOMAIN_PUBLISHER_CAP (default 60), so a full pass spans multiple
  // nights by design — full-pass tests derive the cap from the registry
  // instead of assuming one night covers the whole queue.
  const FESTIVE_COUNT = SEED_LISTS["festive-india-2026"].domains.length;
  const SNEAKER_FIRST_DOMAIN = SEED_LISTS["sneaker-resale"].domains[0].domain;
  const TOTAL_QUEUE = Object.values(SEED_LISTS).reduce(
    (sum, list) => sum + list.domains.length,
    0,
  );

  async function setupMocks({
    cursorOffset = 0,
    onCheckpoint,
  }: { cursorOffset?: number; onCheckpoint?: () => void } = {}) {
    let cursor = { last_list: "", last_offset: cursorOffset };
    const queryOne = vi.fn(async (_env: unknown, sql: string) => {
      if (/ads_domain_publisher_state/.test(sql)) {
        return cursor;
      }
      return null;
    });
    const execute = vi.fn(async (_env: unknown, sql: string, ...bindings: unknown[]) => {
      if (/ads_domain_publisher_state/.test(sql) && /ON CONFLICT/i.test(sql)) {
        cursor = { last_list: String(bindings[0]), last_offset: Number(bindings[1]) };
        onCheckpoint?.();
      }
      return {};
    });

    vi.doMock("~/lib/data/d1.server", () => ({
      queryOne,
      execute,
      ensureDb: vi.fn(),
      queryAll: vi.fn(),
      queryIn: vi.fn(),
      chunkForBoundParams: vi.fn(),
      D1_MAX_BOUND_PARAMS: 100,
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue({
        ads: [],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "miss",
      }),
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
          queryIntent: { intent: "domain", raw: "example.com", normalized: "example.com" },
          scope: "exact",
          displayDomain: "example.com",
          identityAliases: [],
          domainAliases: [],
          advertiserPageId: null,
        }),
        applySearchV2PostFilter: vi.fn().mockResolvedValue({
          verifiedCount: 1,
          likelyCount: 0,
          unmatchedCount: 0,
          discoveryProgress: "ready",
          discoveryStatus: "ok",
          discoveryEmptyReason: null,
          discoverySummary: null,
          provider: "meta_library_browser",
          source: "meta_library_browser",
          cacheStatus: "miss",
        }),
      };
    });
    return { queryOne, execute };
  }

  it("emits truncated:true and attempts nothing when the deadline is already past, leaving the cursor untouched", async () => {
    const { execute } = await setupMocks();
    const { runAdsDomainPublisher } = await import("~/lib/ads-domain-publisher.server");

    const summary = await runAdsDomainPublisher(
      { DB: {} } as never,
      { waitUntil: () => {} } as never,
      { cap: 60, deadlineAt: Date.now() - 1 },
    );

    expect(summary.truncated).toBe(true);
    expect(summary.attempted).toBe(0);
    // A zero-attempt deadline abort must not advance the cursor — the next
    // night tries the same spot instead of skipping it.
    expect(execute).not.toHaveBeenCalled();
  });

  it("processes up to the cap without truncation and persists the cursor at the next offset", async () => {
    const { execute } = await setupMocks();
    const { runAdsDomainPublisher } = await import("~/lib/ads-domain-publisher.server");

    const summary = await runAdsDomainPublisher(
      { DB: {} } as never,
      { waitUntil: () => {} } as never,
      { cap: 1, deadlineAt: Date.now() + 60_000 },
    );

    expect(summary.attempted).toBe(1);
    expect(summary.truncated).toBe(false);
    expect(summary.published).toBe(1);
    // Cursor checkpointed at offset 1 (the second queue entry, still inside
    // the first list) so the next night resumes there. One checkpoint per
    // completed domain is what survives an outright isolate kill.
    expect(execute).toHaveBeenCalledTimes(1);
    const [_env, _sql, list, offset] = execute.mock.calls[0];
    expect(list).toBe("festive-india-2026");
    expect(offset).toBe(1);
  });

  it("resumes from the persisted cursor offset so tail-list domains are not starved", async () => {
    const { execute } = await setupMocks({ cursorOffset: FESTIVE_COUNT });
    const { runAdsDomainPublisher } = await import("~/lib/ads-domain-publisher.server");

    const summary = await runAdsDomainPublisher(
      { DB: {} } as never,
      { waitUntil: () => {} } as never,
      { cap: 1, deadlineAt: Date.now() + 60_000 },
    );

    // Resumed at the sneaker-resale boundary (offset 30) and processed its
    // first domain, proving the cursor spans lists — not just the first one.
    expect(summary.attempted).toBe(1);
    expect(summary.outcomes[0].domain).toBe(SNEAKER_FIRST_DOMAIN);
    expect(execute).toHaveBeenCalledTimes(1);
    const [_env, _sql, list, offset] = execute.mock.calls[0];
    expect(list).toBe("sneaker-resale");
    expect(offset).toBe(FESTIVE_COUNT + 1);
  });

  it("wraps the cursor to the start after a full uninterrupted pass over every list", async () => {
    const { execute } = await setupMocks();
    const { runAdsDomainPublisher } = await import("~/lib/ads-domain-publisher.server");

    const summary = await runAdsDomainPublisher(
      { DB: {} } as never,
      { waitUntil: () => {} } as never,
      // Cap = the whole registry queue: since issue #3123 the flattened queue
      // exceeds ADS_DOMAIN_PUBLISHER_CAP, so a literal 60 would truncate the
      // pass mid-queue and this test would stop pinning the wrap-to-start.
      { cap: TOTAL_QUEUE, deadlineAt: Date.now() + 60_000 },
    );

    expect(summary.attempted).toBe(TOTAL_QUEUE);
    expect(summary.truncated).toBe(false);
    // Every completed domain checkpointed, and the last one wrapped the
    // cursor back to 0 so the rolling window restarts.
    expect(execute).toHaveBeenCalledTimes(TOTAL_QUEUE);
    const [_env, _sql, list, offset] = execute.mock.calls[TOTAL_QUEUE - 1];
    expect(offset).toBe(0);
    expect(list).toBe("festive-india-2026");
  });

  it("resumes exactly where a mid-queue deadline stopped the run", async () => {
    // A real clock cannot be fast-forwarded through a 10-minute deadline, so
    // drive Date.now() by hand: every completed domain costs 1ms of fake time
    // and the budget is 2ms, so the deadline bites after two domains.
    let fakeNow = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => fakeNow);

    const { execute } = await setupMocks({
      onCheckpoint: () => {
        fakeNow += 1;
      },
    });
    const { runAdsDomainPublisher } = await import("~/lib/ads-domain-publisher.server");

    const first = await runAdsDomainPublisher(
      { DB: {} } as never,
      { waitUntil: () => {} } as never,
      { cap: 60, deadlineAt: fakeNow + 2 },
    );

    expect(first.truncated).toBe(true);
    expect(first.attempted).toBe(2);
    // The last checkpoint is the offset the deadline stopped at — not the end
    // of the queue, and not the start of it.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][3]).toBe(2);

    // The next night starts at that offset, so no domain is starved and none
    // is re-scraped.
    const second = await runAdsDomainPublisher(
      { DB: {} } as never,
      { waitUntil: () => {} } as never,
      { cap: 1, deadlineAt: fakeNow + 60_000 },
    );

    expect(second.attempted).toBe(1);
    expect(second.outcomes[0].domain).toBe(SEED_LISTS["festive-india-2026"].domains[2].domain);
  });
});