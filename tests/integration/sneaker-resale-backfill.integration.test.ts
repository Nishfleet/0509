import { describe, expect, it } from "vitest";

import {
  runSneakerResaleBackfill,
  runSneakerResaleProofHoleCatchUp,
  sneakerResaleBackfillRowId,
  summarizeSneakerResaleBackfill,
  type SneakerResaleTierLookup,
} from "~/lib/sneaker-resale-backfill.server";
import type {
  SneakerResaleCohortEntry,
  SneakerResaleTier,
} from "~/lib/sneaker-resale-cohort";
import {
  loadOfferTimeline,
  snapshotRowHasCompleteProof,
} from "~/lib/offer-timeline.server";

import { appEnv, db } from "./fixtures";

/**
 * Nightly sneaker-resale cohort backfill (issue #1946, phase 2) against the
 * real migration set. Mirrors `demo-brand-backfill.integration.test.ts`:
 * capture is stubbed (the real pipeline needs Browser Rendering), every
 * D1 read/write is real, and the proof gate (issue #1284) is asserted by
 * loading the public timeline directly.
 *
 * The cohort is built by the production default path (seed list →
 * `deriveSneakerResaleCohort`), but the cohort entry array AND the
 * discovery-cache tier lookup are injected via the `cohort` / `tierLookup`
 * options. Production code paths never read these seams — they exist for
 * tests that do not want to populate `discovery_cache_entry` (the phase-1
 * source of truth for the tier map).
 */

const COHORT_BRANDS = [
  { domain: "stockx.com", brand: "StockX" },
  { domain: "nike.com", brand: "Nike" },
  { domain: "goat.com", brand: "GOAT" },
] as const;

// `saucony.com` is the excluded brand. It MUST be in the bundled
// `data/seed-lists/sneaker-resale.json` so the production default
// `resolveSeedList("sneaker-resale")` surfaces it; the only thing keeping
// it out of the cohort is `deriveSneakerResaleCohort`'s `hasCoverage`
// filter. Using a brand that's not in the seed list would make the
// missing-tier branch (not the hasCoverage branch) do the dropping, which
// is not what the regression guard is supposed to prove.
const EXCLUDED_BRANDS = [
  { domain: "saucony.com", brand: "Saucony" },
] as const;

function tier(overrides: Partial<SneakerResaleTier>): SneakerResaleTier {
  return {
    verifiedCount: 0,
    likelyCount: 0,
    unmatchedCount: 0,
    hasCoverage: false,
    cacheStatus: "stale",
    ...overrides,
  };
}

function coveredCohort(): SneakerResaleCohortEntry[] {
  return COHORT_BRANDS.map((entry, index) => ({
    domain: entry.domain,
    brand: entry.brand,
    tier: tier({
      verifiedCount: 2 + index,
      likelyCount: 1,
      unmatchedCount: 0,
      hasCoverage: true,
      cacheStatus: "fresh",
    }),
  }));
}

function excludedCohort(): SneakerResaleCohortEntry[] {
  return EXCLUDED_BRANDS.map((entry) => ({
    domain: entry.domain,
    brand: entry.brand,
    tier: tier({
      verifiedCount: 0,
      likelyCount: 0,
      unmatchedCount: 3,
      hasCoverage: false,
      cacheStatus: "fresh",
    }),
  }));
}

function mixedCohort(): SneakerResaleCohortEntry[] {
  return [...coveredCohort(), ...excludedCohort()];
}

function tierLookupFor(entries: readonly SneakerResaleCohortEntry[]): SneakerResaleTierLookup {
  return async () => {
    const map = new Map<string, SneakerResaleTier>();
    for (const entry of entries) {
      map.set(entry.domain, entry.tier);
    }
    return map;
  };
}

function hex32(seed: string): string {
  return (seed + "0".repeat(32)).slice(0, 32).replace(/[^a-f0-9]/gi, "f");
}

