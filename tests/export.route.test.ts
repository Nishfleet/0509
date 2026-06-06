import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdRecord,
  CollectionItemRecord,
  CollectionRecord,
  DigestRecord,
  WatchEventRecord,
  WatchlistRecord,
} from "~/lib/types";

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

const watchlist: WatchlistRecord = {
  id: "watchlist-1",
  userId: "user-1",
  name: "Nykaa watch",
  targetType: "advertiser",
  targetId: "nykaa",
  targetFingerprint: "fp-nykaa",
  targetLabel: "Nykaa",
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

function setupMocks() {
  const env = { DB: {} };
  vi.doMock("~/lib/auth.server", () => ({
    requireSession: vi.fn().mockResolvedValue(session),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/lib/data.server", () => ({
    getCollection: vi.fn().mockResolvedValue(collection),
    getDigest: vi.fn().mockResolvedValue(digest),
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    listCollectionItems: vi.fn().mockResolvedValue([collectionItem]),
    listWatchEvents: vi.fn().mockResolvedValue([watchEvent]),
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

beforeEach(() => {
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
    const response = await loadExport("https://0509.in/export/collection/collection-1");
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain('"advertiser","hook","offer","cta","tags","note"');
    expect(body).toContain('"Nykaa","Routine-first bundle","Bundle and save","Build your routine","beauty|offer","Use in sales deck."');
  });

  it("returns account-scoped JSON for collection exports", async () => {
    setupMocks();
    const response = await loadExport("https://0509.in/export/collection/collection-1?format=json");
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

  it("returns Slack-ready markdown for watchlist exports", async () => {
    setupMocks();
    const response = await loadExport("https://0509.in/export/watchlist/watchlist-1?format=slack");
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("*Five to Nine watchlist: Nykaa watch*");
    expect(body).toContain("*Insight depth*");
    expect(body).toContain("_Landing-page history_");
    expect(body).toContain("Priority: Medium priority (84/100)");
    expect(body).toContain("Next move: Next review:");
    expect(body).toContain("Evidence: proof capture");
  });

  it("returns digest JSON with priority and proof trail intelligence", async () => {
    setupMocks();
    const response = await loadExport("https://0509.in/export/digest/digest-1?format=json");
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
    setupMocks();
    const response = await loadExport("https://0509.in/export/digest/digest-1?format=slack");
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("*Five to Nine digest:");
    expect(body).toContain("*Insight depth*");
    expect(body).toContain("Nykaa watch: Landing page offer changed");
    expect(body).toContain("Next move: Today: brief one counter-test.");
    expect(body).toContain("Evidence: proof capture - source-backed - 18/4/2026");
  });
});
