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

function setupMocks(authOk = true) {
  const getWorkspaceReadiness = vi.fn().mockResolvedValue(readinessPayload);
  const mocks = {
    getCollection: vi.fn().mockResolvedValue(collection),
    getDigest: vi.fn().mockResolvedValue(digest),
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    listCollectionItems: vi.fn().mockResolvedValue([collectionItem]),
    listWatchEvents: vi.fn().mockResolvedValue([watchEvent]),
    getWorkspaceReadiness,
  };

  vi.doMock("~/lib/api-keys.server", () => ({
    authenticateApiKeyRequest: vi.fn().mockResolvedValue(
      authOk
        ? { ok: true, apiKey }
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

async function loadDocs() {
  const { loader } = await import("~/routes/api.mcp");
  return loader({
    context: { cloudflare: { env: {} } },
    request: new Request("https://0509.io/api/mcp"),
  } as never);
}

async function postMcp(body: Record<string, unknown>) {
  const { action } = await import("~/routes/api.mcp");
  return action({
    context: { cloudflare: { env: { DB: {} } } },
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
  it("documents the live agent boundary", async () => {
    const response = await loadDocs();
    const body = await response.json() as {
      status: string;
      endpoint: string;
      tools: Array<{ name: string }>;
      notLiveYet: string[];
    };

    expect(body.status).toBe("live");
    expect(body.endpoint).toBe("https://0509.io/api/mcp");
    expect(body.tools.map((tool) => tool.name)).toContain("get_workspace_readiness");
    expect(body.tools.map((tool) => tool.name)).toContain("get_digest_export");
    expect(body.tools.map((tool) => tool.name)).toContain("create_watchlist");
    expect(body.notLiveYet).toContain("TikTok ingestion");
    expect(body.notLiveYet).not.toContain("MCP server");
  });

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
      result: { protocolVersion: string; capabilities: { tools: { listChanged: boolean } } };
    };

    expect(initialize.headers.get("mcp-protocol-version")).toBe("2025-06-18");
    expect(initialized.result.protocolVersion).toBe("2025-06-18");
    expect(initialized.result.capabilities.tools.listChanged).toBe(false);

    const tools = await postMcp({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const body = await tools.json() as {
      result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> };
    };

    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "get_workspace_readiness",
      "get_collection_export",
      "get_watchlist_export",
      "get_digest_export",
      "create_watchlist",
      "refresh_watchlist",
      "pause_watchlist",
      "resume_watchlist",
      "add_external_proof",
      "create_share_link",
      "create_report",
      "share_report",
      "create_counter_move_brief",
      "upsert_memory",
      "list_memory",
      "upsert_client_room",
      "list_client_rooms",
    ]);
    expect(body.result.tools[0]?.annotations.readOnlyHint).toBe(true);
    expect(body.result.tools.find((tool) => tool.name === "create_watchlist")?.annotations.readOnlyHint).toBe(false);
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

    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.status).toBe("needs_setup");
    expect(body.result.structuredContent.items[0]).toMatchObject({
      id: "delivery",
      status: "needs_proof",
    });
    expect(body.result.content[0]?.text).toContain("Delivery proof");
    expect(JSON.stringify(body)).not.toContain("encryptedWebhookUrl");
    expect(mocks.getWorkspaceReadiness).toHaveBeenCalledWith(expect.anything(), "user-1");
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
      }),
      "watchlist.create",
      expect.objectContaining({
        targetLabel: "Glossier",
        competitorWebsite: "glossier.com",
      }),
    );
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
