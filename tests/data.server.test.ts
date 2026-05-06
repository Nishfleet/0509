import { describe, expect, it, vi } from "vitest";

import { CREATIVE_TEXT_EXTRACTOR_VERSION } from "~/lib/creative-text.server";
import {
  createDeliveryAttempt,
  createDiscoveryFetchLog,
  createLandingPageSnapshot,
  createProofCapture,
  createWatchEvent,
  getOperatorSnapshot,
  upsertDiscoveryCacheEntry,
  upsertDiscoveryProviderState,
  legacyWatchEventImportanceScore,
  legacyWorkspaceDeliveryDefaults,
  listAdsByIds,
  upsertAd,
  upsertDeliveryTarget,
  upsertProofTarget,
  upsertWatchlistDeliveryConfig,
  upsertWorkspaceDeliveryConfig,
} from "~/lib/data.server";

function createMockDb(resultsFor?: (sql: string, bindings: unknown[]) => unknown[]) {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];

  return {
    statements,
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            statements.push({ sql, bindings });
            return {
              async run() {
                return { success: true };
              },
              async all<T>() {
                return { results: (resultsFor?.(sql, bindings) ?? []) as T[] };
              },
            };
          },
        };
      },
    },
  };
}

function findStatement(
  statements: Array<{ sql: string; bindings: unknown[] }>,
  ...needles: string[]
) {
  return statements.find((statement) =>
    needles.every((needle) => statement.sql.includes(needle)),
  );
}

describe("createLandingPageSnapshot", () => {
  it("persists structured landing-page fields and landing-page analysis provenance", async () => {
    const mock = createMockDb();

    await createLandingPageSnapshot(
      { DB: mock.db } as never,
      {
        rawUrl: "https://example.com/glow",
        canonicalUrl: "https://example.com/glow",
        rawHeadline: "Glow Serum Sale",
        normalizedHeadline: "glow serum sale",
        normalizedHeadlineHash: "fnv1a-headline",
        ctaText: "Shop now",
        priceText: "Starting at ₹499",
        formPresent: true,
        captureMethod: "landing_page_fetch",
        capturedAt: "2026-03-30T00:00:00.000Z",
        artifactKey: null,
        metadata: {
          fetchStatus: 200,
        },
      },
    );

    const snapshotInsert = mock.statements.find((statement) =>
      statement.sql.includes("INSERT INTO landing_page_snapshot"),
    );
    expect(snapshotInsert?.bindings).toContain("Shop now");
    expect(snapshotInsert?.bindings).toContain("Starting at ₹499");
    expect(snapshotInsert?.bindings).toContain(1);

    const analysisInserts = mock.statements.filter((statement) =>
      statement.sql.includes("INSERT INTO analysis_field"),
    );
    expect(analysisInserts.length).toBe(3);
    expect(analysisInserts.every((statement) => statement.bindings.includes("landing_page"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("cta_text"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("price_text"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("form_present"))).toBe(true);
    expect(analysisInserts.every((statement) => statement.bindings.includes("lp-signals-v1"))).toBe(true);
  });
});

describe("upsertAd", () => {
  it("persists creative OCR analysis fields when present on the ad", async () => {
    const mock = createMockDb();

    await upsertAd(
      { DB: mock.db } as never,
      {
        metaAdId: "meta-boat-1",
        advertiser: "boAt",
        body: "Bass bhi, battery bhi.",
        previewHeadline: "Bass bhi. Battery bhi.",
        previewSubhead: "Launch pricing",
        hook: "Bass bhi. Battery bhi.",
        offer: "Launch pricing",
        cta: "Buy now",
        format: "video",
        languageLabel: "Hinglish",
        destinationType: "website",
        landingPageUrl: "https://boat.example.com/rockerz-neckband",
        adSnapshotUrl: "https://facebook.example.com/ad-snapshot",
        countries: ["India"],
        platforms: ["Instagram"],
        firstSeenAt: null,
        lastSeenAt: null,
        active: true,
        researchSummary: "Summary",
        source: "demo",
        analysisFields: [],
        creativeText: "60 Hours Playback\nOnly ₹999",
        creativeTextCaptureMethod: "ad_snapshot_fetch",
        creativeTextMetadata: {
          fetchStatus: 200,
        },
      },
    );

    const analysisInserts = mock.statements.filter((statement) =>
      statement.sql.includes("INSERT INTO analysis_field"),
    );
    const adInsert = mock.statements.find((statement) =>
      statement.sql.includes("INSERT INTO ad"),
    );

    expect(adInsert?.sql).toContain("creative_text");
    expect(adInsert?.sql).toContain("creative_text_capture_method");
    expect(adInsert?.sql).toContain("creative_text_metadata_json");
    expect(adInsert?.bindings).toContain("60 Hours Playback\nOnly ₹999");
    expect(adInsert?.bindings).toContain("ad_snapshot_fetch");
    expect(
      adInsert?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("\"fetchStatus\":200"),
      ),
    ).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("ocr_text"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("ad_snapshot_fetch"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes(CREATIVE_TEXT_EXTRACTOR_VERSION))).toBe(true);
  });
});

describe("listAdsByIds", () => {
  it("returns parsed ad records for the requested ids", async () => {
    const ad = {
      metaAdId: "meta-boat-1",
      advertiser: "boAt",
      body: "Bass bhi, battery bhi.",
      previewHeadline: "Bass bhi. Battery bhi.",
      previewSubhead: "Launch pricing",
      hook: "Bass bhi. Battery bhi.",
      offer: "Launch pricing",
      cta: "Buy now",
      format: "video",
      languageLabel: "Hinglish",
      destinationType: "website",
      landingPageUrl: "https://boat.example.com/rockerz-neckband",
      adSnapshotUrl: "https://cdn.example.com/boat.png",
      countries: ["India"],
      platforms: ["Instagram"],
      firstSeenAt: null,
      lastSeenAt: null,
      active: true,
      researchSummary: "Summary",
      source: "demo",
      analysisFields: [],
    };

    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              return {
                async all<T>() {
                  if (sql.includes("FROM ad")) {
                    expect(bindings).toEqual(["meta-boat-1"]);
                    return {
                      results: [{
                        id: "meta-boat-1",
                        raw_json: JSON.stringify(ad),
                      }] as T[],
                    };
                  }

                  return { results: [] as T[] };
                },
                async run() {
                  return { success: true };
                },
              };
            },
          };
        },
      },
    };

    const result = await listAdsByIds({ DB: mock.db } as never, ["meta-boat-1"]);

    expect(result).toEqual([ad]);
  });
});

