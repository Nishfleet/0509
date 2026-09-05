import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveScheduledScanCacheMaxAgeMs } from "~/lib/discovery-cache.server";
import { freeWeeklyDigestUpgradeNote } from "~/lib/pricing";

type SearchResponse = {
  ads: unknown[];
  nextCursor: string | null;
  source: string;
  provider?: string;
  cacheStatus?: string;
};

let emailSend = vi.fn();

const emailEnv = {
  get EMAIL() {
    return { send: emailSend };
  },
  EMAIL_FROM_EMAIL: "alerts@0509.io",
};

function mockEmailSend(messageId = "msg_1") {
  emailSend = vi.fn().mockResolvedValue({ messageId });
  return emailSend;
}

function emailSendPayload(sendMock: ReturnType<typeof vi.fn>) {
  return sendMock.mock.calls[0]?.[0];
}

beforeEach(() => {
  vi.resetModules();
  emailSend = vi.fn();
  vi.doMock("~/lib/email-verification.server", () => ({
    isUserEmailVerified: vi.fn().mockResolvedValue(true),
    requireVerifiedEmailForRetention: vi.fn().mockResolvedValue({ ok: true }),
    emailUnverifiedActionResult: () => ({
      ok: false,
      error: "email_unverified",
      message: "Verify your email",
    }),
    requestEmailVerification: vi.fn().mockResolvedValue({ ok: true }),
    EMAIL_UNVERIFIED_ERROR: "email_unverified",
    EMAIL_UNVERIFIED_MESSAGE: "Verify your email",
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/email-verification.server");
  vi.doUnmock("~/lib/plan.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/meta-api.server");
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
});

describe("free weekly watch cost controls", () => {
  it("maps the weekly cadence to a 7-day shared discovery-cache window", () => {
    expect(resolveScheduledScanCacheMaxAgeMs("weekly")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("reuses a 6-day-old shared scheduled cache entry for a free weekly scan without calling the provider", async () => {
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>();
    const fetchedAt = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_api:fp-nykaa:india:page-1",
      provider: "meta_api",
      // Another workspace's scheduled scan produced this entry — the free
      // Monday scan must ride it even though its TTL expiry passed long ago.
      routeContext: "watchlist_scan",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: {
        ads: [
          {
            metaAdId: "shared-cache-free-1",
            advertiser: "Nykaa",
            body: "Shared cache offer",
            previewHeadline: "Shared cache offer",
            previewSubhead: "",
            hook: "Shared cache offer",
            offer: "Fresh enough for weekly",
            cta: "Shop now",
            format: "image",
            languageLabel: "English",
            destinationType: "website",
            landingPageUrl: "https://www.nykaa.com/shared",
            adSnapshotUrl: "https://www.facebook.com/ads/library/?id=shared-cache-free-1",
            countries: ["India"],
            platforms: ["Facebook"],
            firstSeenAt: null,
            lastSeenAt: null,
            active: true,
            researchSummary: "Shared cache fixture",
            source: "meta_api",
            analysisFields: [],
            tags: [],
          },
        ],
        nextCursor: null,
        source: "meta_api",
        provider: "meta_api",
        cacheStatus: "miss",
      },
      fetchedAt,
      expiresAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      browserMsUsed: null,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    });

    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn(),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      { DB: {} as D1Database } as never,
      {
        mode: "advertiser",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "watchlist_scan",
        customerMetaAdLibraryToken: "customer-token",
        forceLive: true,
        acceptCacheYoungerThanMs: resolveScheduledScanCacheMaxAgeMs("weekly") ?? undefined,
      },
    );

    expect(getDiscoveryCacheEntry).toHaveBeenCalledTimes(1);
    expect(metaApiSearch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      cacheStatus: "hit",
      discoveryStatus: "healthy",
      ads: [expect.objectContaining({ metaAdId: "shared-cache-free-1" })],
    });
  });

  it("still scrapes live when the shared cache entry is older than 7 days", async () => {
    const metaApiSearch = vi
      .fn<(...args: unknown[]) => Promise<SearchResponse>>()
      .mockResolvedValue({
        ads: [],
        nextCursor: null,
        source: "meta_api",
        provider: "meta_api",
        cacheStatus: "miss",
      });
    const fetchedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_api:fp-nykaa:india:page-1",
      provider: "meta_api",
      routeContext: "watchlist_scan",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: {
        ads: [],
        nextCursor: null,
        source: "meta_api",
        provider: "meta_api",
        cacheStatus: "miss",
      },
      fetchedAt,
      expiresAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      browserMsUsed: null,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    });

    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn(),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    await searchAdsViaSourceResolver(
      { DB: {} as D1Database } as never,
      {
        mode: "advertiser",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "watchlist_scan",
        customerMetaAdLibraryToken: "customer-token",
        forceLive: true,
        acceptCacheYoungerThanMs: resolveScheduledScanCacheMaxAgeMs("weekly") ?? undefined,
      },
    );

    expect(metaApiSearch).toHaveBeenCalledTimes(1);
  });
});

