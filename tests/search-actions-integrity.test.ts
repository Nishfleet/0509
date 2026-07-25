import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-07-01T00:00:00.000Z",
  },
  session: { id: "session-1", userId: "user-1", expiresAt: "2027-01-01T00:00:00.000Z" },
};

const canonicalAd = {
  metaAdId: "ad-canonical",
  advertiser: "Nykaa",
  body: "Canonical body",
  previewHeadline: "Canonical headline",
  previewSubhead: "",
  hook: "Canonical hook",
  offer: "Canonical offer",
  cta: "Shop now",
  format: "image" as const,
  languageLabel: "English",
  destinationType: "website" as const,
  landingPageUrl: "https://nykaa.com/sale",
  adSnapshotUrl: null,
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: null,
  lastSeenAt: null,
  active: true,
  researchSummary: "Canonical summary",
  source: "meta_library_browser" as const,
  analysisFields: [],
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function installMocks(
  listAdsByIds: ReturnType<typeof vi.fn>,
  addAdToCollection: ReturnType<typeof vi.fn>,
  getUserPlan: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue("starter"),
) {
  const env = { DB: {} };
  vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn().mockResolvedValue({
      session,
      workspaceUserId: "user-1",
      isMember: false,
      ownerName: null,
    }),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan,
  }));
  vi.doMock("~/lib/data.server", () => ({
    addAdToCollection,
    createSavedQuery: vi.fn(),
    listAdsByIds,
  }));
  return env;
}

describe("search collection integrity", () => {
  it("saves the canonical server record instead of client-supplied ad JSON", async () => {
    const listAdsByIds = vi.fn().mockResolvedValue([canonicalAd]);
    const addAdToCollection = vi.fn().mockResolvedValue(undefined);
    const env = installMocks(listAdsByIds, addAdToCollection);
    const { action } = await import("~/routes/search");
    const body = new FormData();
    body.set("intent", "save-to-collection");
    body.set("collectionId", "collection-1");
    body.set("adId", canonicalAd.metaAdId);
    body.set("adJson", JSON.stringify({ ...canonicalAd, body: "forged" }));

    const result = await action({
      context: { cloudflare: { env } },
      request: new Request("https://0509.io/search", { method: "POST", body }),
    } as never);

    expect(listAdsByIds).toHaveBeenCalledWith(env, [canonicalAd.metaAdId]);
    expect(addAdToCollection).toHaveBeenCalledWith(
      env,
      "user-1",
      "collection-1",
      canonicalAd,
      null,
      [],
    );
    expect(result).toEqual({ ok: true, message: "Saved Nykaa to your collection." });
  });

  it("returns a recovery message when the canonical ad is missing", async () => {
    const listAdsByIds = vi.fn().mockResolvedValue([]);
    const addAdToCollection = vi.fn();
    const env = installMocks(listAdsByIds, addAdToCollection);
    const { action } = await import("~/routes/search");
    const body = new FormData();
    body.set("intent", "save-to-collection");
    body.set("collectionId", "collection-1");
    body.set("adId", "missing");

    const result = await action({
      context: { cloudflare: { env } },
      request: new Request("https://0509.io/search", { method: "POST", body }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "That ad is no longer available to save. Select it again and retry.",
    });
    expect(addAdToCollection).not.toHaveBeenCalled();
  });

  it("rejects free-plan saves server-side even when the POST bypasses the UI gate", async () => {
    const listAdsByIds = vi.fn().mockResolvedValue([canonicalAd]);
    const addAdToCollection = vi.fn();
    const env = installMocks(listAdsByIds, addAdToCollection, vi.fn().mockResolvedValue("free"));
    const { action } = await import("~/routes/search");
    const body = new FormData();
    body.set("intent", "save-to-collection");
    body.set("collectionId", "collection-1");
    body.set("adId", canonicalAd.metaAdId);

    const result = await action({
      context: { cloudflare: { env } },
      request: new Request("https://0509.io/search", { method: "POST", body }),
    } as never);

    expect(result).toEqual({
      ok: false,
      error: "plan_limit_exceeded",
      message: "Upgrade to Scout to save ads and build your workspace memory.",
      upgradePath: "/app/billing?source=search#plans",
    });
    expect(addAdToCollection).not.toHaveBeenCalled();
    expect(listAdsByIds).not.toHaveBeenCalled();
  });

  it("fails closed with a retryable error when the plan lookup itself fails", async () => {
    const listAdsByIds = vi.fn().mockResolvedValue([canonicalAd]);
    const addAdToCollection = vi.fn();
    // First lookup (withWorkspace route guard) succeeds; the save gate's own
    // lookup then fails, which must reject the save rather than fail open.
    const env = installMocks(
      listAdsByIds,
      addAdToCollection,
      vi.fn().mockResolvedValueOnce("starter").mockRejectedValue(new Error("D1 down")),
    );
    const { action } = await import("~/routes/search");
    const body = new FormData();
    body.set("intent", "save-to-collection");
    body.set("collectionId", "collection-1");
    body.set("adId", canonicalAd.metaAdId);

    const result = await action({
      context: { cloudflare: { env } },
      request: new Request("https://0509.io/search", { method: "POST", body }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "We couldn't confirm your plan just now. Nothing was saved — try again in a moment.",
    });
    expect(addAdToCollection).not.toHaveBeenCalled();
  });

  it("does not expose private external evidence through the global ad lookup", async () => {
    const listAdsByIds = vi.fn().mockResolvedValue([{
      ...canonicalAd,
      metaAdId: "external:linkedin:predictable",
      source: "external",
      analysisFields: [{
        scopeType: "ad",
        fieldKey: "spend",
        fieldValue: "private spend",
        provenanceSource: "user",
        extractorVersion: "manual-external-proof-v1",
      }],
    }]);
    const addAdToCollection = vi.fn();
    const env = installMocks(listAdsByIds, addAdToCollection);
    const { action } = await import("~/routes/search");
    const body = new FormData();
    body.set("intent", "save-to-collection");
    body.set("collectionId", "collection-1");
    body.set("adId", "external:linkedin:predictable");

    const result = await action({
      context: { cloudflare: { env } },
      request: new Request("https://0509.io/search", { method: "POST", body }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "That result is not public Meta Ad Library evidence. Select a live ad result and retry.",
    });
    expect(addAdToCollection).not.toHaveBeenCalled();
  });
});
