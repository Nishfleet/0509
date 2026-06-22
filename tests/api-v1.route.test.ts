import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdRecord,
  CollectionItemRecord,
  CollectionRecord,
  DigestRecord,
  WatchEventRecord,
  WatchlistRecord,
} from "~/lib/types";
import {
  BROAD_WRITE_API_NON_GOAL,
  CUSTOMER_AGENT_ACTION_NAMES,
} from "~/lib/agent-action-catalog";

const EXPECTED_CUSTOMER_AGENT_ACTION_NAMES = [
  "source.meta.retest",
  "watchlist.create",
  "watchlist.update",
  "watchlist.refresh",
  "watchlist.pause",
  "watchlist.resume",
  "collection.create",
  "proof.add_external",
  "share.create",
  "report.create",
  "report.share",
  "counter_move_brief.create",
  "memory.upsert",
  "memory.list",
  "client_room.upsert",
  "client_room.list",
  "support_case.create",
  "support_case.list",
  "delivery_targets.list",
  "delivery_settings.update",
  "delivery_target.update",
  "web_mentions.list",
] as const;
const READ_ONLY_API_KEY_REQUIREMENT = "Works with any active customer API key.";
const WRITE_ENABLED_API_KEY_REQUIREMENT = "Requires a write-enabled customer API key.";

const apiKey = {
  id: "api-key-1",
  userId: "user-1",
  name: "Claude workflow",
  keyPrefix: fakeApiKey("abc123"),
  actionsWriteEnabled: true,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-06-06T00:00:00.000Z",
  updatedAt: "2026-06-06T00:00:00.000Z",
};

const readinessPayload = {
  status: "needs_setup",
  readyCount: 2,
  totalCount: 4,
  items: [
    {
      id: "delivery",
      label: "Delivery proof",
      status: "needs_proof",
      detail: "A delivery target exists but needs successful delivery proof.",
      action: { label: "Open sources", href: "/app/sources" },
    },
  ],
  counts: {
    competitors: 1,
    activeWatchlists: 1,
    successfulProofs: 0,
    sentDigests: 0,
    deliveryTargets: 1,
    activeApiKeys: 1,
    teamMembers: 0,
  },
};

function fakeApiKey(suffix: string) {
  return ["f9", "live", suffix].join("_");
}

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
  delivery: null,
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

function setupMocks(authOk = true, actionsWriteEnabled = true) {
  const mocks = {
    getCollection: vi.fn().mockResolvedValue(collection),
    getDigest: vi.fn().mockResolvedValue(digest),
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    listCollectionItems: vi.fn().mockResolvedValue([collectionItem]),
    listWatchEvents: vi.fn().mockResolvedValue([watchEvent]),
  };

  vi.doMock("~/lib/api-keys.server", () => ({
    authenticateApiKeyRequest: vi.fn().mockResolvedValue(
      authOk
        ? { ok: true, apiKey: { ...apiKey, actionsWriteEnabled } }
        : {
            ok: false,
            response: Response.json({ error: "invalid_api_key" }, { status: 401 }),
          },
    ),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => ({ DB: {} })),
  }));
  vi.doMock("~/lib/data.server", () => mocks);

  return mocks;
}

async function loadApi(url: string) {
  const { loader } = await import("~/routes/api.v1.$resourceType.$resourceId");
  const [, , , resourceType, resourceId] = new URL(url).pathname.split("/");
  return loader({
    context: { cloudflare: { env: { DB: {} } } },
    params: { resourceType, resourceId },
    request: new Request(url, {
      headers: {
        Authorization: `Bearer ${fakeApiKey("test")}`,
      },
    }),
  } as never);
}

async function loadReadinessApi(authOk = true) {
  setupMocks(authOk);
  const getWorkspaceReadiness = vi.fn().mockResolvedValue(readinessPayload);
  vi.doMock("~/lib/workspace-readiness.server", () => ({
    getWorkspaceReadiness,
  }));

  const { loader } = await import("~/routes/api.v1.workspace-readiness");
  const response = await loader({
    context: { cloudflare: { env: { DB: {} } } },
    request: new Request("https://0509.io/api/v1/workspace-readiness", {
      headers: {
        Authorization: `Bearer ${fakeApiKey("test")}`,
      },
    }),
  } as never);

  return { response, getWorkspaceReadiness };
}

