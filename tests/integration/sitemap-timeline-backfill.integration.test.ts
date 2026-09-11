import { describe, expect, it, beforeAll } from "vitest";

import {
  loadOfferTimeline,
  snapshotRowHasCompleteProof,
} from "~/lib/offer-timeline.server";
import { proofPageTextSrc } from "~/lib/proof-page-text";
import { proofScreenshotSrc } from "~/lib/proof-screenshot";
import {
  runSitemapTimelineBackfill,
  sitemapTimelineBackfillRowId,
  type SitemapTimelineTierLookup,
} from "~/lib/sitemap-timeline-backfill.server";
import type { SitemapTimelineTier } from "~/lib/sitemap-timeline-cohort";
import { loadSitemapTimelineCandidateDomains, sitemapTimelineExcludedDomains } from "~/lib/sitemap-timeline-cohort.server";

import { appEnv, db } from "./fixtures";

/**
 * Nightly sitemap-timeline cohort backfill (issue #1958, phase 4) against the
 * real migration set; mirrors `sneaker-resale-backfill.integration.test.ts`.
 * Capture is stubbed (needs Browser Rendering); every D1 read/write is real.
 * The production default path runs for real (no `cohort` option): the sitemap
 * read over applied D1, the hasCoverage filter, and the real exclusion set.
 * Storage is per-test-file: assertions scope to their own UTC day + domain.
 */

/** The issue's two frozen target domains. */
const COVERED_DOMAINS = ["calendly.com", "adspyder.io"] as const;

/** Excluded-lane domains (sneaker seed / demo brand), also seeded as
 * complete-proof candidates so the real exclusion set is what drops them. */
const EXCLUDED_TARGETS = ["stockx.com", "nike.com"] as const;

const ALL_SEEDED_DOMAINS = [...COVERED_DOMAINS, ...EXCLUDED_TARGETS] as const;

function tier(overrides: Partial<SitemapTimelineTier>): SitemapTimelineTier {
  return {
    verifiedCount: 0,
    likelyCount: 0,
    unmatchedCount: 0,
    hasCoverage: false,
    cacheStatus: "stale",
    ...overrides,
  };
}

function coveredTierLookup(): SitemapTimelineTierLookup {
  return async () => {
    const map = new Map<string, SitemapTimelineTier>();
    for (const domain of COVERED_DOMAINS) {
      map.set(domain, tier({ verifiedCount: 2, likelyCount: 1, hasCoverage: true, cacheStatus: "fresh" }));
    }
    for (const domain of EXCLUDED_TARGETS) {
      // Fresh verdicts on purpose: only the exclusion set drops these.
      map.set(domain, tier({ verifiedCount: 2, likelyCount: 1, hasCoverage: true, cacheStatus: "fresh" }));
    }
    return map;
  };
}

