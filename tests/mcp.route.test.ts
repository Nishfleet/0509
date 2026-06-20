import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdRecord,
  CollectionItemRecord,
  CollectionRecord,
  DigestRecord,
  WatchEventRecord,
  WatchlistRecord,
} from "~/lib/types";

const apiKey = {
  id: "api-key-1",
  userId: "user-1",
  name: "Agent workflow",
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
  const getWorkspaceReadiness = vi.fn().mockResolvedValue(readinessPayload);
  const audit = {
    id: "audit-1",
    userId: "user-1",
    apiKeyId: "api-key-1",
    actionName: "source.meta.retest",
    resourceType: null,
    resourceId: null,
    idempotencyKey: "retest-source-1",
    status: "started",
    result: null,
    errorCode: null,
    errorMessage: null,
    metadata: {},
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
  const mocks = {
    getCollection: vi.fn().mockResolvedValue(collection),
    getDigest: vi.fn().mockResolvedValue(digest),
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    listAdsByIds: vi.fn().mockResolvedValue([ad]),
    listAgentMemory: vi.fn().mockResolvedValue([]),
    listCollectionItems: vi.fn().mockResolvedValue([collectionItem]),
    listWatchEvents: vi.fn().mockResolvedValue([watchEvent]),
    findAgentActionAuditByIdempotencyKey: vi.fn().mockResolvedValue(null),
    claimAgentActionAudit: vi.fn().mockResolvedValue({
      audit,
      claimed: true,
    }),
    finishAgentActionAudit: vi.fn().mockImplementation((_env, auditId: string, input: Record<string, unknown>) =>
      Promise.resolve({
        ...audit,
        id: auditId,
        status: input.status,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        result: input.result ?? null,
        metadata: input.metadata ?? {},
      })
    ),
    getWorkspaceReadiness,
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
  vi.doMock("~/lib/workspace-readiness.server", () => ({
    getWorkspaceReadiness,
  }));

  return mocks;
}

async function postMcp(body: Record<string, unknown>) {
  const { action } = await import("~/routes/api.mcp");
  return action({
    context: {
      cloudflare: {
        env: { DB: {} },
        ctx: {
          waitUntil: vi.fn(),
        },
      },
    },
    request: new Request("https://0509.io/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fakeApiKey("test")}`,
        "Content-Type": "application/json",
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

describe("MCP route", () => {
  it("rejects unsupported MCP SSE stream probes on the POST-only endpoint", async () => {
    const { loader } = await import("~/routes/api.mcp");
    const response = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/api/mcp", {
        headers: {
          Accept: "text/event-stream",
        },
      }),
    } as never);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("supports MCP initialize and tool discovery", async () => {
    setupMocks();
    const initialize = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-agent", version: "1.0.0" },
      },
    });
    const initialized = await initialize.json() as {
      result: {
        protocolVersion: string;
        capabilities: { tools: { listChanged: boolean } };
        instructions: string;
      };
    };

    expect(initialize.headers.get("mcp-protocol-version")).toBe("2025-06-18");
    expect(initialized.result.protocolVersion).toBe("2025-06-18");
    expect(initialized.result.capabilities.tools.listChanged).toBe(false);
    expect(initialized.result.instructions).toContain("customer API key creation, rotation, and revocation");

    const tools = await postMcp({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const body = await tools.json() as {
      result: {
        tools: Array<{
          name: string;
          inputSchema: {
            properties?: Record<string, unknown>;
            required?: string[];
            not?: Record<string, unknown>;
          };
          annotations: { readOnlyHint: boolean };
          requiresWriteEnabled: boolean;
          credentialRequirement: string;
        }>;
      };
    };

    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "get_workspace_readiness",
      "get_collection_export",
      "get_watchlist_export",
      "get_digest_export",
      "retest_meta_source",
      "create_watchlist",
      "update_watchlist",
      "refresh_watchlist",
      "pause_watchlist",
      "resume_watchlist",
      "create_collection",
      "add_external_proof",
      "list_delivery_targets",
      "update_delivery_settings",
      "update_delivery_target",
      "create_share_link",
      "create_report",
      "share_report",
      "create_counter_move_brief",
      "upsert_memory",
      "list_memory",
      "upsert_client_room",
      "list_client_rooms",
      "list_web_mentions",
    ]);
    expect(body.result.tools[0]?.annotations.readOnlyHint).toBe(true);
    expect(body.result.tools[0]).toMatchObject({
      requiresWriteEnabled: false,
      credentialRequirement: "Works with any active customer API key.",
    });
    expect(body.result.tools.find((tool) => tool.name === "create_watchlist")).toMatchObject({
      annotations: { readOnlyHint: false },
      requiresWriteEnabled: true,
      credentialRequirement: "Requires a write-enabled customer API key.",
    });
    const updateWatchlistSchema = body.result.tools.find((tool) => tool.name === "update_watchlist")?.inputSchema;
    expect(updateWatchlistSchema).toMatchObject({
      required: ["watchlistId", "idempotencyKey"],
    });
    const counterMoveSchema = body.result.tools.find((tool) => tool.name === "create_counter_move_brief")?.inputSchema;
    expect(counterMoveSchema).toMatchObject({
      required: ["watchlistId", "idempotencyKey"],
      properties: {
        ownerLabel: { type: "string" },
        followUpChannel: { type: "string", enum: ["app", "email", "slack", "client_room"] },
        expiryDays: { type: "number", minimum: 1, maximum: 30 },
      },
    });
    const listMemorySchema = body.result.tools.find((tool) => tool.name === "list_memory")?.inputSchema;
    expect(listMemorySchema).toMatchObject({
      properties: {
        watchlistId: { type: "string" },
        clientRoomId: { type: "string" },
      },
      not: { required: ["watchlistId", "clientRoomId"] },
    });
    expect(listMemorySchema?.properties).not.toHaveProperty("idempotencyKey");
    expect(body.result.tools.find((tool) => tool.name === "list_client_rooms")?.inputSchema.properties).not.toHaveProperty("idempotencyKey");
  });

  it("hides write tools for read-only API keys", async () => {
    setupMocks(true, false);
    const tools = await postMcp({
      jsonrpc: "2.0",
      id: "tools-read-only",
      method: "tools/list",
      params: {},
    });
    const body = await tools.json() as {
      result: {
        tools: Array<{
          name: string;
          requiresWriteEnabled: boolean;
          credentialRequirement: string;
        }>;
      };
    };

    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "get_workspace_readiness",
      "get_collection_export",
      "get_watchlist_export",
      "get_digest_export",
    ]);
    expect(body.result.tools.every((tool) => !tool.requiresWriteEnabled)).toBe(true);
    expect(body.result.tools.every((tool) => tool.credentialRequirement === "Works with any active customer API key.")).toBe(true);
  });

  it("returns workspace readiness through tools/call", async () => {
    const mocks = setupMocks();
    const response = await postMcp({
      jsonrpc: "2.0",
      id: "readiness-1",
      method: "tools/call",
      params: {
        name: "get_workspace_readiness",
      },
    });
    const body = await response.json() as {
      result: {
        isError: boolean;
        content: Array<{ text: string }>;
        structuredContent: {
          status: string;
          items: Array<{ id: string; status: string }>;
        };
      };
    };
    expect(body.result.isError, JSON.stringify(body.result.structuredContent)).toBe(false);
    expect(body.result.structuredContent.status).toBe("needs_setup");
    expect(body.result.structuredContent.items[0]).toMatchObject({
      id: "delivery",
      status: "needs_proof",
    });
    expect(body.result.content[0]?.text).toContain("Delivery proof");
    expect(JSON.stringify(body)).not.toContain("encryptedWebhookUrl");
    expect(mocks.getWorkspaceReadiness).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("returns credential-free Meta source retest results through MCP", async () => {
    vi.doUnmock("~/lib/customer-agent-actions.server");
    setupMocks();
    vi.doMock("~/lib/customer-meta.server", () => ({
      retestSavedCustomerMetaToken: vi.fn().mockResolvedValue({
        ok: false,
        connection: {
          id: "meta-connection-1",
          userId: "user-1",
          encryptedAccessToken: "encrypted-meta-token",
          tokenLastFour: "1234",
          tokenFingerprint: "meta-token-fingerprint",
          status: "degraded",
          summary: "Meta token needs attention.",
          lastCheckedAt: "2026-06-20T00:00:00.000Z",
          lastErrorCode: "permission_denied",
          lastErrorMessage: "Raw provider response with encrypted-meta-token and 1234.",
          createdAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
        testResult: {
          ok: false,
          status: "degraded",
          summary: "Meta token needs attention.",
          errorCode: "permission_denied",
          errorMessage: "Raw provider response with encrypted-meta-token and 1234.",
        },
      }),
    }));

    const response = await postMcp({
      jsonrpc: "2.0",
      id: "retest-source-1",
      method: "tools/call",
      params: {
        name: "retest_meta_source",
        arguments: {
          idempotencyKey: "retest-source-1",
        },
      },
    });
    const body = await response.json() as {
      result: {
        isError: boolean;
        content: Array<{ text: string }>;
        structuredContent: {
          result: {
            ok: boolean;
            connection: { status: string; lastErrorCode: string | null };
            testResult: { errorCode: string | null };
          };
          audit: {
            metadata: Record<string, unknown>;
            result: Record<string, unknown>;
          };
        };
      };
    };

    expect(body.result.isError, JSON.stringify(body.result.structuredContent)).toBe(false);
    expect(body.result.structuredContent.result).toMatchObject({
      ok: false,
      connection: {
        status: "degraded",
        lastErrorCode: "permission_denied",
      },
      testResult: {
        errorCode: "permission_denied",
      },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("encrypted-meta-token");
    expect(serialized).not.toContain("tokenLastFour");
    expect(serialized).not.toContain("tokenFingerprint");
    expect(serialized).not.toContain("Raw provider response");
    expect(body.result.content[0]?.text).not.toContain("1234");
  });

  it("returns account-owned structured digest proof through tools/call", async () => {
    setupMocks();
    const response = await postMcp({
      jsonrpc: "2.0",
      id: "call-1",
      method: "tools/call",
      params: {
        name: "get_digest_export",
        arguments: {
          digestId: "digest-1",
          format: "json",
        },
      },
    });
    const body = await response.json() as {
      result: {
        isError: boolean;
        content: Array<{ text: string }>;
        structuredContent: {
          resourceType: string;
          insightDepth: { landingPageHistory: Array<{ detail: string }> };
          items: Array<{ intelligence: { recommendedAction: string } }>;
        };
      };
    };

    expect(body.result.isError).toBe(false);
    expect(body.result.content[0]?.text).toContain("Today: brief one counter-test.");
    expect(body.result.structuredContent.resourceType).toBe("digest");
    expect(body.result.structuredContent.insightDepth.landingPageHistory[0]?.detail)
      .toBe("The routine bundle offer changed.");
    expect(body.result.structuredContent.items[0]?.intelligence.recommendedAction)
      .toBe("Today: brief one counter-test.");
  });

  it("returns Slack-ready watchlist markdown through tools/call", async () => {
    setupMocks();
    const response = await postMcp({
      jsonrpc: "2.0",
      id: "call-2",
      method: "tools/call",
      params: {
        name: "get_watchlist_export",
        arguments: {
          watchlistId: "watchlist-1",
          format: "slack",
        },
      },
    });
    const body = await response.json() as {
      result: {
        isError: boolean;
        content: Array<{ text: string }>;
        structuredContent: { resourceType: string; format: string };
      };
    };

    expect(body.result.isError).toBe(false);
    expect(body.result.content[0]?.text).toContain("*Five to Nine watchlist: Nykaa watch*");
    expect(body.result.content[0]?.text).toContain("Next move:");
    expect(body.result.structuredContent).toMatchObject({
      resourceType: "watchlist",
      format: "slack",
    });
  });

  it("runs audited watchlist write tools through tools/call", async () => {
    setupMocks();
    const runCustomerAgentAction = vi.fn().mockResolvedValue({
      audit: {
        id: "audit-1",
        status: "succeeded",
      },
      replayed: false,
      result: {
        ok: true,
        action: "watchlist.create",
        watchlist: {
          id: "watchlist-2",
          name: "Glossier watch",
        },
      },
    });
    vi.doMock("~/lib/customer-agent-actions.server", () => ({
      customerAgentActionErrorPayload: vi.fn(),
      runCustomerAgentAction,
    }));

    const response = await postMcp({
      jsonrpc: "2.0",
      id: "write-1",
      method: "tools/call",
      params: {
        name: "create_watchlist",
        arguments: {
          targetLabel: "Glossier",
          competitorWebsite: "glossier.com",
          idempotencyKey: "create-glossier",
        },
      },
    });
    const body = await response.json() as {
      result: {
        isError: boolean;
        structuredContent: {
          replayed: boolean;
          result: { watchlist: { id: string } };
        };
      };
    };

    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.replayed).toBe(false);
    expect(body.result.structuredContent.result.watchlist.id).toBe("watchlist-2");
    expect(runCustomerAgentAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "create-glossier",
        source: "mcp",
        executionContext: expect.objectContaining({
          waitUntil: expect.any(Function),
        }),
      }),
      "watchlist.create",
      expect.objectContaining({
        targetLabel: "Glossier",
        competitorWebsite: "glossier.com",
      }),
    );
  });

  it("dispatches every advertised MCP write tool to the expected audited action", async () => {
    setupMocks();
    const runCustomerAgentAction = vi.fn().mockResolvedValue({
      audit: {
        id: "audit-1",
        status: "succeeded",
      },
      replayed: false,
      result: {
        ok: true,
      },
    });
    vi.doMock("~/lib/customer-agent-actions.server", () => ({
      customerAgentActionErrorPayload: vi.fn(),
      runCustomerAgentAction,
    }));

    const cases: Array<{
      toolName: string;
      actionName: string;
      args: Record<string, unknown>;
      idempotencyKey?: string;
    }> = [
      {
        toolName: "retest_meta_source",
        actionName: "source.meta.retest",
        args: { idempotencyKey: "source-retest-1" },
        idempotencyKey: "source-retest-1",
      },
      {
        toolName: "create_watchlist",
        actionName: "watchlist.create",
        args: { targetLabel: "Glossier", idempotencyKey: "create-1" },
        idempotencyKey: "create-1",
      },
      {
        toolName: "update_watchlist",
        actionName: "watchlist.update",
        args: { watchlistId: "watchlist-1", targetLabel: "Glossier", idempotencyKey: "update-1" },
        idempotencyKey: "update-1",
      },
      {
        toolName: "refresh_watchlist",
        actionName: "watchlist.refresh",
        args: { watchlistId: "watchlist-1", idempotencyKey: "refresh-1" },
        idempotencyKey: "refresh-1",
      },
      {
        toolName: "pause_watchlist",
        actionName: "watchlist.pause",
        args: { watchlistId: "watchlist-1", idempotencyKey: "pause-1" },
        idempotencyKey: "pause-1",
      },
      {
        toolName: "resume_watchlist",
        actionName: "watchlist.resume",
        args: { watchlistId: "watchlist-1", idempotencyKey: "resume-1" },
        idempotencyKey: "resume-1",
      },
      {
        toolName: "create_collection",
        actionName: "collection.create",
        args: { name: "Client proof", idempotencyKey: "collection-1" },
        idempotencyKey: "collection-1",
      },
      {
        toolName: "add_external_proof",
        actionName: "proof.add_external",
        args: {
          collectionId: "collection-1",
          advertiser: "Nykaa",
          proofUrl: "https://example.com/proof",
          hook: "Offer changed",
          idempotencyKey: "proof-1",
        },
        idempotencyKey: "proof-1",
      },
      {
        toolName: "list_delivery_targets",
        actionName: "delivery_targets.list",
        args: { watchlistId: "watchlist-1", channel: "slack" },
      },
      {
        toolName: "update_delivery_settings",
        actionName: "delivery_settings.update",
        args: {
          watchlistId: "watchlist-1",
          explicitApproval: true,
          slackEnabled: true,
          idempotencyKey: "delivery-settings-1",
        },
        idempotencyKey: "delivery-settings-1",
      },
      {
        toolName: "update_delivery_target",
        actionName: "delivery_target.update",
        args: {
          targetId: "target-1",
          isPaused: true,
          explicitApproval: true,
          idempotencyKey: "delivery-target-1",
        },
        idempotencyKey: "delivery-target-1",
      },
      {
        toolName: "create_share_link",
        actionName: "share.create",
        args: { resourceType: "collection", resourceId: "collection-1", idempotencyKey: "share-1" },
        idempotencyKey: "share-1",
      },
      {
        toolName: "create_report",
        actionName: "report.create",
        args: { resourceType: "collection", resourceId: "collection-1" },
      },
      {
        toolName: "share_report",
        actionName: "report.share",
        args: { reportId: "collection:collection-1", idempotencyKey: "report-share-1" },
        idempotencyKey: "report-share-1",
      },
      {
        toolName: "create_counter_move_brief",
        actionName: "counter_move_brief.create",
        args: {
          watchlistId: "watchlist-1",
          ownerLabel: "Growth lead",
          followUpChannel: "client_room",
          expiryDays: 10,
          idempotencyKey: "brief-1",
        },
        idempotencyKey: "brief-1",
      },
      {
        toolName: "upsert_memory",
        actionName: "memory.upsert",
        args: { key: "voice", value: { tone: "plainspoken" }, idempotencyKey: "memory-1" },
        idempotencyKey: "memory-1",
      },
      {
        toolName: "list_memory",
        actionName: "memory.list",
        args: { scope: "brand" },
      },
      {
        toolName: "upsert_client_room",
        actionName: "client_room.upsert",
        args: { name: "Beauty client", idempotencyKey: "room-1" },
        idempotencyKey: "room-1",
      },
      {
        toolName: "list_client_rooms",
        actionName: "client_room.list",
        args: { status: "all" },
      },
      {
        toolName: "list_web_mentions",
        actionName: "web_mentions.list",
        args: { watchlistId: "watchlist-1", sources: ["reddit"] },
      },
    ];

    for (const item of cases) {
      await postMcp({
        jsonrpc: "2.0",
        id: `dispatch-${item.toolName}`,
        method: "tools/call",
        params: {
          name: item.toolName,
          arguments: item.args,
        },
      });

      expect(runCustomerAgentAction).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: item.idempotencyKey ?? null,
          source: "mcp",
          origin: "https://0509.io",
          executionContext: expect.objectContaining({
            waitUntil: expect.any(Function),
          }),
        }),
        item.actionName,
        item.args,
      );
    }
  });

  it("rejects MCP write calls from read-only API keys", async () => {
    setupMocks(true, false);
    const response = await postMcp({
      jsonrpc: "2.0",
      id: "write-read-only",
      method: "tools/call",
      params: {
        name: "create_watchlist",
        arguments: {
          targetLabel: "Glossier",
          idempotencyKey: "create-glossier",
        },
      },
    });
    const body = await response.json() as { error: { message: string } };

    expect(body.error.message).toContain("read-only");
  });

  it("returns MCP tool errors without exposing internal exceptions", async () => {
    setupMocks();
    vi.doMock("~/lib/customer-agent-actions.server", () => ({
      customerAgentActionErrorPayload: vi.fn(() => ({
        status: 402,
        body: {
          ok: false,
          error: "plan_limit_exceeded",
          message: "You have reached your competitor tracking limit.",
        },
      })),
      runCustomerAgentAction: vi.fn().mockRejectedValue(new Error("limit")),
    }));

    const response = await postMcp({
      jsonrpc: "2.0",
      id: "write-2",
      method: "tools/call",
      params: {
        name: "resume_watchlist",
        arguments: {
          watchlistId: "watchlist-1",
        },
      },
    });
    const body = await response.json() as {
      result: {
        isError: boolean;
        content: Array<{ text: string }>;
        structuredContent: { error: string };
      };
    };

    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toContain("competitor tracking limit");
    expect(body.result.structuredContent.error).toBe("plan_limit_exceeded");
  });

  it("rejects counter-move brief calls without idempotency through MCP", async () => {
    vi.doUnmock("~/lib/customer-agent-actions.server");
    setupMocks();
    const response = await postMcp({
      jsonrpc: "2.0",
      id: "brief-missing-idempotency",
      method: "tools/call",
      params: {
        name: "create_counter_move_brief",
        arguments: {
          watchlistId: "watchlist-1",
        },
      },
    });
    const body = await response.json() as {
      result: {
        isError: boolean;
        structuredContent: { error: string };
      };
    };

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error).toBe("missing_idempotency_key");
  });

  it("rejects MCP calls without an active API key", async () => {
    setupMocks(false);
    const response = await postMcp({
      jsonrpc: "2.0",
      id: "call-3",
      method: "tools/list",
      params: {},
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_api_key" });
  });

  it("does not expose another user's digest through MCP", async () => {
    const mocks = setupMocks();
    mocks.getDigest.mockResolvedValue({ ...digest, userId: "other-user" });
    const response = await postMcp({
      jsonrpc: "2.0",
      id: "call-4",
      method: "tools/call",
      params: {
        name: "get_digest_export",
        arguments: {
          digestId: "digest-1",
        },
      },
    });
    const body = await response.json() as {
      result: { isError: boolean; structuredContent: { error: string } };
    };

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error).toBe("not_found");
  });
});
