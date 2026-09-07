import { describe, expect, it } from "vitest";

import { DEMO_BRAND_PAGE_DOMAINS } from "~/lib/demo-brand-pages";
import {
  demoBackfillRowId,
  runDemoBrandBackfill,
  summarizeDemoBrandBackfill,
} from "~/lib/demo-brand-backfill.server";
import { loadOfferTimeline } from "~/lib/offer-timeline.server";

import { appEnv, db } from "./fixtures";

/**
 * Nightly demo-brand backfill (issue #1449) against the real migration set.
 * The capture step is stubbed (the real pipeline needs the Browser Rendering
 * binding), but every D1 write/read is real: the migration set is applied by
 * the `workers` project setup, so this test proves the write path lands in
 * the final schema, the deterministic ids keep a cron re-run from
 * double-appending a day, and the proof gate (issue #1284) renders the rows
 * as public timeline entries instead of filtering them out.
 */

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
        rawHeadline: `Demo offer headline for ${domain} on ${day}`,
        normalizedHeadline: `demo offer headline for ${domain} on ${day}`,
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
       WHERE capture_method = 'browser_render' AND canonical_url = ?`,
    )
    .bind(`https://www.${domain}/`)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

describe("demo brand nightly backfill (issue #1449)", () => {
  it("writes one proof-complete row per demo brand and the timeline renders it", async () => {
    const day = "2026-09-05";
    let brandIndex = 0;
    const stub = makeStubCapture(day, brandIndex);

    const captureStub = async (_env: unknown, url: string) => {
      const domain = DEMO_BRAND_PAGE_DOMAINS.find((d) => url.includes(d));
      if (!domain) return null;
      // Referencing brandIndex through the writer keeps the deterministic key
      // distinct per captured brand.
      const snapshot = stub(domain).snapshot;
      brandIndex += 1;
      return snapshot;
    };

    const result = await runDemoBrandBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      capture: captureStub as never,
    });

    expect(result.capturedCount).toBe(DEMO_BRAND_PAGE_DOMAINS.length);
    expect(result.failedCount).toBe(0);
    expect(result.day).toBe(day);
    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      const domainResult = result.domains.find((r) => r.domain === domain);
      expect(domainResult?.status).toBe("captured");
      expect(domainResult?.snapshotId).toBe(`demo-${domain}-${day}`);
      expect(await backfilledRowCount(domain)).toBe(1);
    }

    // The proof gate now accepts the rows: the public timeline has one dated
    // state per brand instead of the empty ledger that 410s (issue #1309).
    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
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
      const domain = DEMO_BRAND_PAGE_DOMAINS.find((d) => url.includes(d));
      if (!domain) return null;
      return stub(domain).snapshot;
    };

    const first = await runDemoBrandBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      capture: captureStub as never,
    });
    expect(first.capturedCount).toBe(DEMO_BRAND_PAGE_DOMAINS.length);

    // A platform retry of the same cron fires again after the first pass
    // finished; the deterministic row id must swallow the second pass.
    const second = await runDemoBrandBackfill(appEnv, {
      now: new Date(`${day}T01:05:00.000Z`),
      capture: captureStub as never,
    });
    expect(second.capturedCount).toBe(0);
    expect(second.failedCount).toBe(0);
    expect(second.domains.every((r) => r.status === "skipped_already_captured")).toBe(true);

    // Exactly one row per (domain, day) — the deterministic id swallows the
    // retry instead of appending a duplicate dated state.
    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      const row = await db()
        .prepare(
          `SELECT count(*) AS n FROM landing_page_snapshot WHERE id = ?`,
        )
        .bind(demoBackfillRowId(domain, day))
        .first<{ n: number }>();
      expect(Number(row?.n ?? 0)).toBe(1);
    }
  });

  it("accumulates a dated ledger across nights (>=3 states after three nights)", async () => {
    // Self-contained: three consecutive nights build a 3-state ledger that
    // renders in ascending date order (accept criterion #2).
    for (const [day, index] of [["2026-09-20", 2], ["2026-09-21", 3], ["2026-09-22", 4]] as const) {
      const stub = makeStubCapture(day, index);
      const captureStub = async (_env: unknown, url: string) => {
        const domain = DEMO_BRAND_PAGE_DOMAINS.find((d) => url.includes(d));
        if (!domain) return null;
        return stub(domain).snapshot;
      };
      const result = await runDemoBrandBackfill(appEnv, {
        now: new Date(`${day}T01:00:00.000Z`),
        capture: captureStub as never,
      });
      expect(result.capturedCount).toBe(DEMO_BRAND_PAGE_DOMAINS.length);
    }

    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      const loaded = await loadOfferTimeline(appEnv, { domain, asOf: null });
      expect(loaded.entries.length).toBeGreaterThanOrEqual(3);
      const dates = loaded.entries.map((e) => e.capturedAt).sort();
      expect(Date.parse(dates[0]!)).toBeLessThan(Date.parse(dates[1]!));
      expect(Date.parse(dates[1]!)).toBeLessThan(Date.parse(dates[2]!));
    }
  });

  it("records per-brand capture failures without losing the other brands", async () => {
    const day = "2026-09-28";
    const stub = makeStubCapture(day, 5);
    const captureStub = async (env: unknown, url: string) => {
      const domain = DEMO_BRAND_PAGE_DOMAINS.find((d) => url.includes(d));
      if (!domain) return null;
      if (domain === "nike.com") {
        // The stub capture's onFailure contract: the real pipeline calls the
        // failure callback with a reason code before returning null.
        return null;
      }
      return stub(domain).snapshot;
    };

    const result = await runDemoBrandBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      capture: captureStub as never,
    });

    const nike = result.domains.find((r) => r.domain === "nike.com");
    expect(nike?.status).toBe("capture_failed");
    // No row for the failed day was written (earlier nights' rows remain).
    const nikeFailedDay = await db()
      .prepare(
        `SELECT count(*) AS n FROM landing_page_snapshot
         WHERE canonical_url = ? AND captured_at LIKE ?`,
      )
      .bind(`https://www.nike.com/`, `${day}%`)
      .first<{ n: number }>();
    expect(Number(nikeFailedDay?.n ?? 0)).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.capturedCount).toBe(DEMO_BRAND_PAGE_DOMAINS.length - 1);
  });

  it("summarizes a run into the scheduled-handler log line", () => {
    const summary = summarizeDemoBrandBackfill({
      day: "2026-09-05",
      startedAt: "2026-09-05T01:00:00.000Z",
      capturedCount: 3,
      failedCount: 2,
      domains: [
        { domain: "nike.com", status: "captured", snapshotId: "x", reasonCode: null, canonicalUrl: null, capturedAt: null, error: null },
        { domain: "nykaa.com", status: "capture_failed", snapshotId: null, reasonCode: "screenshot_required", canonicalUrl: null, capturedAt: null, error: null },
      ],
    });
    expect(summary).toContain("day=2026-09-05");
    expect(summary).toContain("nike.com:captured");
    expect(summary).toContain("nykaa.com:failed:screenshot_required");
  });
});