import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdRecord,
  CollectionItemRecord,
  CollectionRecord,
  DigestRecord,
  WatchEventRecord,
  WatchlistRecord,
} from "~/lib/types";
import { mockAgencyWorkspacePlan } from "./helpers/agency-plan-mock";

vi.mock("~/lib/ga-customer-surface", () => ({
  isSlackDeliveryCustomerFacing: vi.fn(() => false),
  slackDeliveryUnavailableMessage: vi.fn(
    () => "Slack delivery isn’t available. Nothing was saved — use email delivery instead.",
  ),
}));

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-04-03T00:00:00.000Z",
  },
};

const ad: AdRecord = {
  metaAdId: "meta-nykaa-1",
  advertiser: "Nykaa",
  body: "Build your skincare routine.",
  previewHeadline: "Routine bundle",
  previewSubhead: "Dermat approved",
  hook: "Routine-first bundle",
  offer: "Bundle and save",
  cta: "Build your routine",
  format: "image",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: "https://nykaa.com/routine",
  adSnapshotUrl: "https://facebook.com/ads/library/?id=meta-nykaa-1",
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: "2026-04-10T00:00:00.000Z",
  lastSeenAt: "2026-04-18T00:00:00.000Z",
  active: true,
  researchSummary: "Nykaa is repeating a routine-first bundle hook.",
  source: "meta_library_browser",
  analysisFields: [],
};

const collection: CollectionRecord = {
  id: "collection-1",
  userId: "user-1",
  name: "Beauty proof",
  description: "Proof for the weekly growth review.",
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z",
};

const collectionItem: CollectionItemRecord = {
  id: "item-1",
  collectionId: "collection-1",
  adId: "meta-nykaa-1",
  note: "Use in sales deck.",
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z",
  ad,
  tags: ["beauty", "offer"],
};

const externalAd: AdRecord = {
  metaAdId: "external:linkedin:fnv1a-abc123",
  advertiser: "Mamaearth",
  body: "Creator-led sunscreen routine\nCombo launch\nSpend: ₹50k | Impressions: 120k | Reach: 80k",
  previewHeadline: "Creator-led sunscreen routine",
  previewSubhead: "LinkedIn",
  hook: "Creator-led sunscreen routine",
  offer: "Combo launch",
  cta: "Shop now",
  format: "unknown",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: null,
  adSnapshotUrl: null,
  countries: [],
  platforms: ["LinkedIn"],
  firstSeenAt: "2026-06-06T00:00:00.000Z",
  lastSeenAt: null,
  active: false,
  researchSummary: "Spend: ₹50k | Impressions: 120k | Reach: 80k",
  source: "external",
  analysisFields: [
    {
      scopeType: "ad",
      fieldKey: "proof_url",
      fieldValue: "https://www.linkedin.com/posts/mamaearth-campaign",
      provenanceSource: "user",
      extractorVersion: "manual-external-proof-v1",
      confidence: 1,
    },
    {
      scopeType: "ad",
      fieldKey: "observed_spend",
      fieldValue: "₹50k",
      provenanceSource: "user",
      extractorVersion: "manual-external-proof-v1",
      confidence: 1,
    },
    {
      scopeType: "ad",
      fieldKey: "observed_impressions",
      fieldValue: "120k",
      provenanceSource: "user",
      extractorVersion: "manual-external-proof-v1",
      confidence: 1,
    },
    {
      scopeType: "ad",
      fieldKey: "observed_reach",
      fieldValue: "80k",
      provenanceSource: "user",
      extractorVersion: "manual-external-proof-v1",
      confidence: 1,
    },
  ],
  creativeText: null,
  creativeTextCaptureMethod: null,
  creativeTextMetadata: null,
};

const externalCollectionItem: CollectionItemRecord = {
  id: "item-external-1",
  collectionId: "collection-1",
  adId: "external:linkedin:fnv1a-abc123",
  note: "Seen in launch review.",
  createdAt: "2026-06-06T09:31:00.000Z",
  updatedAt: "2026-06-06T09:31:00.000Z",
  ad: externalAd,
  tags: ["LinkedIn", "manual evidence", "creator"],
};

const watchlist: WatchlistRecord = {
  id: "watchlist-1",
  userId: "user-1",
  name: "Nykaa watch",
  targetType: "advertiser",
  targetId: "nykaa",
  targetFingerprint: "fp-nykaa",
  targetLabel: "Nykaa",
  targetCountry: null,
  isActive: true,
  lastScannedAt: "2026-04-18T10:00:00.000Z",
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-18T10:00:00.000Z",
};