function makeStubCapture(day: string, index: number) {
  const snapshotFor = (domain: string) => {
    const hex = hex32(`${day}${index}${domain}`);
    const htmlKey = `landing-pages/${day}/${hex}.html`;
    const screenshotKey = `landing-pages/${day}/${hex}.jpeg`;
    const capturedAt = `${day}T0${(index % 9) + 1}:30:00.000Z`;
    return {
      domain,
      snapshot: {
        rawUrl: `https://www.${domain}/`,
        canonicalUrl: `https://www.${domain}/`,
        rawHeadline: `Sneaker-resale offer headline for ${domain} on ${day}`,
        normalizedHeadline: `sneaker-resale offer headline for ${domain} on ${day}`,
        normalizedHeadlineHash: `hash-${day}-${index}-${domain}`,
        ctaText: "Shop now",
        priceText: null,
        formPresent: false,
        captureMethod: "browser_render",
        capturedAt,
        artifactKey: htmlKey,
        metadata: {
          captureMethod: "browser_render",
          screenshotArtifactKey: screenshotKey,
          htmlArtifactKey: htmlKey,
          extractorVersion: "test-stub",
        },
      },
    };
  };
  return snapshotFor;
}

async function backfilledRowCount(domain: string): Promise<number> {
  const row = await db()
    .prepare(
      `SELECT count(*) AS n FROM landing_page_snapshot
       WHERE id LIKE ?`,
    )
    .bind(`sneaker-${domain}-%`)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

describe("sneaker-resale cohort nightly backfill (issue #1946, phase 2)", () => {
  it("writes one proof-complete row per cohort brand and the timeline renders it", async () => {
    const day = "2026-09-05";
    const stub = makeStubCapture(day, 0);
    const captureStub = async (_env: unknown, url: string) => {
      const domain = COHORT_BRANDS.find((b) => url.includes(b.domain));
      if (!domain) return null;
      return stub(domain.domain).snapshot;
    };

    const result = await runSneakerResaleBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      cohort: coveredCohort(),
      tierLookup: tierLookupFor(coveredCohort()),
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(COHORT_BRANDS.length);
    expect(result.failedCount).toBe(0);
    expect(result.day).toBe(day);
    for (const brand of COHORT_BRANDS) {
      const domainResult = result.domains.find((r) => r.domain === brand.domain);
      expect(domainResult?.status).toBe("captured");
      expect(domainResult?.snapshotId).toBe(
        sneakerResaleBackfillRowId(brand.domain, day),
      );
      expect(await backfilledRowCount(brand.domain)).toBe(1);
    }

    // The proof gate now accepts the rows: the public timeline has at least
    // one dated state per cohort brand (instead of the 410 the empty
    // ledger caused).
    for (const brand of COHORT_BRANDS) {
      const loaded = await loadOfferTimeline(appEnv, {
        domain: brand.domain,
        asOf: null,
      });
      expect(loaded.entries.length).toBeGreaterThanOrEqual(1);
      const entry = loaded.entries[0];
      expect(entry?.screenshotHref).toMatch(/^\/artifacts\/proof\//);
      expect(entry?.pageTextHref).toMatch(/^\/artifacts\/page-text\//);
    }
  });

  it("is idempotent per UTC day: a cron re-run never double-appends a row", async () => {
    const day = "2026-09-12";
    const stub = makeStubCapture(day, 1);
    const captureStub = async (_env: unknown, url: string) => {
      const domain = COHORT_BRANDS.find((b) => url.includes(b.domain));
      if (!domain) return null;
      return stub(domain.domain).snapshot;
    };

    const first = await runSneakerResaleBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      cohort: coveredCohort(),
      tierLookup: tierLookupFor(coveredCohort()),
      capture: captureStub as never,
    });
    expect(first.capturedCount).toBe(COHORT_BRANDS.length);

    const second = await runSneakerResaleBackfill(appEnv, {
      now: new Date(`${day}T01:05:00.000Z`),
      cohort: coveredCohort(),
      tierLookup: tierLookupFor(coveredCohort()),
      capture: captureStub as never,
    });
    expect(second.capturedCount).toBe(0);
    expect(second.failedCount).toBe(0);
    expect(
      second.domains.every((r) => r.status === "skipped_already_captured"),
    ).toBe(true);

    for (const brand of COHORT_BRANDS) {
      const row = await db()
        .prepare(
          `SELECT count(*) AS n FROM landing_page_snapshot WHERE id = ?`,
        )
        .bind(sneakerResaleBackfillRowId(brand.domain, day))
        .first<{ n: number }>();
      expect(Number(row?.n ?? 0)).toBe(1);
    }
  });

  it("accumulates a dated ledger across three consecutive nights", async () => {
    for (const [day, index] of [
      ["2026-09-20", 2],
      ["2026-09-21", 3],
      ["2026-09-22", 4],
    ] as const) {
      const stub = makeStubCapture(day, index);
      const captureStub = async (_env: unknown, url: string) => {
        const domain = COHORT_BRANDS.find((b) => url.includes(b.domain));
        if (!domain) return null;
        return stub(domain.domain).snapshot;
      };
      const result = await runSneakerResaleBackfill(appEnv, {
        now: new Date(`${day}T01:00:00.000Z`),
        cohort: coveredCohort(),
        tierLookup: tierLookupFor(coveredCohort()),
        capture: captureStub as never,
      });
      expect(result.capturedCount).toBe(COHORT_BRANDS.length);
    }

    for (const brand of COHORT_BRANDS) {
      const loaded = await loadOfferTimeline(appEnv, {
        domain: brand.domain,
        asOf: null,
      });
      expect(loaded.entries.length).toBeGreaterThanOrEqual(3);
      const dates = loaded.entries.map((e) => e.capturedAt).sort();
      expect(Date.parse(dates[0]!)).toBeLessThan(Date.parse(dates[1]!));
      expect(Date.parse(dates[1]!)).toBeLessThan(Date.parse(dates[2]!));
    }
  });

  it("records per-brand capture failures without losing the other brands", async () => {
    const day = "2026-09-28";
    const stub = makeStubCapture(day, 5);
    const captureStub = async (_env: unknown, url: string) => {
      const domain = COHORT_BRANDS.find((b) => url.includes(b.domain));
      if (!domain) return null;
      if (domain.domain === "nike.com") {
        return null;
      }
      return stub(domain.domain).snapshot;
    };

    const result = await runSneakerResaleBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      cohort: coveredCohort(),
      tierLookup: tierLookupFor(coveredCohort()),
      capture: captureStub as never,
    });

    const nike = result.domains.find((r) => r.domain === "nike.com");
    expect(nike?.status).toBe("capture_failed");
    // No row for the failed day was written for nike.com.
    const nikeFailedDay = await db()
      .prepare(
        `SELECT count(*) AS n FROM landing_page_snapshot
         WHERE canonical_url = ? AND captured_at LIKE ?`,
      )
      .bind(`https://www.nike.com/`, `${day}%`)
      .first<{ n: number }>();
    expect(Number(nikeFailedDay?.n ?? 0)).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.capturedCount).toBe(COHORT_BRANDS.length - 1);
  });

  it("never writes a phantom row for a brand whose tier has hasCoverage: false", async () => {
    const day = "2026-10-01";
    const stub = makeStubCapture(day, 6);
    // We deliberately do NOT pass `cohort` here: the production default
    // path is `resolveSeedList → tierLookup → deriveSneakerResaleCohort`,
    // and the filter that drops `hasCoverage: false` lives in the last
    // step. Passing `cohort` would short-circuit that filter and the test
    // would pass for the wrong reason. The capture stub would happily
    // return a snapshot for any URL — the only thing keeping the excluded
    // brand off the timeline is the cohort filter.
    const captureStub = async (_env: unknown, url: string) => {
      const brand = mixedCohort().find((entry) =>
        url.includes(entry.domain),
      );
      if (!brand) return null;
      return stub(brand.domain).snapshot;
    };

    // Mixed tier map: covered brands + the excluded brand with
    // `hasCoverage: false`. Only the covered brands should survive the
    // `deriveSneakerResaleCohort` filter inside `buildSneakerResaleCohort`.
    const tierByDomain = new Map<string, SneakerResaleTier>();
    for (const entry of mixedCohort()) {
      tierByDomain.set(entry.domain, entry.tier);
    }
    const tierLookup: SneakerResaleTierLookup = async () => tierByDomain;

    const result = await runSneakerResaleBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      tierLookup,
      capture: captureStub as never,
    });

    // The excluded brand must not appear in the result at all.
    const excludedEntry = result.domains.find(
      (r) => r.domain === EXCLUDED_BRANDS[0]?.domain,
    );
    expect(excludedEntry).toBeUndefined();

    // And no row was written for the excluded brand on this UTC day.
    const excludedRows = await db()
      .prepare(
        `SELECT count(*) AS n FROM landing_page_snapshot WHERE id = ?`,
      )
      .bind(sneakerResaleBackfillRowId(EXCLUDED_BRANDS[0]!.domain, day))
      .first<{ n: number }>();
    expect(Number(excludedRows?.n ?? 0)).toBe(0);

    // Covered brands captured normally.
    expect(result.capturedCount).toBe(COHORT_BRANDS.length);
    expect(result.failedCount).toBe(0);
  });

  it("proof-hole catch-up skips capture when every cohort brand already has a public timeline (issue #1919 mirror)", async () => {
    const day = "2026-10-04";
    let captureCalls = 0;
    const result = await runSneakerResaleProofHoleCatchUp(appEnv, {
      now: new Date(`${day}T02:00:00.000Z`),
      cohort: coveredCohort(),
      tierLookup: tierLookupFor(coveredCohort()),
      hasPublicProof: async () => true,
      capture: (async () => {
        captureCalls += 1;
        return null;
      }) as never,
    });
    expect(result.skipped).toBe(true);
    expect(result.missingDomains).toEqual([]);
    expect(result.backfill).toBeNull();
    expect(captureCalls).toBe(0);
  });

  it("proof-hole catch-up runs the backfill when a cohort brand still 410s (issue #1919 mirror)", async () => {
    const day = "2026-10-05";
    const stub = makeStubCapture(day, 9);
    let captureCalls = 0;
    const result = await runSneakerResaleProofHoleCatchUp(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      cohort: coveredCohort(),
      tierLookup: tierLookupFor(coveredCohort()),
      hasPublicProof: async (_env, domain) => domain !== "nike.com",
      capture: (async (_env: unknown, url: string) => {
        captureCalls += 1;
        const domain = COHORT_BRANDS.find((b) => url.includes(b.domain));
        if (!domain) return null;
        return stub(domain.domain).snapshot;
      }) as never,
    });
    expect(result.skipped).toBe(false);
    expect(result.missingDomains).toEqual(["nike.com"]);
    expect(result.backfill?.failedCount).toBe(0);
    expect(captureCalls).toBe(1);
  });

  it("leaves every cohort brand with at least one proof-bearing snapshot row (issue #1919 mirror)", async () => {
    const day = "2026-10-03";
    const stub = makeStubCapture(day, 7);
    const captureStub = async (_env: unknown, url: string) => {
      const domain = COHORT_BRANDS.find((b) => url.includes(b.domain));
      if (!domain) return null;
      return stub(domain.domain).snapshot;
    };

    const result = await runSneakerResaleBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      cohort: coveredCohort(),
      tierLookup: tierLookupFor(coveredCohort()),
      capture: captureStub as never,
    });
    expect(result.failedCount).toBe(0);

    for (const brand of COHORT_BRANDS) {
      const rows = await db()
        .prepare(
          `SELECT artifact_key, metadata_json FROM landing_page_snapshot
           WHERE canonical_url LIKE ?`,
        )
        .bind(`%${brand.domain}%`)
        .all<{ artifact_key: string | null; metadata_json: string | null }>();
      const proofBearing = (rows.results ?? []).filter((row) =>
        snapshotRowHasCompleteProof(row),
      );
      expect(
        proofBearing.length,
        `${brand.domain} must have at least one proof-bearing snapshot row`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("summarizes a run into the scheduled-handler log line", () => {
    const summary = summarizeSneakerResaleBackfill({
      day: "2026-09-05",
      startedAt: "2026-09-05T01:00:00.000Z",
      capturedCount: 2,
      failedCount: 1,
      domains: [
        {
          domain: "stockx.com",
          status: "captured",
          snapshotId: "sneaker-stockx.com-2026-09-05",
          reasonCode: null,
          canonicalUrl: null,
          capturedAt: null,
          error: null,
          tier: null,
        },
        {
          domain: "nike.com",
          status: "skipped_already_captured",
          snapshotId: "sneaker-nike.com-2026-09-05",
          reasonCode: null,
          canonicalUrl: null,
          capturedAt: null,
          error: null,
          tier: null,
        },
        {
          domain: "goat.com",
          status: "capture_failed",
          snapshotId: null,
          reasonCode: "screenshot_required",
          canonicalUrl: null,
          capturedAt: null,
          error: null,
          tier: null,
        },
      ],
    });
    expect(summary).toContain("sneaker-resale-backfill day=2026-09-05");
    expect(summary).toContain("captured=2 failed=1");
    expect(summary).toContain("stockx.com:captured");
    expect(summary).toContain("nike.com:already");
    expect(summary).toContain("goat.com:failed:screenshot_required");
  });

  it("does not overwrite a concurrent run's row when the INSERT OR IGNORE is ignored (issue #2451)", async () => {
    // Same overlap as the demo-brand rail: a concurrent pass can win the
    // deterministic id between this run's existence check and its
    // INSERT OR IGNORE. The loser must not rewrite the winner's analysis
    // fields or report a capture it did not write.
    const day = "2026-11-02";
    const rowId = sneakerResaleBackfillRowId("stockx.com", day);
    const stub = makeStubCapture(day, 12);
    const cohort = coveredCohort().filter((entry) => entry.domain === "stockx.com");

    const captureStub = async (_env: unknown, url: string) => {
      const brand = COHORT_BRANDS.find((b) => url.includes(b.domain));
      if (!brand) return null;
      if (brand.domain === "stockx.com") {
        // Simulated concurrent winner: the deterministic row lands between
        // this run's existence check and its INSERT OR IGNORE, carrying its
        // own analysis fields.
        await db()
          .prepare(
            `INSERT INTO landing_page_snapshot (
               id, raw_url, canonical_url, raw_headline, normalized_headline,
               normalized_headline_hash, capture_method, captured_at, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            rowId,
            `https://www.stockx.com/`,
            `https://www.stockx.com/`,
            `Winner headline ${day}`,
            `winner headline ${day}`,
            `winner-hash-${day}`,
            "browser_render",
            `${day}T00:30:00.000Z`,
            `${day}T00:30:00.000Z`,
          )
          .run();
        await db()
          .prepare(
            `INSERT INTO analysis_field (
               id, scope_type, scope_id, field_key, field_value,
               provenance_source, extractor_version, confidence,
               metadata_json, created_at, updated_at
             ) VALUES (?, 'landing_page', ?, 'hook', ?, 'browser_render',
               'winner-test', 0.9, NULL, ?, ?)`,
          )
          .bind(
            `af-winner-sneaker-${day}`,
            rowId,
            `WINNER-ANALYSIS-${day}`,
            `${day}T00:30:00.000Z`,
            `${day}T00:30:00.000Z`,
          )
          .run();
      }
      return stub(brand.domain).snapshot;
    };

    const result = await runSneakerResaleBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      cohort,
      tierLookup: tierLookupFor(cohort),
      capture: captureStub as never,
    });

    const stockx = result.domains.find((r) => r.domain === "stockx.com");
    expect(stockx?.status).toBe("skipped_already_captured");
    expect(stockx?.snapshotId).toBe(rowId);
    expect(result.capturedCount).toBe(0);

    // The winner's row and its analysis fields are authoritative: the
    // loser's ignored insert must not trigger the analysis rewrite.
    const row = await db()
      .prepare(`SELECT raw_headline FROM landing_page_snapshot WHERE id = ?`)
      .bind(rowId)
      .first<{ raw_headline: string }>();
    expect(row?.raw_headline).toBe(`Winner headline ${day}`);
    const fields = await db()
      .prepare(
        `SELECT field_key, field_value FROM analysis_field
         WHERE scope_type = 'landing_page' AND scope_id = ?`,
      )
      .bind(rowId)
      .all<{ field_key: string; field_value: string }>();
    expect(fields.results).toEqual([
      { field_key: "hook", field_value: `WINNER-ANALYSIS-${day}` },
    ]);
  });
});