describe("createWatchEvent", () => {
  it("persists proof-first defaults alongside the existing watch-event fields", async () => {
    const mock = createMockDb();

    await createWatchEvent(
      { DB: mock.db } as never,
      {
        watchlistId: "watch-1",
        runId: "run-1",
        eventType: "ad_new",
        adId: "meta-boat-1",
        baselineFromRunId: null,
        title: "New ad detected",
        summary: "A new ad entered the watchlist.",
        metadata: {
          advertiser: "boAt",
        },
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO watch_event"),
    );

    expect(statement?.sql).toContain("status");
    expect(statement?.sql).toContain("importance_score");
    expect(statement?.sql).toContain("candidate_id");
    expect(statement?.sql).toContain("proof_capture_id");
    expect(statement?.sql).toContain("confirmed_at");
    expect(statement?.sql).toContain("last_evaluated_at");
    expect(statement?.bindings).toContain("confirmed");
    expect(statement?.bindings).toContain(0);
  });
});

describe("discovery state persistence", () => {
  it("persists discovery cache entries separately from meta integration logs", async () => {
    const mock = createMockDb();

    await upsertDiscoveryCacheEntry(
      { DB: mock.db } as never,
      {
        cacheKey: "meta_library_browser:fp-nykaa:india",
        provider: "meta_library_browser",
        routeContext: "public_search",
        queryFingerprint: "fp-nykaa",
        country: "India",
        cursor: null,
        payload: {
          ads: [],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
          cacheStatus: "miss",
        },
        fetchedAt: "2026-04-19T00:00:00.000Z",
        expiresAt: "2026-04-19T00:15:00.000Z",
        browserMsUsed: 2500,
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO discovery_cache_entry"),
    );

    expect(statement?.bindings).toContain("meta_library_browser:fp-nykaa:india");
    expect(statement?.bindings).toContain("meta_library_browser");
    expect(statement?.bindings).toContain("public_search");
    expect(statement?.bindings).toContain(2500);
  });

  it("persists provider health and fetch logs for discovery runs", async () => {
    const mock = createMockDb();

    await createDiscoveryFetchLog(
      { DB: mock.db } as never,
      {
        provider: "meta_library_browser",
        routeContext: "watchlist_scan",
        queryFingerprint: "fp-nykaa",
        country: "India",
        status: "failed",
        cacheStatus: "miss",
        failureClass: "selector_drift",
        browserMsUsed: 0,
        metadata: {
          watchlistId: "watch-1",
        },
      },
    );
    await upsertDiscoveryProviderState(
      { DB: mock.db } as never,
      {
        provider: "meta_library_browser",
        status: "degraded",
        failureClass: "selector_drift",
        summary: "Commercial discovery degraded; serving cached results.",
        lastSuccessAt: null,
        lastFailureAt: "2026-04-19T00:00:00.000Z",
        metadata: {
          sampleSize: 20,
        },
      },
    );

    const fetchLogStatement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO discovery_fetch_log"),
    );
    const providerStateStatement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO discovery_provider_state"),
    );

    expect(fetchLogStatement?.bindings).toContain("selector_drift");
    expect(providerStateStatement?.bindings).toContain("degraded");
    expect(providerStateStatement?.bindings).toContain(
      "Commercial discovery degraded; serving cached results.",
    );
  });
});