const watchEvent: WatchEventRecord = {
  id: "event-1",
  watchlistId: "watchlist-1",
  runId: "run-1",
  eventType: "landing_page_offer_changed",
  status: "confirmed",
  importanceScore: 84,
  adId: "meta-nykaa-1",
  baselineFromRunId: null,
  candidateId: "candidate-1",
  proofCaptureId: "proof-1",
  title: "Landing page offer changed",
  summary: "The routine bundle offer changed.",
  metadata: {
    from: "Sale-led hero",
    to: "Routine-first bundle",
  },
  confirmedAt: "2026-04-18T10:00:00.000Z",
  suppressedAt: null,
  invalidatedAt: null,
  lastEvaluatedAt: "2026-04-18T10:00:00.000Z",
  createdAt: "2026-04-18T10:00:00.000Z",
};

const digest: DigestRecord = {
  id: "digest-1",
  userId: "user-1",
  periodStart: "2026-04-12T00:00:00.000Z",
  periodEnd: "2026-04-19T00:00:00.000Z",
  createdAt: "2026-04-19T00:00:00.000Z",
  delivery: {
    id: "delivery-1",
    digestRunId: "digest-1",
    provider: "postmark",
    status: "sent",
    recipientEmail: "owner@example.com",
    externalMessageId: "pm-1",
    errorMessage: null,
    deliveredAt: "2026-04-19T00:05:00.000Z",
  },
  items: [
    {
      id: "digest-item-1",
      digestRunId: "digest-1",
      watchlistId: "watchlist-1",
      watchlistName: "Nykaa watch",
      eventType: "landing_page_offer_changed",
      title: "Landing page offer changed",
      summary: "The routine bundle offer changed.",
      metadata: {
        priorityScore: 90,
        priorityBand: "High priority",
        recommendedAction: "Today: brief one counter-test.",
        proofTrail: "proof capture - source-backed - 18/4/2026",
      },
      createdAt: "2026-04-19T00:00:00.000Z",
    },
  ],
};

function setupMocks(
  input: {
    collectionItems?: CollectionItemRecord[];
    watchEvents?: WatchEventRecord[];
    digest?: DigestRecord;
  } = {},
) {
  mockAgencyWorkspacePlan();
  const env = { DB: {} };
  vi.doMock("~/lib/auth.server", () => ({
    requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/lib/data.server", () => ({
    getCollection: vi.fn().mockResolvedValue(collection),
    getDigest: vi.fn().mockResolvedValue(input.digest ?? digest),
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    listCollectionItems: vi.fn().mockResolvedValue(input.collectionItems ?? [collectionItem]),
    listWatchEvents: vi.fn().mockResolvedValue(input.watchEvents ?? [watchEvent]),
  }));
  return env;
}

async function loadExport(url: string) {
  const { loader } = await import("~/routes/export.$resourceType.$resourceId");
  return loader({
    context: { cloudflare: { env: { DB: {} } } },
    params: resourceParams(url),
    request: new Request(url),
  } as never);
}

function resourceParams(url: string) {
  const [, , resourceType, resourceId] = new URL(url).pathname.split("/");
  return { resourceType, resourceId };
}