function uncoveredTierLookup(): SitemapTimelineTierLookup {
  return async () => {
    const map = new Map<string, SitemapTimelineTier>();
    for (const domain of ALL_SEEDED_DOMAINS) {
      map.set(domain, tier({ unmatchedCount: 3 }));
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
        rawHeadline: `Sitemap-timeline offer headline for ${domain} on ${day}`,
        normalizedHeadline: `sitemap-timeline offer headline for ${domain} on ${day}`,
        normalizedHeadlineHash: `hash-${day}-${index}-${domain}`,
        ctaText: "Book a demo",
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

/** Seeding a complete-proof row per fixture domain (old captured_at, no
 * ad_observation references) makes each a genuine sitemap candidate. */
async function seedSitemapCandidate(domain: string, capturedAt: string): Promise<void> {
  const day = capturedAt.slice(0, 10);
  // Keys must pass the proof-gate key-shape validation ([a-f0-9-]+ segment).
  const hex = hex32(`seed-${domain}-${day}`);
  const htmlKey = `landing-pages/${day}/${hex}.html`;
  const screenshotKey = `landing-pages/${day}/${hex}.jpeg`;
  await db()
    .prepare(
      `INSERT INTO landing_page_snapshot (
        id, raw_url, canonical_url, raw_headline, normalized_headline,
        normalized_headline_hash, capture_method, artifact_key, metadata_json,
        cta_text, price_text, form_present, ocr_text, translated_text,
        captured_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'sitemap_timeline_seed', ?, ?, NULL, NULL,
        0, NULL, NULL, ?, ?)`,
    )
    .bind(
      `seed-${domain}-${capturedAt.slice(0, 10)}`,
      `https://www.${domain}/`,
      `https://www.${domain}/`,
      `Seeded frozen offer headline for ${domain}`,
      `seeded frozen offer headline for ${domain}`,
      `hash-seed-${domain}`,
      htmlKey,
      JSON.stringify({
        screenshotArtifactKey: screenshotKey,
        htmlArtifactKey: htmlKey,
        source: "sitemap_timeline_seed",
      }),
      capturedAt,
      capturedAt,
    )
    .run();
}

/** One run's UTC-day-scoped backfill + capture stub for a single covered domain. */
async function runCoveredNight(day: string, index: number, tierLookup: SitemapTimelineTierLookup) {
  const stub = makeStubCapture(day, index);
  const captureStub = async (_env: unknown, url: string) => {
    const domain = COVERED_DOMAINS.find((d) => url.includes(d));
    if (!domain) return null;
    return stub(domain).snapshot;
  };
  return runSitemapTimelineBackfill(appEnv, {
    now: new Date(`${day}T01:00:00.000Z`),
    tierLookup,
    capture: captureStub as never,
  });
}

describe("sitemap-timeline cohort nightly backfill (issue #1958, phase 4)", () => {
  beforeAll(async () => {
    await seedSitemapCandidate("calendly.com", "2026-08-20T03:00:00.000Z");
    await seedSitemapCandidate("adspyder.io", "2026-08-21T03:00:00.000Z");
    await seedSitemapCandidate("stockx.com", "2026-08-22T03:00:00.000Z");
    await seedSitemapCandidate("nike.com", "2026-08-23T03:00:00.000Z");
  });

  it("reads the seeded calendly/adspyder rows as real sitemap candidates", async () => {
    const candidates = await loadSitemapTimelineCandidateDomains(appEnv);
    expect(candidates).toEqual(
      expect.arrayContaining(["calendly.com", "adspyder.io", "stockx.com", "nike.com"]),
    );
  });

  it("writes a fresh proof-complete row for every covered sitemap domain and the timeline renders the new dated state", async () => {
    const day = "2026-09-05";
    const index = 0;
    const stub = makeStubCapture(day, index);

    const result = await runCoveredNight(day, index, coveredTierLookup());

    expect(result.day).toBe(day);
    // Both thawing target domains (calendly.com, adspyder.io) carry fresh
    // coverage verdicts and both are captured this night.
    expect(result.capturedCount).toBe(2);
    expect(result.failedCount).toBe(0);

    for (const domain of COVERED_DOMAINS) {
      const entry = result.domains.find((r) => r.domain === domain);
      expect(entry?.status).toBe("captured");
      expect(entry?.snapshotId).toBe(sitemapTimelineBackfillRowId(domain, day));

      // The row landed in the real schema with BOTH artifact receipts in the
      // metadata — a complete-proof sitemap candidate on the next read.
      const row = await db()
        .prepare(
          `SELECT id, artifact_key, metadata_json, canonical_url, captured_at
           FROM landing_page_snapshot WHERE id = ?`,
        )
        .bind(sitemapTimelineBackfillRowId(domain, day))
        .first<{
          id: string;
          artifact_key: string | null;
          metadata_json: string | null;
          canonical_url: string;
          captured_at: string;
        }>();
      expect(row?.id).toBe(sitemapTimelineBackfillRowId(domain, day));
      expect(row?.canonical_url).toBe(`https://www.${domain}/`);
      const snapshot = stub(domain).snapshot;
      expect(row?.captured_at).toBe(snapshot.capturedAt);
      expect(row?.artifact_key).toBe(snapshot.metadata.htmlArtifactKey);
      const metadata = row?.metadata_json ? JSON.parse(row.metadata_json) : {};
      expect(metadata.screenshotArtifactKey).toBe(snapshot.metadata.screenshotArtifactKey);
      expect(metadata.htmlArtifactKey).toBe(snapshot.metadata.htmlArtifactKey);
      expect(row ? snapshotRowHasCompleteProof(row) : false).toBe(true);

      // The public timeline renders the NEW dated state (frozen seed + fresh
      // backfill), newest last, with real artifact hrefs.
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      expect(loaded.entries.length).toBeGreaterThanOrEqual(2);
      const newest = loaded.entries[loaded.entries.length - 1];
      expect(newest?.capturedAt).toBe(snapshot.capturedAt);
      expect(newest?.screenshotHref).toBe(proofScreenshotSrc(snapshot.metadata.screenshotArtifactKey));
      expect(newest?.pageTextHref).toBe(proofPageTextSrc(snapshot.metadata.htmlArtifactKey));
      expect(newest?.screenshotHref).toMatch(/^\/artifacts\/proof\//);
      expect(newest?.pageTextHref).toMatch(/^\/artifacts\/page-text\//);
    }
  });

  it("writes NOTHING when the sitemap candidate's tier has no verified coverage", async () => {
    const day = "2026-09-07";

    const before = await loadOfferTimeline(appEnv, { domain: "calendly.com", asOf: null });
    const beforeCount = await db()
      .prepare(`SELECT count(*) AS n FROM landing_page_snapshot WHERE id LIKE ?`)
      .bind("timeline-calendly.com-%")
      .first<{ n: number }>();

    // The capture stub would happily return a snapshot for any URL — the only
    // thing keeping every candidate off the cohort is
    // `deriveSitemapTimelineCohort`'s `hasCoverage` filter (real, default
    // builder path).
    const stub = makeStubCapture(day, 7);
    const captureStub = async (_env: unknown, url: string) => {
      const domain = ALL_SEEDED_DOMAINS.find((d) => url.includes(d));
      if (!domain) return null;
      return stub(domain).snapshot;
    };

    const result = await runSitemapTimelineBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      tierLookup: uncoveredTierLookup(),
      capture: captureStub as never,
    });

    expect(result.domains).toEqual([]);
    expect(result.capturedCount).toBe(0);
    expect(result.failedCount).toBe(0);

    const afterCount = await db()
      .prepare(`SELECT count(*) AS n FROM landing_page_snapshot WHERE id LIKE ?`)
      .bind("timeline-calendly.com-%")
      .first<{ n: number }>();
    expect(Number(afterCount?.n ?? 0)).toBe(Number(beforeCount?.n ?? 0));

    // No fabricated row for this UTC day, and the seeded ledger is untouched.
    const dayRow = await db()
      .prepare(`SELECT count(*) AS n FROM landing_page_snapshot WHERE id = ?`)
      .bind(sitemapTimelineBackfillRowId("calendly.com", day))
      .first<{ n: number }>();
    expect(Number(dayRow?.n ?? 0)).toBe(0);

    const after = await loadOfferTimeline(appEnv, { domain: "calendly.com", asOf: null });
    expect(after.entries.map((e) => e.id)).toEqual(before.entries.map((e) => e.id));
    expect(after.entries.length).toBe(before.entries.length);
  });

  it("is idempotent per UTC day: a cron re-run never double-appends a row", async () => {
    const day = "2026-09-12";

    const first = await runCoveredNight(day, 1, coveredTierLookup());
    expect(first.capturedCount).toBe(2);

    const second = await runCoveredNight(day, 1, coveredTierLookup());
    expect(second.capturedCount).toBe(0);
    expect(second.failedCount).toBe(0);
    expect(
      second.domains.every((r) => r.status === "skipped_already_captured"),
    ).toBe(true);

    for (const domain of COVERED_DOMAINS) {
      const row = await db()
        .prepare(`SELECT count(*) AS n FROM landing_page_snapshot WHERE id = ?`)
        .bind(sitemapTimelineBackfillRowId(domain, day))
        .first<{ n: number }>();
      expect(Number(row?.n ?? 0), domain).toBe(1);
    }
  });

  it("accumulates a dated ledger across three consecutive nights, newest within the 7-day metric window", async () => {
    const nights = [
      ["2026-09-20", 2],
      ["2026-09-21", 3],
      ["2026-09-22", 4],
    ] as const;
    const stubAts: string[] = [];
    for (const [day, index] of nights) {
      const stub = makeStubCapture(day, index);
      const result = await runCoveredNight(day, index, coveredTierLookup());
      expect(result.capturedCount).toBe(2);
      stubAts.push(stub("calendly.com").snapshot.capturedAt);
    }

    // One deterministic row per night per covered domain — never more.
    for (const [day] of nights) {
      for (const domain of COVERED_DOMAINS) {
        const row = await db()
          .prepare(`SELECT count(*) AS n FROM landing_page_snapshot WHERE id = ?`)
          .bind(sitemapTimelineBackfillRowId(domain, day))
          .first<{ n: number }>();
        expect(Number(row?.n ?? 0), `${domain} ${day}`).toBe(1);
      }
    }

    // Both target domains render the three nights' states in ascending order.
    for (const domain of COVERED_DOMAINS) {
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      const newestThree = loaded.entries.slice(-3).map((e) => e.capturedAt);
      expect(newestThree, domain).toEqual(stubAts);
    }

    // The acceptance metric: the newest dated offer state must be within 7
    // days of the last night's run.
    const loaded = await loadOfferTimeline(appEnv, { domain: "calendly.com", asOf: null });
    const newest = loaded.entries[loaded.entries.length - 1];
    const newestAt = Date.parse(newest?.capturedAt ?? "");
    const lastNight = Date.parse(`${nights[2]?.[0]}T01:00:00.000Z`);
    expect(newestAt).toBeGreaterThan(lastNight - 7 * 24 * 60 * 60 * 1000);
    expect(newestAt).toBeLessThanOrEqual(lastNight + 24 * 60 * 60 * 1000);
  });

  it("records a per-domain capture failure without losing the other sitemap domains", async () => {
    const day = "2026-09-28";
    const index = 5;
    const stub = makeStubCapture(day, index);
    const captureStub = async (_env: unknown, url: string) => {
      const domain = COVERED_DOMAINS.find((d) => url.includes(d));
      if (!domain) return null;
      if (domain === "adspyder.io") {
        return null;
      }
      return stub(domain).snapshot;
    };

    const result = await runSitemapTimelineBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      tierLookup: coveredTierLookup(),
      capture: captureStub as never,
    });

    expect(result.failedCount).toBe(1);
    expect(result.capturedCount).toBe(1);
    const calendly = result.domains.find((r) => r.domain === "calendly.com");
    expect(calendly?.status).toBe("captured");
    const adspyder = result.domains.find((r) => r.domain === "adspyder.io");
    expect(adspyder?.status).toBe("capture_failed");
    expect(adspyder?.snapshotId).toBeNull();

    // A failed capture is recorded, never fabricated into an offer row.
    const failedRow = await db()
      .prepare(`SELECT count(*) AS n FROM landing_page_snapshot WHERE id = ?`)
      .bind(sitemapTimelineBackfillRowId("adspyder.io", day))
      .first<{ n: number }>();
    expect(Number(failedRow?.n ?? 0)).toBe(0);
    const failedUrl = await db()
      .prepare(
        `SELECT count(*) AS n FROM landing_page_snapshot
         WHERE canonical_url = ? AND captured_at LIKE ?`,
      )
      .bind("https://www.adspyder.io/", `${day}%`)
      .first<{ n: number }>();
    expect(Number(failedUrl?.n ?? 0)).toBe(0);
  });

  it("derives the cohort through the sitemap read and the REAL demo/sneaker exclusion", async () => {
    const day = "2026-10-01";
    const index = 6;
    const stub = makeStubCapture(day, index);
    const captureStub = async (_env: unknown, url: string) => {
      const domain = COVERED_DOMAINS.find((d) => url.includes(d));
      if (!domain) return null;
      return stub(domain).snapshot;
    };

    const excluded = sitemapTimelineExcludedDomains();
    expect(excluded).toEqual(expect.arrayContaining(["nike.com", "stockx.com"]));
    expect(excluded).not.toContain("calendly.com");
    expect(excluded).not.toContain("adspyder.io");

    // Excluded-lane domains carry hasCoverage:true on purpose — only the real
    // exclusion set can keep them off the cohort.
    const result = await runSitemapTimelineBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      tierLookup: coveredTierLookup(),
      capture: captureStub as never,
    });

    const capturedDomains = result.domains.map((r) => r.domain).sort();
    expect(capturedDomains).toEqual(["adspyder.io", "calendly.com"]);
    expect(
      result.domains.filter((r) => r.status === "captured").length,
    ).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.domains.some((r) => r.domain === "stockx.com")).toBe(false);
    expect(result.domains.some((r) => r.domain === "nike.com")).toBe(false);

    // And no timeline row was fabricated for either excluded domain this night.
    for (const domain of EXCLUDED_TARGETS) {
      const row = await db()
        .prepare(`SELECT count(*) AS n FROM landing_page_snapshot WHERE id = ?`)
        .bind(sitemapTimelineBackfillRowId(domain, day))
        .first<{ n: number }>();
      expect(Number(row?.n ?? 0), `${domain} must not receive a backfill row`).toBe(0);
    }
  });

  it("does not overwrite a concurrent run's row when the INSERT OR IGNORE is ignored (issue #2451)", async () => {
    // Same overlap as the demo-brand rail: a concurrent pass can win the
    // deterministic id between this run's existence check and its
    // INSERT OR IGNORE. The loser must not rewrite the winner's analysis
    // fields or report a capture it did not write.
    const day = "2026-11-03";
    const rowId = sitemapTimelineBackfillRowId("calendly.com", day);
    const stub = makeStubCapture(day, 13);
    const cohort = [
      {
        domain: "calendly.com",
        tier: tier({
          verifiedCount: 2,
          likelyCount: 1,
          hasCoverage: true,
          cacheStatus: "fresh",
        }),
      },
    ];

    const captureStub = async (_env: unknown, url: string) => {
      const domain = COVERED_DOMAINS.find((d) => url.includes(d));
      if (!domain) return null;
      if (domain === "calendly.com") {
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
            `https://www.calendly.com/`,
            `https://www.calendly.com/`,
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
            `af-winner-sitemap-${day}`,
            rowId,
            `WINNER-ANALYSIS-${day}`,
            `${day}T00:30:00.000Z`,
            `${day}T00:30:00.000Z`,
          )
          .run();
      }
      return stub(domain).snapshot;
    };

    const result = await runSitemapTimelineBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      cohort,
      capture: captureStub as never,
    });

    const calendly = result.domains.find((r) => r.domain === "calendly.com");
    expect(calendly?.status).toBe("skipped_already_captured");
    expect(calendly?.snapshotId).toBe(rowId);
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

  // The summarize log-line shape is pinned by the node unit suite
  // (tests/sitemap-timeline-backfill.server.test.ts) — not duplicated here.
});