function digestDeliveryDataMocks(upsertDigestDelivery = vi.fn()) {
  const upsertDeliveryTarget = vi.fn().mockResolvedValue({
    id: "email-target-1",
    userId: "user-1",
    watchlistId: null,
    channel: "email",
    targetValue: "owner@example.com",
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: "account_email",
    optedInAt: "2026-04-19T00:00:00.000Z",
    isPaused: false,
    pausedAt: null,
    optedOutAt: null,
    templateEligible: false,
    lastSuccessfulDeliveryAt: null,
    lastSuccessfulAttemptId: null,
    providerIdentifier: null,
    metadata: {},
    createdAt: "2026-04-19T00:00:00.000Z",
    updatedAt: "2026-04-19T00:00:00.000Z",
  });

  return {
    listAdsByIds: vi.fn().mockResolvedValue([]),
    createDeliveryAttempt: vi.fn().mockResolvedValue("attempt-1"),
    updateDeliveryAttemptResult: vi.fn(),
    getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
    getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
      id: "workspace-1",
      userId: "user-1",
      sensitivityMode: "balanced",
      instantEnabled: false,
      digestEnabled: true,
      digestCadencePreference: "plan_default",
      emailEnabled: true,
      whatsappEnabled: false,
      slackEnabled: false,
      quietHours: null,
      timezone: "UTC",
      createdAt: "2026-04-19T00:00:00.000Z",
      updatedAt: "2026-04-19T00:00:00.000Z",
    }),
    legacyWorkspaceDeliveryDefaults: vi.fn(),
    listDeliveryTargets: vi.fn().mockResolvedValue([]),
    provisionVerifiedAccountEmailTargetIfUnsuppressed: upsertDeliveryTarget,
    upsertDeliveryTarget,
    upsertDigestDelivery,
  };
}

const digestInput = {
  userId: "user-1",
  userName: "Owner",
  accountEmail: "owner@example.com",
  digestRunId: "digest-1",
  periodStart: "2026-04-12T00:00:00.000Z",
  periodEnd: "2026-04-19T00:00:00.000Z",
  items: [
    {
      eventId: "event-1",
      watchlistId: "watch-1",
      watchlistName: "boAt watch",
      eventType: "landing_page_offer_changed",
      title: "Landing page offer changed",
      summary: "Offer changed on the landing page.",
      metadata: {
        priorityScore: 90,
        priorityBand: "High priority",
        recommendedAction: "Today: review the offer shift.",
        proofTrail: "Verified from a page snapshot",
        sourceStatus: "proof_backed",
        proofCaptureId: "proof-1",
        confirmedAt: "2026-04-19T00:00:00.000Z",
      },
    },
  ],
};

// Note: build the env after mockEmailSend() — spreading emailEnv snapshots the
// EMAIL getter's current send mock.
function digestEnv() {
  return {
    ...emailEnv,
    APP_ORIGIN: "https://app.0509.test/",
    BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
    BETTER_AUTH_URL: "https://0509.io",
  };
}

describe("free weekly digest email", () => {
  it("sends the full digest template with the upgrade line and unsubscribe for free users", async () => {
    const sendMock = mockEmailSend("msg_free_1");
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
    }));
    vi.doMock("~/lib/data.server", () => digestDeliveryDataMocks());
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    const result = await deliverWeeklyDigest(digestEnv() as never, digestInput as never);

    expect(result).toMatchObject({ attempts: 1, channels: ["email"] });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = emailSendPayload(sendMock);
    // Full template, not a crippled one: the digest is the product demo.
    expect(payload.html).toContain("Top moves");
    expect(payload.text).toContain("Top moves:");
    // The tasteful upgrade line, fact-checked against the Scout entitlements.
    expect(payload.html).toContain("instant first scan");
    expect(payload.html).toContain("Scout checks every 6 hours");
    expect(payload.html).toContain("/#pricing");
    expect(payload.text).toContain(freeWeeklyDigestUpgradeNote());
    // Free recipients must be able to opt out.
    expect(payload.headers["List-Unsubscribe"]).toContain(
      "https://app.0509.test/unsubscribe?u=user-1&t=email-target-1&sig=",
    );
    expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(payload.html).toContain("Unsubscribe");
  });

  it("keeps paid digests byte-identical: no upgrade line for Starter", async () => {
    const sendMock = mockEmailSend("msg_paid_1");
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
    }));
    vi.doMock("~/lib/data.server", () => digestDeliveryDataMocks());
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    await deliverWeeklyDigest(digestEnv() as never, digestInput as never);

    const payload = emailSendPayload(sendMock);
    expect(payload.html).not.toContain("free weekly watch");
    expect(payload.text).not.toContain("free weekly watch");
  });
});

describe("free digest-frequency preference", () => {
  it("lets a free owner save the digest cadence preference", async () => {
    const upsertWorkspaceDeliveryConfig = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session: { user: { id: "user-1", email: "owner@example.com", name: "Owner" } },
        workspaceUserId: "user-1",
        isMember: false,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
      legacyWorkspaceDeliveryDefaults: vi.fn().mockReturnValue({
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        digestCadencePreference: "plan_default",
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
      }),
      upsertWorkspaceDeliveryConfig,
    }));

    const { action } = await import("~/routes/app.notifications");
    const formData = new FormData();
    formData.set("intent", "save-digest-cadence");
    formData.set("digestCadencePreference", "weekly_only");

    const result = await action({
      context: { cloudflare: { env: {} } },
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({ ok: true });
    expect(upsertWorkspaceDeliveryConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        digestCadencePreference: "weekly_only",
      }),
    );
  });
});