beforeEach(async () => {
  const { isSlackDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
  vi.mocked(isSlackDeliveryCustomerFacing).mockReturnValue(false);
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("authenticated export route", () => {
  it("keeps CSV as the default collection export", async () => {
    setupMocks();
    const response = await loadExport("https://0509.io/export/collection/collection-1");
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain('"advertiser","hook","offer","cta","metric_proof","proof_url","tags","note"');
    expect(body).toContain('"Nykaa","Routine-first bundle","Bundle and save","Build your routine","","https://facebook.com/ads/library/?id=meta-nykaa-1","beauty|offer","Use in sales deck."');
  });

  it("neutralizes spreadsheet formulas in CSV exports", async () => {
    setupMocks({
      collectionItems: [
        {
          ...collectionItem,
          note: "@SUM(1+1)",
          ad: {
            ...collectionItem.ad,
            advertiser: "=HYPERLINK(\"https://evil.example\")",
            hook: " +SUM(1,1)",
            offer: "-10% off",
          },
        },
      ],
    });
    const response = await loadExport("https://0509.io/export/collection/collection-1");
    const body = await response.text();

    expect(body).toContain('"\'=HYPERLINK(""https://evil.example"")"');
    expect(body).toContain('"\' +SUM(1,1)"');
    expect(body).toContain('"\'-10% off"');
    expect(body).toContain('"\'@SUM(1+1)"');
  });

  it("returns account-scoped JSON for collection exports", async () => {
    setupMocks();
    const response = await loadExport("https://0509.io/export/collection/collection-1?format=json");
    const body = await response.json() as {
      resourceType: string;
      collection: CollectionRecord;
      insightDepth: { topHooks: Array<{ label: string; count: number }> };
      items: Array<{ advertiser: string; hook: string; tags: string[] }>;
    };

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.resourceType).toBe("collection");
    expect(body.collection.name).toBe("Beauty proof");
    expect(body.insightDepth.topHooks[0]).toMatchObject({
      label: "Routine-first bundle",
      count: 1,
    });
    expect(body.items[0]).toMatchObject({
      advertiser: "Nykaa",
      hook: "Routine-first bundle",
      tags: ["beauty", "offer"],
    });
  });

  it("includes manual external proof in collection API exports", async () => {
    setupMocks({ collectionItems: [externalCollectionItem] });
    const response = await loadExport("https://0509.io/export/collection/collection-1?format=json");
    const body = await response.json() as {
      insightDepth: {
        mediaMix: Array<{ label: string; count: number }>;
        campaignDurations: Array<{ label: string; count: number }>;
        metricProof: Array<{ label: string; detail: string }>;
      };
      items: Array<{
        advertiser: string;
        hook: string;
        adSnapshotUrl: string | null;
        landingPageUrl: string | null;
        proofUrl: string | null;
        metricProof: { spend: string; impressions: string; reach: string };
        tags: string[];
      }>;
    };

    expect(body.insightDepth.mediaMix[0]).toMatchObject({
      label: "LinkedIn",
      count: 1,
    });
    expect(body.items[0]).toMatchObject({
      advertiser: "Mamaearth",
      hook: "Creator-led sunscreen routine",
      adSnapshotUrl: null,
      landingPageUrl: null,
      proofUrl: "https://www.linkedin.com/posts/mamaearth-campaign",
      metricProof: {
        spend: "₹50k",
        impressions: "120k",
        reach: "80k",
      },
      tags: ["LinkedIn", "manual evidence", "creator"],
    });
    expect(body.insightDepth.metricProof[0]).toMatchObject({
      label: "Mamaearth",
      detail: "Spend: ₹50k | Impressions: 120k | Reach: 80k - LinkedIn",
    });
    expect(body.insightDepth.campaignDurations[0]).toMatchObject({
      label: "Pending",
      count: 0,
    });
  });

  it("includes manual metric proof in Slack-ready collection exports", async () => {
    const { isSlackDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
    vi.mocked(isSlackDeliveryCustomerFacing).mockReturnValue(true);
    setupMocks({ collectionItems: [externalCollectionItem] });
    const response = await loadExport("https://0509.io/export/collection/collection-1?format=slack");
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("_Metric evidence_");
    expect(body).toContain("Spend: ₹50k | Impressions: 120k | Reach: 80k - LinkedIn");
    expect(body).toContain("CTA: Shop now | Spend: ₹50k | Impressions: 120k | Reach: 80k | Evidence:");
  });

  it("returns Slack-ready markdown for watchlist exports", async () => {
    const { isSlackDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
    vi.mocked(isSlackDeliveryCustomerFacing).mockReturnValue(true);
    setupMocks();
    const response = await loadExport("https://0509.io/export/watchlist/watchlist-1?format=slack");
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("*Five to Nine watchlist: Nykaa watch*");
    expect(body).toContain("*Insight depth*");
    expect(body).toContain("_Landing-page history_");
    expect(body).toContain("Priority: Medium priority (84/100)");
    expect(body).toContain("Source status: Verified evidence");
    expect(body).toContain("Next move: Next review:");
    expect(body).toContain("Evidence: Verified from a page snapshot");
  });

  it("returns decision-ready CSV fields for watchlist exports", async () => {
    setupMocks({
      watchEvents: [
        {
          ...watchEvent,
          metadata: {
            sourceUrl: "javascript:alert(1)",
            proofUrl: "not a url",
            websiteUrl: "https://example.com/proof",
          },
        },
      ],
    });
    const response = await loadExport("https://0509.io/export/watchlist/watchlist-1");
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(body).toContain('"event_type","proof_status","source_type","title","summary","created_at","what_changed","why_it_matters","urgency","proof_status_label","source","last_seen","next_action","proof_trail","source_url"');
    expect(body).toContain('"landing_page_offer_changed","Verified evidence","Saved evidence","Landing page offer changed","The routine bundle offer changed.","2026-04-18T10:00:00.000Z","Landing page offer changed","The routine bundle offer changed.","Medium priority (84/100)"');
    expect(body).toContain('"https://example.com/proof"');
    expect(body).not.toContain("javascript:alert");
    expect(body).not.toContain("not a url");
  });

  it("excludes unsafe watch events from account-scoped watchlist JSON exports", async () => {
    setupMocks({
      watchEvents: [
        watchEvent,
        {
          ...watchEvent,
          id: "event-scan",
          proofCaptureId: null,
          metadata: { sourceStatus: "scan_backed" },
        },
        {
          ...watchEvent,
          id: "event-failed",
          status: "proof_failed",
          proofCaptureId: null,
          metadata: { sourceStatus: "proof_failed" },
        },
      ],
    });
    const response = await loadExport("https://0509.io/export/watchlist/watchlist-1?format=json");
    const body = await response.json() as {
      watchlist: Record<string, unknown>;
      sourceCoverage: { included: number; excluded: number };
      events: Array<Record<string, unknown>>;
    };

    expect(body.sourceCoverage).toMatchObject({ included: 1, excluded: 2 });
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      id: expect.stringMatching(/^watch_event_/),
      title: "Landing page offer changed",
      proofStatusLabel: "Verified evidence",
      sourceTypeLabel: "Saved evidence",
    });
    expect(body.events[0]).not.toHaveProperty("metadata");
    expect(body.watchlist).not.toHaveProperty("userId");
    expect(body.watchlist).not.toHaveProperty("targetFingerprint");
  });

  it("returns digest JSON with priority and proof trail intelligence", async () => {
    setupMocks();
    const response = await loadExport("https://0509.io/export/digest/digest-1?format=json");
    const body = await response.json() as {
      resourceType: string;
      insightDepth: { landingPageHistory: Array<{ detail: string }> };
      items: Array<{ intelligence: { priorityBand: string; recommendedAction: string; proofTrail: string } }>;
    };

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.resourceType).toBe("digest");
    expect(body.insightDepth.landingPageHistory[0]?.detail).toBe("The routine bundle offer changed.");
    expect(body.items[0]?.intelligence).toMatchObject({
      priorityBand: "High priority",
      recommendedAction: "Today: brief one counter-test.",
      proofTrail: "proof capture - source-backed - 18/4/2026",
    });
  });

  it("returns Slack-ready markdown for digest exports", async () => {
    const { isSlackDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
    vi.mocked(isSlackDeliveryCustomerFacing).mockReturnValue(true);
    setupMocks();
    const response = await loadExport("https://0509.io/export/digest/digest-1?format=slack");
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("*Five to Nine digest:");
    expect(body).toContain("*Insight depth*");
    expect(body).toContain("Nykaa watch: Landing page offer changed");
    expect(body).toContain("Next move: Today: brief one counter-test.");
    expect(body).toContain("Evidence: proof capture - source-backed - 18/4/2026");
  });

  it("returns decision-ready CSV fields for digest exports", async () => {
    setupMocks();
    const response = await loadExport("https://0509.io/export/digest/digest-1");
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(body).toContain('"watchlist","event_type","title","summary","what_changed","why_it_matters","urgency","proof_status","source","last_seen","next_action","proof_trail","source_url"');
    expect(body).toContain('"Nykaa watch","landing_page_offer_changed","Landing page offer changed","The routine bundle offer changed.","Landing page offer changed","The routine bundle offer changed.","High priority (90/100)"');
    expect(body).toContain('"Today: brief one counter-test.","proof capture - source-backed - 18/4/2026"');
  });

  it("falls back to safe source URLs for digest CSV exports", async () => {
    setupMocks({
      digest: {
        ...digest,
        items: [
          {
            ...digest.items[0],
            metadata: {
              ...digest.items[0].metadata,
              sourceUrl: "javascript:alert(1)",
              proofUrl: "not a url",
              websiteUrl: "https://example.com/direct-digest",
            },
          },
        ],
      },
    });
    const response = await loadExport("https://0509.io/export/digest/digest-1");
    const body = await response.text();

    expect(body).toContain('"https://example.com/direct-digest"');
    expect(body).not.toContain("javascript:alert");
    expect(body).not.toContain("not a url");
  });

  it("rejects Slack exports when GA surface is off", async () => {
    setupMocks();
    await expect(
      loadExport("https://0509.io/export/watchlist/watchlist-1?format=slack"),
    ).rejects.toMatchObject({ status: 403 });
  });
});
