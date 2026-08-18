import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  hydrateAdsWithPersistedCreatives,
  listAdsByIds,
  upsertAd,
} from "~/lib/ad-persistence.server";
import type { AdRecord } from "~/lib/types";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

function buildAd(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "1280520150312258",
    advertiser: "Nykaa Man",
    body: "For the Man Who Never Settles For Less",
    previewHeadline: "For the Man Who Never Settles For Less",
    previewSubhead: "Flat ₹400 Off on Your First Order",
    hook: "For the Man Who Never Settles For Less",
    offer: "Flat ₹400 Off on Your First Order",
    cta: "Shop Now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://nykaaman.com/",
    adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1280520150312258",
    countries: ["India"],
    platforms: ["Instagram"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "Test summary",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

interface AdDateRow {
  first_seen_at: string | null;
  last_seen_at: string | null;
  raw_json: string;
  body: string;
}

describe("upsertAd seen-window ratchet", () => {
  let harness: ReturnType<typeof createSqliteD1>;
  let env: never;

  beforeEach(() => {
    harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0000_auth.sql");
    applyMigration(harness.sqlite, "migrations/0001_app.sql");
    applyMigration(harness.sqlite, "migrations/0003_creative_ocr.sql");
    env = { DB: harness.db } as never;
  });

  afterEach(() => {
    harness.close();
  });

  function readAdRow(adId: string): AdDateRow {
    return harness.sqlite
      .prepare("SELECT first_seen_at, last_seen_at, raw_json, body FROM ad WHERE id = ?")
      .get(adId) as unknown as AdDateRow;
  }

  it("a later scan writing null never clobbers a real date", async () => {
    await upsertAd(env, buildAd({ firstSeenAt: "2026-07-01", lastSeenAt: "2026-07-10T04:00:00.000Z" }));
    await upsertAd(env, buildAd({ firstSeenAt: null, lastSeenAt: null }));

    const row = readAdRow("1280520150312258");
    expect(row.first_seen_at).toBe("2026-07-01");
    expect(row.last_seen_at).toBe("2026-07-10T04:00:00.000Z");
  });

  it("first_seen_at only moves earlier and last_seen_at only moves later", async () => {
    await upsertAd(env, buildAd({ firstSeenAt: "2026-07-05", lastSeenAt: "2026-07-06" }));

    // Narrower window must not shrink the record.
    await upsertAd(env, buildAd({ firstSeenAt: "2026-07-08", lastSeenAt: "2026-07-05" }));
    let row = readAdRow("1280520150312258");
    expect(row.first_seen_at).toBe("2026-07-05");
    expect(row.last_seen_at).toBe("2026-07-06");

    // Wider window ratchets both ends outward.
    await upsertAd(env, buildAd({ firstSeenAt: "2026-06-01", lastSeenAt: "2026-07-12" }));
    row = readAdRow("1280520150312258");
    expect(row.first_seen_at).toBe("2026-06-01");
    expect(row.last_seen_at).toBe("2026-07-12");
  });

  it("atomically preserves the widest seen window across concurrent scans", async () => {
    // The sqlite test adapter implements D1.batch with BEGIN IMMEDIATE on one
    // connection. Serialize the unrelated analysis-field cleanup batches so
    // this test isolates concurrent ad-row claims, as separate D1 requests do.
    const originalBatch = harness.db.batch.bind(harness.db);
    let priorBatch = Promise.resolve();
    harness.db.batch = async (statements) => {
      const currentBatch = priorBatch.then(() => originalBatch(statements));
      priorBatch = currentBatch.then(() => undefined, () => undefined);
      return currentBatch;
    };

    await upsertAd(env, buildAd({ firstSeenAt: "2026-07-10", lastSeenAt: "2026-07-10" }));

    await Promise.all([
      upsertAd(env, buildAd({
        body: "Earliest-start observation",
        firstSeenAt: "2026-05-01",
        lastSeenAt: "2026-07-15",
      })),
      upsertAd(env, buildAd({
        body: "Latest-end observation",
        firstSeenAt: "2026-06-01",
        lastSeenAt: "2026-08-01",
      })),
    ]);

    const row = readAdRow("1280520150312258");
    const persisted = JSON.parse(row.raw_json) as AdRecord;
    expect(row.first_seen_at).toBe("2026-05-01");
    expect(row.last_seen_at).toBe("2026-08-01");
    expect(persisted.firstSeenAt).toBe(row.first_seen_at);
    expect(persisted.lastSeenAt).toBe(row.last_seen_at);
  });

  it("fills previously-null dates the first time a scan learns them", async () => {
    await upsertAd(env, buildAd({ firstSeenAt: null, lastSeenAt: null }));
    await upsertAd(env, buildAd({ firstSeenAt: "2026-07-03", lastSeenAt: "2026-07-04" }));

    const row = readAdRow("1280520150312258");
    expect(row.first_seen_at).toBe("2026-07-03");
    expect(row.last_seen_at).toBe("2026-07-04");
  });

  it("treats malformed seen timestamps as missing", async () => {
    await upsertAd(env, buildAd({ firstSeenAt: "not-a-date", lastSeenAt: "also-not-a-date" }));

    let row = readAdRow("1280520150312258");
    expect(row.first_seen_at).toBeNull();
    expect(row.last_seen_at).toBeNull();

    await upsertAd(env, buildAd({ firstSeenAt: "2026-07-03", lastSeenAt: "2026-07-04" }));
    await upsertAd(env, buildAd({ firstSeenAt: "invalid", lastSeenAt: "invalid" }));

    row = readAdRow("1280520150312258");
    expect(row.first_seen_at).toBe("2026-07-03");
    expect(row.last_seen_at).toBe("2026-07-04");
  });

  it("keeps raw_json dates in lockstep with the SQL columns (hydration trap)", async () => {
    await upsertAd(env, buildAd({ firstSeenAt: "2026-07-01", lastSeenAt: "2026-07-10" }));
    // This write would clobber both dates without the ratchet-into-raw_json merge.
    await upsertAd(env, buildAd({ firstSeenAt: null, lastSeenAt: null, body: "Updated copy" }));

    const row = readAdRow("1280520150312258");
    const persisted = JSON.parse(row.raw_json) as AdRecord;
    expect(persisted.firstSeenAt).toBe(row.first_seen_at);
    expect(persisted.lastSeenAt).toBe(row.last_seen_at);
    expect(persisted.firstSeenAt).toBe("2026-07-01");
    expect(persisted.lastSeenAt).toBe("2026-07-10");

    // Hydration reads ONLY raw_json — the hydrated record must carry the
    // ratcheted dates too.
    const [hydrated] = await listAdsByIds(env, ["1280520150312258"]);
    expect(hydrated.firstSeenAt).toBe("2026-07-01");
    expect(hydrated.lastSeenAt).toBe("2026-07-10");
    // …while non-date fields still take the newest scan's values.
    expect(hydrated.body).toBe("Updated copy");
    expect(row.body).toBe("Updated copy");
  });

  it("does not mutate the caller's ad record", async () => {
    await upsertAd(env, buildAd({ firstSeenAt: "2026-07-01", lastSeenAt: "2026-07-10" }));

    const incoming = buildAd({ firstSeenAt: null, lastSeenAt: null });
    await upsertAd(env, incoming);

    expect(incoming.firstSeenAt).toBeNull();
    expect(incoming.lastSeenAt).toBeNull();
  });

  it("preserves canonical analysis fields when a later scan has no captured evidence", async () => {
    await upsertAd(env, buildAd({
      analysisFields: [
        {
          scopeType: "ad",
          fieldKey: "translated_text",
          fieldValue: "Earlier translated text",
          provenanceSource: "ai_summary",
          extractorVersion: "translation-v1",
          confidence: 0.8,
        },
      ],
    }));

    await upsertAd(env, buildAd({
      analysisFields: [
        {
          scopeType: "ad",
          fieldKey: "hook",
          fieldValue: "Latest scan hook",
          provenanceSource: "meta_library_browser",
          extractorVersion: "structured-v1",
          confidence: 1,
        },
      ],
    }));

    const [persisted] = await listAdsByIds(env, ["1280520150312258"]);
    expect(persisted.analysisFields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldKey: "translated_text",
        fieldValue: "Earlier translated text",
      }),
      expect.objectContaining({
        fieldKey: "hook",
        fieldValue: "Latest scan hook",
      }),
    ]));

    const analysisRows = harness.sqlite.prepare(
      "SELECT field_key, field_value FROM analysis_field WHERE scope_type = 'ad' AND scope_id = ?",
    ).all("1280520150312258") as Array<{ field_key: string; field_value: string }>;
    expect(analysisRows).toEqual(expect.arrayContaining([
      { field_key: "translated_text", field_value: "Earlier translated text" },
      { field_key: "hook", field_value: "Latest scan hook" },
    ]));
  });

  it("drops Meta Ad Library chrome captured as the CTA from persisted rows (FIX-14 read side)", async () => {
    // Simulate an ad persisted before the extraction-side chrome guard landed:
    // the cta column and raw_json both carry the library "Menu" overflow label.
    await upsertAd(env, buildAd({ cta: "Menu" }));

    const [persisted] = await listAdsByIds(env, ["1280520150312258"]);
    expect(persisted.cta).toBe("");

    // The same guard must hold for every exact chrome token, case and
    // whitespace variants included, so no consumer (public search selection,
    // creative wall, digest, report, export) can render them.
    for (const chromeCta of [
      "Menu",
      " menu ",
      "Open Drop-down",
      "See ad details",
      "See summary details",
      "View ad details",
      "Meta Ad Library result",
      "More",
      "Report ad",
    ]) {
      await upsertAd(env, buildAd({ metaAdId: `chrome-${chromeCta.length}`, cta: chromeCta }));
      const [hydrated] = await listAdsByIds(env, [`chrome-${chromeCta.length}`]);
      expect(hydrated.cta).toBe("");
    }

    // Exact production value from public search: "Menu" plus newline plus
    // U+200B. Kept out of the length-keyed loop above because
    // "Menu\n\u200B".length === 6 collides with " menu ".
    await upsertAd(env, buildAd({ metaAdId: "chrome-zwsp-menu", cta: "Menu\n\u200B" }));
    const [zwsp] = await listAdsByIds(env, ["chrome-zwsp-menu"]);
    expect(zwsp.cta).toBe("");
  });

  it("never drops a real advertiser CTA from persisted rows (FIX-14 read side)", async () => {
    for (const realCta of ["Shop Now", "Learn more", "Sign up", "Apply now", "Book now", "Contact us", "Buy combo", "WhatsApp now"]) {
      await upsertAd(env, buildAd({ metaAdId: `real-${realCta.length}`, cta: realCta }));
      const [hydrated] = await listAdsByIds(env, [`real-${realCta.length}`]);
      expect(hydrated.cta).toBe(realCta);
    }
  });

  it("removes stale hook and offer fields when current source evidence has neither", async () => {
    await upsertAd(env, buildAd({
      analysisFields: [
        {
          scopeType: "ad",
          fieldKey: "hook",
          fieldValue: "Old fabricated hook",
          provenanceSource: "meta_library_browser",
          extractorVersion: "structured-v1",
          confidence: 0.86,
        },
        {
          scopeType: "ad",
          fieldKey: "offer",
          fieldValue: "Shop now",
          provenanceSource: "meta_library_browser",
          extractorVersion: "structured-v1",
          confidence: 0.84,
        },
      ],
    }));

    const honestIncoming = buildAd({ hook: "", offer: "", analysisFields: [] });
    const [hydrated] = await hydrateAdsWithPersistedCreatives(env, [honestIncoming]);
    expect(hydrated.analysisFields.map((field) => field.fieldKey)).not.toContain("hook");
    expect(hydrated.analysisFields.map((field) => field.fieldKey)).not.toContain("offer");

    await upsertAd(env, honestIncoming);
    const [persisted] = await listAdsByIds(env, [honestIncoming.metaAdId]);
    expect(persisted.analysisFields.map((field) => field.fieldKey)).not.toContain("hook");
    expect(persisted.analysisFields.map((field) => field.fieldKey)).not.toContain("offer");
  });

  it("preserves higher-fidelity hook and offer fields across an empty browser fallback", async () => {
    await upsertAd(env, buildAd({
      source: "meta_api",
      analysisFields: [
        {
          scopeType: "ad",
          fieldKey: "hook",
          fieldValue: "API hook",
          provenanceSource: "meta_api",
          extractorVersion: "structured-v1",
          confidence: 0.86,
        },
        {
          scopeType: "ad",
          fieldKey: "offer",
          fieldValue: "₹999",
          provenanceSource: "meta_api",
          extractorVersion: "structured-v1",
          confidence: 0.84,
        },
      ],
    }));

    const browserFallback = buildAd({
      source: "meta_library_browser",
      hook: "",
      offer: "",
      analysisFields: [],
    });
    const [hydrated] = await hydrateAdsWithPersistedCreatives(env, [browserFallback]);
    expect(hydrated.analysisFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "hook", fieldValue: "API hook" }),
      expect.objectContaining({ fieldKey: "offer", fieldValue: "₹999" }),
    ]));

    await upsertAd(env, browserFallback);
    const [persisted] = await listAdsByIds(env, [browserFallback.metaAdId]);
    expect(persisted.analysisFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "hook", fieldValue: "API hook" }),
      expect.objectContaining({ fieldKey: "offer", fieldValue: "₹999" }),
    ]));
  });

  it("does not let a late older capture overwrite newer canonical evidence", async () => {
    const evidence = (label: string, capturedAt: string) => buildAd({
      landingPage: {
        rawUrl: "https://nykaaman.com/sale",
        canonicalUrl: "https://nykaaman.com/sale",
        rawHeadline: `${label} landing headline`,
        normalizedHeadline: `${label} landing headline`,
        normalizedHeadlineHash: `${label}-landing-hash`,
        captureMethod: "browser_render",
        artifactKey: `proof/${label}.png`,
        capturedAt,
      },
      creativeText: `${label} creative text`,
      creativeTextCaptureMethod: "ad_snapshot_fetch",
      creativeTextMetadata: { capturedAt, source: label },
      analysisFields: [
        {
          scopeType: "ad",
          fieldKey: "ocr_text",
          fieldValue: `${label} creative text`,
          provenanceSource: "ad_snapshot_fetch",
          extractorVersion: "ocr-v1",
          confidence: 0.8,
          metadata: { capturedAt },
        },
        {
          scopeType: "ad",
          fieldKey: "landing_page_headline_summary",
          fieldValue: `${label} landing headline`,
          provenanceSource: "browser_render",
          extractorVersion: "landing-v1",
          confidence: 0.9,
          metadata: { capturedAt },
        },
        {
          scopeType: "ad",
          fieldKey: "translated_text",
          fieldValue: `${label} translated text`,
          provenanceSource: "ai_summary",
          extractorVersion: "translation-v1",
          confidence: 0.7,
          metadata: { capturedAt },
        },
      ],
    });

    const originalPrepare = harness.db.prepare.bind(harness.db);
    const originalBatch = harness.db.batch.bind(harness.db);
    let releaseOlderProjection!: () => void;
    let markOlderProjectionStarted!: () => void;
    const olderProjectionStarted = new Promise<void>((resolve) => {
      markOlderProjectionStarted = resolve;
    });
    const olderProjectionRelease = new Promise<void>((resolve) => {
      releaseOlderProjection = resolve;
    });
    (harness.db as unknown as { prepare: typeof harness.db.prepare }).prepare = (sql: string) => {
      const prepared = originalPrepare(sql);
      return {
        bind(...bindings: unknown[]) {
          const statement = prepared.bind(...bindings);
          return Object.assign(statement, {
            isOlderEvidenceProjection:
              sql.includes("analysis_field") && bindings.includes("older creative text"),
          });
        },
      };
    };
    (harness.db as unknown as { batch: typeof harness.db.batch }).batch = async (statements) => {
      if (statements.some((statement) => (
        statement as unknown as { isOlderEvidenceProjection?: boolean }
      ).isOlderEvidenceProjection)) {
        markOlderProjectionStarted();
        await olderProjectionRelease;
      }
      return originalBatch(statements);
    };

    const olderWrite = upsertAd(env, evidence("older", "2026-07-14T11:00:00.000Z"));
    await olderProjectionStarted;
    await upsertAd(env, evidence("newer", "2026-07-14T12:00:00.000Z"));
    releaseOlderProjection();
    await olderWrite;

    const [persisted] = await listAdsByIds(env, ["1280520150312258"]);
    expect(persisted.landingPage?.rawHeadline).toBe("newer landing headline");
    expect(persisted.creativeText).toBe("newer creative text");
    expect(persisted.creativeTextMetadata?.source).toBe("newer");
    expect(persisted.analysisFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "ocr_text", fieldValue: "newer creative text" }),
      expect.objectContaining({ fieldKey: "translated_text", fieldValue: "newer translated text" }),
      expect.objectContaining({
        fieldKey: "landing_page_headline_summary",
        fieldValue: "newer landing headline",
      }),
    ]));

    const analysisRows = harness.sqlite.prepare(
      "SELECT field_key, field_value FROM analysis_field WHERE scope_type = 'ad' AND scope_id = ?",
    ).all("1280520150312258") as Array<{ field_key: string; field_value: string }>;
    expect(analysisRows).toEqual(expect.arrayContaining([
      { field_key: "ocr_text", field_value: "newer creative text" },
      { field_key: "translated_text", field_value: "newer translated text" },
      { field_key: "landing_page_headline_summary", field_value: "newer landing headline" },
    ]));
  });
});