describe("getOperatorSnapshot", () => {
  it("limits stale failure rows to the recent ops window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T10:00:00.000Z"));

    try {
      const mock = createMockDb();

      await getOperatorSnapshot({ DB: mock.db } as never);

      const recentWindowIso = "2026-04-19T10:00:00.000Z";
      const failingRuns = findStatement(
        mock.statements,
        "FROM watchlist_run",
        "watchlist_run.status = 'failed'",
      );
      const failedProofs = findStatement(
        mock.statements,
        "FROM proof_capture",
        "proof_capture.status = 'failed'",
      );
      const budgetBlockedProofs = findStatement(
        mock.statements,
        "FROM proof_capture",
        "skipped_due_to_budget",
      );
      const deliveryFailures = findStatement(
        mock.statements,
        "FROM delivery_attempt",
        "delivery_attempt.status = 'failed'",
      );
      const discoveryFailures = findStatement(
        mock.statements,
        "FROM discovery_fetch_log",
        "discovery_fetch_log.status = 'failed'",
      );

      expect(failingRuns?.bindings).toContain(recentWindowIso);
      expect(failedProofs?.bindings).toContain(recentWindowIso);
      expect(budgetBlockedProofs?.bindings).toContain(recentWindowIso);
      expect(deliveryFailures?.bindings).toContain(recentWindowIso);
      expect(discoveryFailures?.bindings).toContain(recentWindowIso);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces discovery failure query metadata for operator triage", async () => {
    const mock = createMockDb((sql) => {
      if (!sql.includes("FROM discovery_fetch_log")) {
        return [];
      }

      return [
        {
          fetchId: "fetch-1",
          provider: "meta_library_browser",
          routeContext: "public_search",
          country: "India",
          cacheStatus: "miss",
          failureClass: "login_wall",
          browserMsUsed: 0,
          metadataJson: JSON.stringify({
            queryLabel: "adflex",
            queryMode: "advertiser",
          }),
          createdAt: "2026-05-05T06:00:00.000Z",
        },
      ];
    });

    const snapshot = await getOperatorSnapshot({ DB: mock.db } as never);

    expect(snapshot.discoveryFailures[0]).toMatchObject({
      fetchId: "fetch-1",
      queryLabel: "adflex",
      queryMode: "advertiser",
      failureClass: "login_wall",
    });
  });

  it("surfaces discovery provider error messages for operator triage", async () => {
    const mock = createMockDb((sql) => {
      if (!sql.includes("FROM discovery_provider_state")) {
        return [];
      }

      return [
        {
          provider: "meta_api",
          status: "degraded",
          failureClass: "login_wall",
          summary: "Meta Ad Library API fallback failed while browser capture is unavailable.",
          lastSuccessAt: null,
          lastFailureAt: "2026-05-06T00:52:54.103Z",
          metadataJson: JSON.stringify({
            errorMessage: "Error validating access token: Session has expired.",
          }),
          updatedAt: "2026-05-06T00:52:54.330Z",
        },
      ];
    });

    const snapshot = await getOperatorSnapshot({ DB: mock.db } as never);

    expect(snapshot.discoveryProviders[0]).toMatchObject({
      provider: "meta_api",
      status: "degraded",
      lastErrorMessage: "Error validating access token: Session has expired.",
    });
  });
});