async function postActionApi(
  body: Record<string, unknown>,
  options: {
    idempotencyKey?: string;
    authOk?: boolean;
    actionsWriteEnabled?: boolean;
  } = {},
) {
  setupMocks(options.authOk ?? true, options.actionsWriteEnabled ?? true);
  const { action } = await import("~/routes/api.v1.actions");
  return action({
    context: {
      cloudflare: {
        env: { DB: {} },
        ctx: {
          waitUntil: vi.fn(),
        },
      },
    },
    request: new Request("https://0509.io/api/v1/actions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fakeApiKey("test")}`,
        "Content-Type": "application/json",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    }),
  } as never);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("customer API v1", () => {
  it("documents the live API boundaries", async () => {
    const { loader } = await import("~/routes/api.v1");
    const response = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/api/v1"),
    } as never);
    const body = await response.json() as {
      endpoints: Array<{
        path: string;
        actions?: string[];
        requiresWriteEnabled: boolean;
        credentialRequirement: string;
      }>;
      agentActivation: {
        readinessEndpoint: string;
        firstWorkflow: Array<{ label: string }>;
        actionGroups: Array<{
          label: string;
          actions: string[];
          requiresWriteEnabled: boolean;
          credentialRequirement: string;
        }>;
        supportPaths: Array<{ label: string }>;
        blockedCapabilities: string[];
      };
      notLiveYet: string[];
    };

    expect(body.endpoints.map((endpoint) => endpoint.path)).toContain("/api/mcp");
    expect(body.endpoints.map((endpoint) => endpoint.path)).toContain("/api/v1/workspace-readiness");
    expect(body.endpoints.map((endpoint) => endpoint.path)).toContain("/api/v1/actions");
    expect(body.endpoints.map((endpoint) => endpoint.path)).toContain("/api/v1/watchlists/{watchlistId}");
    expect(CUSTOMER_AGENT_ACTION_NAMES).toEqual(EXPECTED_CUSTOMER_AGENT_ACTION_NAMES);
    const actionsEndpoint = body.endpoints.find((endpoint) => endpoint.path === "/api/v1/actions");
    expect(actionsEndpoint?.actions).toEqual(EXPECTED_CUSTOMER_AGENT_ACTION_NAMES);
    expect(actionsEndpoint).toMatchObject({
      requiresWriteEnabled: true,
      credentialRequirement: WRITE_ENABLED_API_KEY_REQUIREMENT,
    });
    body.endpoints
      .filter((endpoint) => endpoint.path !== "/api/v1/actions" && endpoint.path !== "/api/mcp")
      .forEach((endpoint) => {
        expect(endpoint).toMatchObject({
          requiresWriteEnabled: false,
          credentialRequirement: READ_ONLY_API_KEY_REQUIREMENT,
        });
      });
    expect(body.endpoints.find((endpoint) => endpoint.path === "/api/mcp")).toMatchObject({
      requiresWriteEnabled: false,
      credentialRequirement: expect.stringContaining(WRITE_ENABLED_API_KEY_REQUIREMENT),
    });
    expect(body.agentActivation.readinessEndpoint).toBe("/api/v1/workspace-readiness");
    expect(body.agentActivation.firstWorkflow.map((step) => step.label)).toContain("Check readiness");
    expect(body.agentActivation.actionGroups.map((group) => group.label)).toContain("Proof and reports");
    expect(body.agentActivation.actionGroups.every((group) => group.requiresWriteEnabled)).toBe(true);
    expect(body.agentActivation.actionGroups.every((group) => group.credentialRequirement.includes("write-enabled"))).toBe(true);
    expect(body.agentActivation.actionGroups.flatMap((group) => group.actions)).toEqual(EXPECTED_CUSTOMER_AGENT_ACTION_NAMES);
    expect(body.agentActivation.actionGroups.flatMap((group) => group.actions)).not.toContain("get_workspace_readiness");
    expect(body.agentActivation.supportPaths.map((path) => path.label)).toContain("Billing changes and cancellation");
    expect(body.agentActivation.blockedCapabilities).toContain("billing changes");
    expect(body.agentActivation.blockedCapabilities).toContain("team invites");
    expect(body.agentActivation.blockedCapabilities).toContain("customer API key creation, rotation, and revocation");
    expect(body.notLiveYet).not.toContain("MCP server");
    expect(body.notLiveYet).toContain("TikTok ingestion");
    expect(body.notLiveYet).toContain(BROAD_WRITE_API_NON_GOAL);
    expect(body.notLiveYet).not.toContain("billing changes");
    expect(body.notLiveYet).not.toContain("team invites");
  });

  it("returns account-scoped workspace readiness by API key", async () => {
    const { response, getWorkspaceReadiness } = await loadReadinessApi();
    const body = await response.json();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "needs_setup",
      items: [
        {
          id: "delivery",
          status: "needs_proof",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("encryptedWebhookUrl");
    expect(getWorkspaceReadiness).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("returns account-scoped collection JSON by API key", async () => {
    const mocks = setupMocks();
    const response = await loadApi("https://0509.io/api/v1/collections/collection-1?format=json");
    const body = await response.json() as {
      resourceType: string;
      insightDepth: { topHooks: Array<{ label: string }> };
      items: Array<{ advertiser: string }>;
    };

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.resourceType).toBe("collection");
    expect(body.items[0]?.advertiser).toBe("Nykaa");
    expect(body.insightDepth.topHooks[0]?.label).toBe("Routine-first bundle");
    expect(mocks.getCollection).toHaveBeenCalledWith(expect.anything(), "collection-1", "user-1");
  });

  it("returns Slack-ready markdown by API key", async () => {
    setupMocks();
    const response = await loadApi("https://0509.io/api/v1/watchlists/watchlist-1?format=slack");
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("*Five to Nine watchlist: Nykaa watch*");
    expect(body).toContain("*Insight depth*");
    expect(body).toContain("Next move:");
  });

  it("runs audited watchlist actions by API key", async () => {
    const runCustomerAgentAction = vi.fn().mockResolvedValue({
      audit: {
        id: "audit-1",
        status: "succeeded",
      },
      replayed: false,
      result: {
        ok: true,
        action: "watchlist.pause",
        watchlist: {
          id: "watchlist-1",
          isActive: false,
        },
      },
    });
    vi.doMock("~/lib/customer-agent-actions.server", () => ({
      customerAgentActionErrorPayload: vi.fn(),
      normalizeCustomerAgentActionName: vi.fn((value: string | null) =>
        value === "watchlist.pause" ? "watchlist.pause" : null,
      ),
      runCustomerAgentAction,
    }));

    const response = await postActionApi(
      {
        action: "watchlist.pause",
        input: {
          watchlistId: "watchlist-1",
        },
      },
      {
        idempotencyKey: "pause-watchlist-1",
      },
    );
    const body = await response.json() as {
      replayed: boolean;
      result: { watchlist: { isActive: boolean } };
    };

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.replayed).toBe(false);
    expect(body.result.watchlist.isActive).toBe(false);
    expect(runCustomerAgentAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "pause-watchlist-1",
        source: "api_v1",
      }),
      "watchlist.pause",
      {
        watchlistId: "watchlist-1",
      },
    );
  });

  it("rejects audited actions from read-only API keys", async () => {
    const response = await postActionApi(
      {
        action: "watchlist.pause",
        input: {
          watchlistId: "watchlist-1",
          idempotencyKey: "pause-watchlist-1",
        },
      },
      {
        actionsWriteEnabled: false,
      },
    );
    const body = await response.json() as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe("actions_write_not_enabled");
  });

  it("returns action errors with the mapped status code", async () => {
    vi.doMock("~/lib/customer-agent-actions.server", () => ({
      customerAgentActionErrorPayload: vi.fn(() => ({
        status: 402,
        body: {
          ok: false,
          error: "plan_limit_exceeded",
          message: "You have reached your competitor tracking limit.",
        },
      })),
      normalizeCustomerAgentActionName: vi.fn((value: string | null) =>
        value === "watchlist.resume" ? "watchlist.resume" : null,
      ),
      runCustomerAgentAction: vi.fn().mockRejectedValue(new Error("limit")),
    }));

    const response = await postActionApi({
      action: "watchlist.resume",
      input: {
        watchlistId: "watchlist-1",
      },
    });

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "plan_limit_exceeded",
    });
  });

  it("rejects requests without an active API key", async () => {
    setupMocks(false);
    const response = await loadApi("https://0509.io/api/v1/collections/collection-1");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_api_key" });
  });

  it("rejects readiness requests without an active API key", async () => {
    const { response, getWorkspaceReadiness } = await loadReadinessApi(false);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_api_key" });
    expect(getWorkspaceReadiness).not.toHaveBeenCalled();
  });

  it("does not expose another user's digest", async () => {
    const mocks = setupMocks();
    mocks.getDigest.mockResolvedValue({ ...digest, userId: "other-user" });
    const response = await loadApi("https://0509.io/api/v1/digests/digest-1");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "not_found" });
  });
});
