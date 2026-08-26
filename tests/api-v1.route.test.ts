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
import { encodeListCursor } from "~/lib/list-pagination";
import { mockAgencyWorkspacePlan } from "./helpers/agency-plan-mock";

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
const READ_ONLY_API_KEY_REQUIREMENT = "Requires an active Agency customer API key.";
const WRITE_ENABLED_API_KEY_REQUIREMENT = "Requires a write-enabled Agency customer API key.";

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
      action: { label: "Open notifications", href: "/app/notifications" },
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

function setupMocks(
  authOk = true,
  actionsWriteEnabled = true,
  workspaceUserId = apiKey.userId,
  workspacePlan: "agency" | "starter" = "agency",
) {
  if (workspacePlan === "agency") {
    mockAgencyWorkspacePlan();
  } else {
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      getEffectiveWorkspacePlan: vi.fn().mockResolvedValue("starter"),
      getUserPlanForActor: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit: vi.fn().mockResolvedValue({ allowed: true, limit: 10, current: 1 }),
      PLAN_LIMITS: {
        starter: { digests: true },
      },
    }));
  }
  const isMemberWorkspace = workspaceUserId !== apiKey.userId;
  const mocks = {
    findAgentActionAuditByIdempotencyKey: vi.fn().mockResolvedValue(null),
    claimAgentActionAudit: vi.fn().mockResolvedValue({
      claimed: true,
      audit: {
        id: "audit-1",
        userId: "user-1",
        apiKeyId: "api-key-1",
        actionName: "delivery_settings.update",
        resourceType: null,
        resourceId: null,
        idempotencyKey: "delivery-settings-whatsapp",
        status: "claimed",
        metadata: {},
        result: null,
        errorCode: null,
        errorMessage: null,
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      },
    }),
    reclaimRetryableAgentActionAudit: vi.fn().mockResolvedValue(null),
    finishAgentActionAudit: vi.fn().mockResolvedValue(null),
    getCollection: vi.fn().mockResolvedValue(collection),
    getDigest: vi.fn().mockResolvedValue(digest),
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    listCollectionItems: vi.fn().mockResolvedValue([collectionItem]),
    listWatchEvents: vi.fn().mockResolvedValue([watchEvent]),
    listCollectionItemsPage: vi.fn().mockResolvedValue({
      items: [collectionItem],
      nextCursor: null,
    }),
    listWatchEventsPage: vi.fn().mockResolvedValue({
      items: [watchEvent],
      nextCursor: null,
    }),
    isActiveCustomerApiKey: vi.fn().mockResolvedValue(true),
    enforceAuthenticatedApiLimit: vi.fn().mockResolvedValue(null),
    verifyAuthenticatedApiIdentity: vi.fn().mockResolvedValue(null),
    createAuthenticatedApiLimitContext: vi.fn((env, identity) => ({
      identity,
      isIdentityActive: () => mocks.isActiveCustomerApiKey(env, {
        apiKeyId: identity.apiKeyId,
        userId: identity.actorUserId,
      }),
    })),
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
  vi.doMock("~/lib/authenticated-api-limits.server", () => ({
    enforceAuthenticatedApiLimit: mocks.enforceAuthenticatedApiLimit,
    verifyAuthenticatedApiIdentity: mocks.verifyAuthenticatedApiIdentity,
    createAuthenticatedApiLimitContext: mocks.createAuthenticatedApiLimitContext,
  }));
  vi.doMock("~/lib/workspace.server", () => ({
    resolveWorkspace: vi.fn().mockResolvedValue({
      workspaceUserId,
      isMember: isMemberWorkspace,
      ownerName: isMemberWorkspace ? "Owner User" : null,
    }),
    resolveWorkspaceDataUserId: vi.fn().mockResolvedValue(workspaceUserId),
  }));

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

async function loadReadinessApi(authOk = true, workspaceUserId = apiKey.userId) {
  setupMocks(authOk, true, workspaceUserId);
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
      planRequirement: string;
      endpoints: Array<{
        path: string;
        formats: string[];
        actions?: string[];
        planRequirement: string;
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
      toolActivation: {
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

    expect(body.planRequirement).toBe("Agency");
    expect(body.endpoints.map((endpoint) => endpoint.path)).toContain("/api/mcp");
    expect(body.endpoints.map((endpoint) => endpoint.path)).toContain("/api/v1/workspace-readiness");
    expect(body.endpoints.map((endpoint) => endpoint.path)).toContain("/api/v1/actions");
    expect(body.endpoints.map((endpoint) => endpoint.path)).toContain("/api/v1/watchlists/{watchlistId}");
    expect(CUSTOMER_AGENT_ACTION_NAMES).toEqual(EXPECTED_CUSTOMER_AGENT_ACTION_NAMES);
    const actionsEndpoint = body.endpoints.find((endpoint) => endpoint.path === "/api/v1/actions");
    expect(actionsEndpoint?.actions).toEqual(EXPECTED_CUSTOMER_AGENT_ACTION_NAMES);
    expect(actionsEndpoint).toMatchObject({
      planRequirement: "Agency",
      requiresWriteEnabled: true,
      credentialRequirement: WRITE_ENABLED_API_KEY_REQUIREMENT,
    });
    body.endpoints.forEach((endpoint) => {
      expect(endpoint.planRequirement).toBe("Agency");
      expect(endpoint.credentialRequirement).not.toContain("any active customer API key");
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
    body.endpoints
      .filter((endpoint) => endpoint.path.includes("{"))
      .forEach((endpoint) => {
        expect(endpoint.formats).toEqual(["json", "csv"]);
        expect(endpoint.formats).not.toContain("slack");
      });
    expect(body.agentActivation).toEqual(body.toolActivation);
    expect(body.toolActivation.readinessEndpoint).toBe("/api/v1/workspace-readiness");
    expect(body.toolActivation.firstWorkflow.map((step) => step.label)).toContain("Check readiness");
    expect(body.toolActivation.actionGroups.map((group) => group.label)).toContain("Evidence and reports");
    expect(body.toolActivation.actionGroups.every((group) => group.requiresWriteEnabled)).toBe(true);
    expect(body.toolActivation.actionGroups.every((group) => group.credentialRequirement.includes("write-enabled"))).toBe(true);
    expect(body.toolActivation.actionGroups.flatMap((group) => group.actions)).toEqual(EXPECTED_CUSTOMER_AGENT_ACTION_NAMES);
    expect(body.toolActivation.actionGroups.flatMap((group) => group.actions)).not.toContain("get_workspace_readiness");
    expect(body.toolActivation.supportPaths.map((path) => path.label)).toContain("Billing changes and cancellation");
    expect(body.toolActivation.blockedCapabilities).toContain("billing changes");
    expect(body.toolActivation.blockedCapabilities).toContain("team invites");
    expect(body.toolActivation.blockedCapabilities).toContain("customer API key creation, rotation, and revocation");
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
    expect(getWorkspaceReadiness).toHaveBeenCalledWith(expect.anything(), "user-1", {
      isMember: false,
      billingOwnerName: null,
      canManageBilling: true,
    });
  });

  it("gates workspace readiness to Agency API access", async () => {
    setupMocks(true, true, apiKey.userId, "starter");
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
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      error: "plan_gated",
      feature: "api_access",
      plan: "starter",
    });
    expect(getWorkspaceReadiness).not.toHaveBeenCalled();
  });

  it("returns workspace-owner readiness for a member API key", async () => {
    const { getWorkspaceReadiness } = await loadReadinessApi(true, "owner-1");

    expect(getWorkspaceReadiness).toHaveBeenCalledWith(expect.anything(), "owner-1", {
      isMember: true,
      billingOwnerName: "Owner User",
      canManageBilling: false,
    });
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
    expect(body).not.toHaveProperty("pagination");
    expect(mocks.getCollection).toHaveBeenCalledWith(expect.anything(), "collection-1", "user-1");
    expect(mocks.listCollectionItems).toHaveBeenCalledWith(expect.anything(), "collection-1");
    expect(mocks.listCollectionItemsPage).not.toHaveBeenCalled();
  });

  it("preserves legacy no-query export cardinality above one hundred records", async () => {
    const mocks = setupMocks();
    mocks.listCollectionItems.mockResolvedValue(
      Array.from({ length: 150 }, (_, index) => ({
        ...collectionItem,
        id: `item-${index + 1}`,
      })),
    );
    mocks.listWatchEvents.mockResolvedValue(
      Array.from({ length: 180 }, (_, index) => ({
        ...watchEvent,
        id: `event-${index + 1}`,
      })),
    );

    const collectionResponse = await loadApi("https://0509.io/api/v1/collections/collection-1?format=json");
    const watchlistResponse = await loadApi("https://0509.io/api/v1/watchlists/watchlist-1?format=json");
    const collectionBody = await collectionResponse.json() as { items: unknown[] };
    const watchlistBody = await watchlistResponse.json() as { events: unknown[] };

    expect(collectionBody.items).toHaveLength(150);
    expect(watchlistBody.events).toHaveLength(180);
    expect(mocks.listCollectionItems).toHaveBeenCalledWith(expect.anything(), "collection-1");
    expect(mocks.listWatchEvents).toHaveBeenCalledWith(expect.anything(), "watchlist-1", 200);
    expect(mocks.listCollectionItemsPage).not.toHaveBeenCalled();
    expect(mocks.listWatchEventsPage).not.toHaveBeenCalled();
  });

  it("returns bounded cursor pagination for collection exports", async () => {
    const mocks = setupMocks();
    const cursor = encodeListCursor("2026-04-18T00:00:00.000Z", "item-1");
    mocks.listCollectionItemsPage.mockResolvedValue({
      items: [collectionItem],
      nextCursor: "next-cursor",
    });

    const response = await loadApi(
      `https://0509.io/api/v1/collections/collection-1?format=json&limit=25&cursor=${encodeURIComponent(cursor)}`,
    );
    const body = await response.json() as { pagination: { limit: number; nextCursor: string | null } };

    expect(mocks.listCollectionItemsPage).toHaveBeenCalledWith(
      expect.anything(),
      "collection-1",
      { limit: 25, cursor },
    );
    expect(body.pagination).toEqual({ limit: 25, nextCursor: "next-cursor" });
    expect(response.headers.get("x-0509-next-cursor")).toBe("next-cursor");
  });

  it("authorizes a member API export against the workspace owner", async () => {
    const mocks = setupMocks(true, true, "owner-1");
    const response = await loadApi("https://0509.io/api/v1/collections/collection-1?format=json");

    expect(response.status).toBe(200);
    expect(mocks.getCollection).toHaveBeenCalledWith(
      expect.anything(),
      "collection-1",
      "owner-1",
    );
  });

  it("enforces read limits after authentication across workspace, actor, and key identity", async () => {
    const mocks = setupMocks(true, true, "owner-1");
    mocks.enforceAuthenticatedApiLimit.mockResolvedValue(
      Response.json({ error: "rate_limited" }, { status: 429 }),
    );
    const response = await loadApi("https://0509.io/api/v1/collections/collection-1?format=json");

    expect(response.status).toBe(429);
    expect(mocks.enforceAuthenticatedApiLimit).toHaveBeenCalledWith(expect.objectContaining({
      identity: {
        workspaceUserId: "owner-1",
        actorUserId: "user-1",
        apiKeyId: "api-key-1",
      },
      operation: "api.v1.resource.read",
      actionClass: "read",
      isIdentityActive: expect.any(Function),
    }));
    expect(mocks.getCollection).not.toHaveBeenCalled();
  });

  it("rejects forged Slack export requests by API key", async () => {
    setupMocks();
    const response = await loadApi("https://0509.io/api/v1/watchlists/watchlist-1?format=slack");
    const body = await response.json() as {
      error: string;
      message: string;
    };

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: "slack_export_unavailable",
      message: "Slack delivery isn’t available. Nothing was saved — use email delivery instead.",
    });
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
        authorizeExternalEffect: expect.any(Function),
      }),
      "watchlist.pause",
      {
        watchlistId: "watchlist-1",
      },
    );
  });

  it("applies the stricter action policy before an API write runs", async () => {
    const mocks = setupMocks();
    mocks.enforceAuthenticatedApiLimit.mockResolvedValue(
      Response.json(
        { error: "rate_limited", message: "Too many authenticated requests. Please try again shortly." },
        { status: 429, headers: { "Retry-After": "19" } },
      ),
    );
    const runCustomerAgentAction = vi.fn();
    vi.doMock("~/lib/customer-agent-actions.server", () => ({
      customerAgentActionErrorPayload: vi.fn(),
      normalizeCustomerAgentActionName: vi.fn(() => "watchlist.refresh"),
      runCustomerAgentAction,
    }));

    const { action } = await import("~/routes/api.v1.actions");
    const response = await action({
      context: { cloudflare: { env: { DB: {} }, ctx: { waitUntil: vi.fn() } } },
      request: new Request("https://0509.io/api/v1/actions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fakeApiKey("test")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "watchlist.refresh",
          input: { watchlistId: "watchlist-1" },
        }),
      }),
    } as never);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("19");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "rate_limited",
      message: "Too many authenticated requests. Please try again shortly.",
      retryAfterSeconds: 19,
    });
    expect(mocks.enforceAuthenticatedApiLimit).toHaveBeenCalledWith(expect.objectContaining({
      actionName: "watchlist.refresh",
      operation: "api.v1.actions",
    }));
    expect(mocks.enforceAuthenticatedApiLimit).toHaveBeenCalledTimes(1);
    expect(runCustomerAgentAction).not.toHaveBeenCalled();
  });

  it("rejects oversized action payloads before parsing or dispatch", async () => {
    setupMocks();
    const { action } = await import("~/routes/api.v1.actions");
    const response = await action({
      context: { cloudflare: { env: { DB: {} } } },
      request: new Request("https://0509.io/api/v1/actions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fakeApiKey("test")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "watchlist.pause", detail: "x".repeat(70_000) }),
      }),
    } as never);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "request_too_large" });
  });

  it("rejects forged WhatsApp delivery settings by API key", async () => {
    vi.doUnmock("~/lib/customer-agent-actions.server");
    const mocks = setupMocks();
    const { action } = await import("~/routes/api.v1.actions");
    const response = await action({
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
          "Idempotency-Key": "delivery-settings-whatsapp",
        },
        body: JSON.stringify({
          action: "delivery_settings.update",
          input: {
            watchlistId: "watchlist-1",
            explicitApproval: true,
            whatsappEnabled: true,
            idempotencyKey: "delivery-settings-whatsapp",
          },
        }),
      }),
    } as never);

    const body = await response.json();
    expect(response.status, JSON.stringify({
      body,
      finishCalls: mocks.finishAgentActionAudit.mock.calls,
    })).toBe(403);
    expect(body).toMatchObject({
      ok: false,
      error: "whatsapp_delivery_unavailable",
      message: "WhatsApp delivery isn’t available. Nothing was saved — use email delivery instead.",
    });
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
          message: "You've reached your competitor tracking limit.",
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