describe("upsertProofTarget", () => {
  it("persists canonical page identity separately from proof-target identity", async () => {
    const mock = createMockDb();

    await upsertProofTarget(
      { DB: mock.db } as never,
      {
        watchlistId: "watch-1",
        adId: "meta-boat-1",
        landingPageUrl: "https://example.com/glow?utm_source=meta",
        canonicalPageIdentity: "example.com/glow",
        proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO proof_target"),
    );

    expect(statement?.bindings).toContain("example.com/glow");
    expect(statement?.bindings).toContain("watch-1:meta-boat-1:example.com/glow");
    expect(statement?.sql).toContain("canonical_page_identity");
    expect(statement?.sql).toContain("proof_target_identity");
  });
});

describe("createProofCapture", () => {
  it("persists extractor metadata, render metadata, and idempotency fields", async () => {
    const mock = createMockDb();

    await createProofCapture(
      { DB: mock.db } as never,
      {
        proofTargetId: "proof-target-1",
        status: "succeeded",
        screenshotArtifactKey: "proof/shot.webp",
        htmlArtifactKey: "proof/page.html",
        extractedFields: {
          headline: "Glow Serum Sale",
        },
        fieldConfidence: {
          headline: 0.97,
        },
        extractionWarnings: ["cookie_banner_present"],
        captureMetadata: {
          browser: "browser_run",
        },
        renderMode: "mobile",
        deviceProfile: "mobile_default",
        extractorVersion: "proof-extractor-v1",
        idempotencyKey: "capture:watch-1:meta-boat-1",
        attemptedAt: "2026-04-18T16:00:00.000Z",
        succeededAt: "2026-04-18T16:00:05.000Z",
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO proof_capture"),
    );

    expect(statement?.sql).toContain("field_confidence_json");
    expect(statement?.sql).toContain("extraction_warnings_json");
    expect(statement?.sql).toContain("render_mode");
    expect(statement?.sql).toContain("device_profile");
    expect(statement?.sql).toContain("idempotency_key");
    expect(
      statement?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("\"headline\":0.97"),
      ),
    ).toBe(true);
    expect(
      statement?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("cookie_banner_present"),
      ),
    ).toBe(true);
    expect(statement?.bindings).toContain("capture:watch-1:meta-boat-1");
  });
});

describe("upsertWorkspaceDeliveryConfig", () => {
  it("persists delivery sensitivity and channel toggles for a workspace", async () => {
    const mock = createMockDb();

    await upsertWorkspaceDeliveryConfig(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        quietHours: {
          startHour: 22,
          endHour: 8,
        },
        timezone: "Asia/Kolkata",
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO workspace_delivery_config"),
    );

    expect(statement?.bindings).toContain("user-1");
    expect(statement?.bindings).toContain("balanced");
    expect(statement?.bindings).toContain(0);
    expect(statement?.bindings).toContain(1);
    expect(
      statement?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("\"startHour\":22"),
      ),
    ).toBe(true);
  });
});

describe("upsertWatchlistDeliveryConfig", () => {
  it("persists watchlist-specific delivery overrides", async () => {
    const mock = createMockDb();

    await upsertWatchlistDeliveryConfig(
      { DB: mock.db } as never,
      {
        watchlistId: "watch-1",
        userId: "user-1",
        sensitivityMode: "quiet",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: true,
        quietHours: {
          startHour: 23,
          endHour: 7,
        },
        timezone: "UTC",
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO watchlist_delivery_config"),
    );

    expect(statement?.bindings).toContain("watch-1");
    expect(statement?.bindings).toContain("user-1");
    expect(statement?.bindings).toContain("quiet");
    expect(statement?.bindings).toContain(0);
    expect(statement?.bindings).toContain(1);
    expect(statement?.bindings).toContain("UTC");
    expect(
      statement?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("\"startHour\":23"),
      ),
    ).toBe(true);
  });
});

