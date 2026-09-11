import { describe, expect, it } from "vitest";

import { DEMO_BRAND_PAGE_DOMAINS } from "~/lib/demo-brand-pages";
import {
  demoBackfillRowId,
  runDemoBrandBackfill,
  runDemoBrandProofHoleCatchUp,
  summarizeDemoBrandBackfill,
} from "~/lib/demo-brand-backfill.server";
import {
  loadOfferTimeline,
  snapshotRowHasCompleteProof,
} from "~/lib/offer-timeline.server";

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

  it("proof-hole catch-up skips capture when every demo brand already has a public timeline (issue #1919)", async () => {
    const day = "2026-10-04";
    let captureCalls = 0;
    const result = await runDemoBrandProofHoleCatchUp(appEnv, {
      now: new Date(`${day}T02:00:00.000Z`),
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

  it("proof-hole catch-up runs the backfill when a demo brand still 410s (issue #1919)", async () => {
    const day = "2026-10-05";
    const stub = makeStubCapture(day, 9);
    let captureCalls = 0;
    const result = await runDemoBrandProofHoleCatchUp(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      hasPublicProof: async (_env, domain) => domain !== "nike.com",
      capture: (async (_env: unknown, url: string) => {
        captureCalls += 1;
        const domain = DEMO_BRAND_PAGE_DOMAINS.find((d) => url.includes(d));
        if (!domain) return null;
        return stub(domain).snapshot;
      }) as never,
    });
    expect(result.skipped).toBe(false);
    expect(result.missingDomains).toEqual(["nike.com"]);
    expect(result.backfill?.failedCount).toBe(0);
    expect(captureCalls).toBe(1);
  });

  it("leaves every demo brand with at least one proof-bearing snapshot row (issue #1919)", async () => {
    // Issue #1919 regression guard: the public surface went 410 for three demo
    // brands while the D1 row-count canary stayed green, because the only rows
    // were artifact-less seeds. This test counts rows that actually pass the
    // proof gate (screenshot + page-text artifact keys) so a brand whose
    // capture writes only unproven rows — or no rows at all — fails before
    // deploy instead of being caught by the public canary.
    const day = "2026-10-03";
    const stub = makeStubCapture(day, 7);
    const captureStub = async (_env: unknown, url: string) => {
      const domain = DEMO_BRAND_PAGE_DOMAINS.find((d) => url.includes(d));
      if (!domain) return null;
      return stub(domain).snapshot;
    };

    const result = await runDemoBrandBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      capture: captureStub as never,
    });
    expect(result.failedCount).toBe(0);

    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      const rows = await db()
        .prepare(
          `SELECT artifact_key, metadata_json FROM landing_page_snapshot
           WHERE canonical_url LIKE ?`,
        )
        .bind(`%${domain}%`)
        .all<{ artifact_key: string | null; metadata_json: string | null }>();
      const proofBearing = (rows.results ?? []).filter((row) =>
        snapshotRowHasCompleteProof(row),
      );
      expect(
        proofBearing.length,
        `${domain} must have at least one proof-bearing snapshot row`,
      ).toBeGreaterThanOrEqual(1);
    }
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

  it("caps capture attempts at 3 per domain per UTC day (issue #2364)", async () => {
    // The escape hatch: seed the state table directly so the per-day attempt
    // counter for nike.com already sits at the cap. The backfill must not
    // spend a Browser Run minute on it and reports `skipped_attempt_cap`.
    const day = "2026-10-10";
    await db()
      .prepare(
        `INSERT INTO demo_brand_proof_hole_state (
           domain, day, attempts_today, day_succeeded,
           consecutive_failed_days, stopped, updated_at
         ) VALUES ('nike.com', ?, 3, 0, 0, 0, ?)
         ON CONFLICT(domain) DO UPDATE SET
           day = excluded.day,
           attempts_today = 3,
           day_succeeded = 0,
           consecutive_failed_days = 0,
           stopped = 0,
           updated_at = excluded.updated_at`,
      )
      .bind(day, `${day}T00:00:00.000Z`)
      .run();

    const capturedDomains: string[] = [];
    const result = await runDemoBrandBackfill(appEnv, {
      now: new Date(`${day}T03:00:00.000Z`),
      capture: (async (_env: unknown, url: string) => {
        const domain = DEMO_BRAND_PAGE_DOMAINS.find((d) => url.includes(d));
        if (domain) capturedDomains.push(domain);
        return null;
      }) as never,
    });

    const nike = result.domains.find((r) => r.domain === "nike.com");
    expect(nike?.status).toBe("skipped_attempt_cap");
    // The cap gate fires before the capture call: nike.com is never handed
    // to the capture pipeline on this run.
    expect(capturedDomains).not.toContain("nike.com");
    // The other four brands still walk the normal capture path (the stub
    // fails them, so they report capture_failed rather than a skip).
    const others = result.domains.filter((r) => r.domain !== "nike.com");
    expect(others).toHaveLength(DEMO_BRAND_PAGE_DOMAINS.length - 1);
    expect(others.every((r) => r.status === "capture_failed")).toBe(true);
  });

  it("stops a demo brand after 3 consecutive failed days and alerts once (issue #2364)", async () => {
    // Three consecutive fully-failed days (all attempts failed) must stop the
    // domain: the run that observes the third failed day's rollover flags the
    // stop and routes exactly one throttled operator alert; later passes skip
    // without capturing and do not re-alert. Use mamaearth.com (unseeded in
    // the cap test above) so the streak starts clean.
    const failCaptureEvery = (async () => null) as never;

    // Reset mamaearth's state to a healthy yesterday (one success on 10-17) so
    // the failing-day streak starts clean at day 1 of this test; otherwise
    // earlier tests' state would shift the stop a day early.
    await db()
      .prepare(
        `INSERT INTO demo_brand_proof_hole_state (
           domain, day, attempts_today, day_succeeded,
           consecutive_failed_days, stopped, updated_at
         ) VALUES ('mamaearth.com', '2026-10-17', 1, 1, 0, 0, '2026-10-17T00:00:00.000Z')
         ON CONFLICT(domain) DO UPDATE SET
           day = '2026-10-17',
           attempts_today = 1,
           day_succeeded = 1,
           consecutive_failed_days = 0,
           stopped = 0,
           updated_at = '2026-10-17T00:00:00.000Z'`,
      )
      .run();

    // Day 1..3: every attempt fails.
    for (let d = 0; d < 3; d += 1) {
      const thisDay = `2026-10-${String(18 + d).padStart(2, "0")}`;
      await runDemoBrandBackfill(appEnv, {
        now: new Date(`${thisDay}T01:00:00.000Z`),
        capture: failCaptureEvery,
        domains: ["mamaearth.com"],
      });
    }

    // Day 4: the run that observes the third consecutive failed day crosses
    // the stop threshold and fires the alert. The domain reports `stopped`
    // and spends no browser minutes that day.
    const day4 = "2026-10-21";
    const stopResult = await runDemoBrandBackfill(appEnv, {
      now: new Date(`${day4}T01:00:00.000Z`),
      capture: failCaptureEvery,
      domains: ["mamaearth.com"],
    });
    const mamaearth = stopResult.domains.find((r) => r.domain === "mamaearth.com");
    expect(mamaearth?.status).toBe("stopped");

    // The state table now marks the domain stopped with a 3-day streak, and
    // exactly one throttled operator-alert row exists for the stop task key.
    const state = await db()
      .prepare(
        `SELECT stopped, consecutive_failed_days FROM demo_brand_proof_hole_state WHERE domain = 'mamaearth.com'`,
      )
      .first<{ stopped: number; consecutive_failed_days: number }>();
    expect(state?.stopped).toBe(1);
    expect(state?.consecutive_failed_days).toBe(3);

    const alertRows = await db()
      .prepare(
        `SELECT COUNT(*) AS n FROM cron_failure_alert_throttle WHERE task_key = 'demo_brand_proof_hole_stopped_mamaearth_com'`,
      )
      .first<{ n: number }>();
    expect(Number(alertRows?.n ?? 0)).toBe(1);

    // A later pass the same day skips the stopped domain entirely — no
    // capture, no re-alert.
    const laterResult = await runDemoBrandBackfill(appEnv, {
      now: new Date(`${day4}T02:00:00.000Z`),
      capture: failCaptureEvery,
      domains: ["mamaearth.com"],
    });
    const mamaearthLater = laterResult.domains.find((r) => r.domain === "mamaearth.com");
    expect(mamaearthLater?.status).toBe("skipped_stopped");
  });

  it("does not overwrite a concurrent run's row when the INSERT OR IGNORE is ignored (issue #2451)", async () => {
    // The nightly 04:00 backfill and the hourly proof-hole catch-up can
    // overlap on the same (domain, day): both pass the SELECT existence
    // check, both spend a capture, and one INSERT OR IGNORE wins. The loser
    // must not run replaceAnalysisFields against the winner's row and must
    // report the skip, not a capture it did not write.
    const day = "2026-11-01";
    const rowId = demoBackfillRowId("nike.com", day);
    const stub = makeStubCapture(day, 11);

    const captureStub = async (_env: unknown, url: string) => {
      const domain = DEMO_BRAND_PAGE_DOMAINS.find((d) => url.includes(d));
      if (!domain) return null;
      if (domain === "nike.com") {
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
            `https://www.nike.com/`,
            `https://www.nike.com/`,
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
            `af-winner-${day}`,
            rowId,
            `WINNER-ANALYSIS-${day}`,
            `${day}T00:30:00.000Z`,
            `${day}T00:30:00.000Z`,
          )
          .run();
      }
      return stub(domain).snapshot;
    };

    const result = await runDemoBrandBackfill(appEnv, {
      now: new Date(`${day}T01:00:00.000Z`),
      capture: captureStub as never,
      domains: ["nike.com"],
    });

    const nike = result.domains.find((r) => r.domain === "nike.com");
    expect(nike?.status).toBe("skipped_already_captured");
    expect(nike?.snapshotId).toBe(rowId);
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