describe("upsertDeliveryTarget", () => {
  it("persists channel-specific validation and opt-in state", async () => {
    const mock = createMockDb();

    await upsertDeliveryTarget(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        watchlistId: "watch-1",
        channel: "whatsapp",
        targetValue: "+919999999999",
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
        optInSource: "manual_import",
        optedInAt: "2026-04-18T10:00:00.000Z",
        templateEligible: true,
        providerIdentifier: "wa_123",
        metadata: {
          label: "Founder WhatsApp",
        },
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO delivery_target"),
    );

    expect(statement?.bindings).toContain("user-1");
    expect(statement?.bindings).toContain("watch-1");
    expect(statement?.bindings).toContain("whatsapp");
    expect(statement?.bindings).toContain("+919999999999");
    expect(statement?.bindings).toContain("validated");
    expect(statement?.bindings).toContain(1);
    expect(statement?.bindings).toContain("manual_import");
    expect(statement?.bindings).toContain("wa_123");
    expect(
      statement?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("\"label\":\"Founder WhatsApp\""),
      ),
    ).toBe(true);
  });

  it("updates an existing workspace-level target instead of inserting duplicates", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              statements.push({ sql, bindings });
              return {
                async all<T>() {
                  if (sql.includes("FROM delivery_target")) {
                    return {
                      results: [
                        {
                          id: "target-existing",
                          user_id: "user-1",
                          watchlist_id: null,
                          channel: "email",
                          target_value: "owner@example.com",
                          validation_status: "validated",
                          is_validated: 1,
                          is_opted_in: 1,
                          opt_in_source: "account_email",
                          opted_in_at: "2026-04-18T00:00:00.000Z",
                          is_paused: 0,
                          paused_at: null,
                          opted_out_at: null,
                          template_eligible: 0,
                          last_successful_delivery_at: null,
                          last_successful_attempt_id: null,
                          provider_identifier: null,
                          metadata_json: "{}",
                          created_at: "2026-04-18T00:00:00.000Z",
                          updated_at: "2026-04-18T00:00:00.000Z",
                        },
                      ] as T[],
                    };
                  }

                  return { results: [] as T[] };
                },
                async run() {
                  return { success: true };
                },
              };
            },
          };
        },
      },
    };

    await upsertDeliveryTarget(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        watchlistId: null,
        channel: "email",
        targetValue: "owner@example.com",
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
      },
    );

    expect(
      statements.some(
        (statement) =>
          statement.sql.includes("FROM delivery_target") &&
          statement.sql.includes("watchlist_id IS NULL"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) => statement.sql.includes("UPDATE delivery_target")),
    ).toBe(true);
    expect(
      statements.some((statement) => statement.sql.includes("INSERT INTO delivery_target")),
    ).toBe(false);
  });
});

describe("createDeliveryAttempt", () => {
  it("persists payload snapshots and webhook status on delivery attempts", async () => {
    const mock = createMockDb();

    await createDeliveryAttempt(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        watchlistId: "watch-1",
        digestRunId: null,
        deliveryTargetId: "target-1",
        lane: "customer",
        channel: "email",
        provider: "resend",
        status: "sent",
        webhookStatus: "legacy_unknown",
        targetValue: "owner@example.com",
        providerMessageId: "msg_123",
        providerStatusLastSeenAt: "2026-04-18T16:30:00.000Z",
        eventIds: ["event-1", "event-2"],
        payloadSnapshot: {
          subject: "3 changes this week",
        },
        idempotencyKey: "delivery:user-1:digest-2026-04-18",
        sentAt: "2026-04-18T16:29:00.000Z",
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO delivery_attempt"),
    );

    expect(statement?.sql).toContain("webhook_status");
    expect(statement?.sql).toContain("payload_snapshot_json");
    expect(statement?.sql).toContain("idempotency_key");
    expect(statement?.bindings).toContain("legacy_unknown");
    expect(statement?.bindings).toContain("delivery:user-1:digest-2026-04-18");
    expect(
      statement?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("\"subject\":\"3 changes this week\""),
      ),
    ).toBe(true);
  });
});

describe("legacy proof-first defaults", () => {
  it("keeps legacy users digest-first and maps legacy event importance explicitly", () => {
    expect(legacyWatchEventImportanceScore("landing_page_url_changed")).toBe(85);
    expect(legacyWatchEventImportanceScore("landing_page_headline_changed")).toBe(75);
    expect(legacyWatchEventImportanceScore("ad_new")).toBe(65);
    expect(legacyWatchEventImportanceScore("ad_inactive")).toBe(60);

    expect(
      legacyWorkspaceDeliveryDefaults({
        hasEmail: true,
      }),
    ).toEqual({
      sensitivityMode: "balanced",
      instantEnabled: false,
      digestEnabled: true,
      emailEnabled: true,
      whatsappEnabled: false,
    });
  });
});
