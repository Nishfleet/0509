import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockAgencyWorkspacePlan } from "./helpers/agency-plan-mock";

const SCREENSHOT_JUNE = "landing-pages/2026-06-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpeg";
const SCREENSHOT_MID = "landing-pages/2026-06-15/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpeg";
const SCREENSHOT_JULY = "landing-pages/2026-07-01/cccccccccccccccccccccccccccccccc.jpeg";
const HTML_JUNE = "landing-pages/2026-06-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html";
const HTML_MID = "landing-pages/2026-06-15/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.html";
const HTML_JULY = "landing-pages/2026-07-01/cccccccccccccccccccccccccccccccc.html";
const SUPPRESSED_SHOT = "landing-pages/2026-06-20/dddddddddddddddddddddddddddddddd.jpeg";
const SUPPRESSED_HTML = "landing-pages/2026-06-20/dddddddddddddddddddddddddddddddd.html";

const snapshotRows = [
  {
    id: "snap-june",
    canonical_url: "https://gymshark.com/offer",
    raw_headline: "20% off first order",
    cta_text: "Shop now",
    price_text: "20% off",
    form_present: 0,
    artifact_key: HTML_JUNE,
    metadata_json: JSON.stringify({ screenshotArtifactKey: SCREENSHOT_JUNE, htmlArtifactKey: HTML_JUNE }),
    captured_at: "2026-06-01T10:00:00.000Z",
  },
  {
    id: "snap-mid",
    canonical_url: "https://www.gymshark.com/offer",
    raw_headline: "30% off first order",
    cta_text: "Get 30% off",
    price_text: "30% off",
    form_present: 0,
    artifact_key: HTML_MID,
    metadata_json: JSON.stringify({ screenshotArtifactKey: SCREENSHOT_MID, htmlArtifactKey: HTML_MID }),
    captured_at: "2026-06-15T10:00:00.000Z",
  },
  {
    id: "snap-july",
    canonical_url: "https://shop.gymshark.com/offer",
    raw_headline: "Summer sale",
    cta_text: "Shop the sale",
    price_text: "From £25",
    form_present: 1,
    artifact_key: HTML_JULY,
    metadata_json: JSON.stringify({ screenshotArtifactKey: SCREENSHOT_JULY, htmlArtifactKey: HTML_JULY }),
    captured_at: "2026-07-01T10:00:00.000Z",
  },
];

const suppressedEventRow = {
  id: "event-suppressed",
  watchlist_id: "wl-gymshark",
  event_type: "landing_page_headline_changed",
  title: "Headline churn",
  summary: "Repeated headline swap with no offer change.",
  created_at: "2026-06-20T12:00:00.000Z",
  suppressed_at: "2026-06-20T12:01:00.000Z",
  proof_capture_id: "proof-suppressed",
  metadata_json: JSON.stringify({ landingPageUrl: "https://gymshark.com/offer" }),
  screenshot_artifact_key: SUPPRESSED_SHOT,
  html_artifact_key: SUPPRESSED_HTML,
  succeeded_at: "2026-06-20T12:00:30.000Z",
  attempted_at: "2026-06-20T12:00:00.000Z",
  target_id: "https://gymshark.com",
  landing_page_url: "https://gymshark.com/offer",
};

const confirmedEventRow = {
  ...suppressedEventRow,
  id: "event-confirmed",
  title: "Offer raised",
  summary: "First-order discount moved from 20% to 30%.",
  created_at: "2026-06-15T10:05:00.000Z",
  suppressed_at: null,
  proof_capture_id: "proof-confirmed",
  screenshot_artifact_key: SCREENSHOT_MID,
  html_artifact_key: HTML_MID,
  succeeded_at: "2026-06-15T10:05:00.000Z",
};

const queryAll = vi.hoisted(() => vi.fn());

vi.mock("~/lib/data/d1.server", () => ({
  queryAll,
  queryOne: vi.fn(),
  execute: vi.fn(),
  ensureDb: vi.fn(),
}));

function fakeApiKey(suffix: string) {
  return ["f9", "live", suffix].join("_");
}

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

function routeQueryAll(_env: unknown, sql: unknown) {
  const text = String(sql);
  if (text.includes("FROM landing_page_snapshot")) {
    return snapshotRows;
  }
  if (text.includes("FROM watch_event")) {
    if (text.includes("status = 'suppressed'")) {
      return [suppressedEventRow];
    }
    return [confirmedEventRow, suppressedEventRow];
  }
  return [];
}

function setupRouteMocks(options: {
  actionsWriteEnabled?: boolean;
  plan?: string;
  env?: Record<string, unknown>;
} = {}) {
  mockAgencyWorkspacePlan();
  if (options.plan) {
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue(options.plan),
      getEffectiveWorkspacePlan: vi.fn().mockResolvedValue(options.plan),
      getUserPlanForActor: vi.fn().mockResolvedValue(options.plan),
      checkPlanLimit: vi.fn().mockResolvedValue({ allowed: true, limit: 75, current: 1 }),
      PLAN_LIMITS: { agency: { digests: true } },
    }));
  }
  queryAll.mockImplementation(routeQueryAll);
  const audit = {
    id: "audit-1",
    userId: "user-1",
    apiKeyId: "api-key-1",
    actionName: "get_change_history",
    resourceType: null,
    resourceId: null,
    idempotencyKey: null,
    status: "started",
    result: null,
    errorCode: null,
    errorMessage: null,
    metadata: {},
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
  vi.doMock("~/lib/api-keys.server", () => ({
    authenticateApiKeyRequest: vi.fn().mockResolvedValue({
      ok: true,
      apiKey: { ...apiKey, actionsWriteEnabled: options.actionsWriteEnabled ?? true },
    }),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => ({ DB: {}, ...options.env })),
  }));
  vi.doMock("~/lib/data.server", () => ({
    findAgentActionAuditByIdempotencyKey: vi.fn().mockResolvedValue(null),
    claimAgentActionAudit: vi.fn().mockResolvedValue({ audit, claimed: true }),
    reclaimRetryableAgentActionAudit: vi.fn().mockResolvedValue(null),
    finishAgentActionAudit: vi.fn().mockImplementation((_env: unknown, auditId: string, input: Record<string, unknown>) =>
      Promise.resolve({
        ...audit,
        id: auditId,
        status: input.status,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        result: input.result ?? null,
        metadata: input.metadata ?? {},
      })),
    isActiveCustomerApiKey: vi.fn().mockResolvedValue(true),
  }));
  vi.doMock("~/lib/authenticated-api-limits.server", () => ({
    enforceAuthenticatedApiLimit: vi.fn().mockResolvedValue(null),
    verifyAuthenticatedApiIdentity: vi.fn().mockResolvedValue(null),
    createAuthenticatedApiLimitContext: vi.fn((_env: unknown, identity: unknown) => ({
      identity,
      isIdentityActive: () => true,
    })),
  }));
}

async function postMcp(body: Record<string, unknown>) {
  const { action } = await import("~/routes/api.mcp");
  return action({
    context: {
      cloudflare: {
        env: { DB: {} },
        ctx: { waitUntil: vi.fn() },
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

async function callMcpTool(name: string, args: Record<string, unknown>) {
  const response = await postMcp({
    jsonrpc: "2.0",
    id: name,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const body = await response.json() as {
    result?: {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
    error?: { message: string };
  };
  expect(response.ok, JSON.stringify(body)).toBe(true);
  expect(body.result?.isError).toBe(false);
  return body.result?.structuredContent as Record<string, unknown>;
}

beforeEach(() => {
  queryAll.mockReset();
  queryAll.mockImplementation(routeQueryAll);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("MCP change-history tools", () => {
  it("lists the four read-only history tools on public discovery", async () => {
    const { loader } = await import("~/routes/api.mcp");
    const response = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/api/mcp"),
    } as never);
    const body = await response.json() as { tools: Array<{ name: string; requiresWriteEnabled: boolean }> };
    const names = body.tools.map((tool) => tool.name);
    for (const name of ["get_change_history", "get_offer_state_at", "diff_offer", "list_suppressed"]) {
      expect(names).toContain(name);
      expect(body.tools.find((tool) => tool.name === name)?.requiresWriteEnabled).toBe(false);
    }
  });

  it("returns history, state-at-date, diff, and suppressed events with evidence links", async () => {
    setupRouteMocks({ actionsWriteEnabled: false });

    const history = await callMcpTool("get_change_history", {
      domain: "gymshark.com",
      since: "2026-06-01",
    });
    const historyResult = history.result as {
      domain: string;
      since: string;
      offerChanges: Array<{
        capturedAt: string;
        headline: string;
        evidenceLink: string;
        pageTextLink: string;
        transition: { headline: { before: string; after: string } } | null;
      }>;
      events: Array<{ capturedAt: string; evidenceLink: string }>;
    };
    expect(historyResult.domain).toBe("gymshark.com");
    expect(historyResult.since).toBe("2026-06-01T00:00:00.000Z");
    expect(historyResult.offerChanges.map((entry) => entry.headline)).toEqual([
      "30% off first order",
      "Summer sale",
    ]);
    expect(historyResult.offerChanges[0]?.transition?.headline).toEqual({
      before: "20% off first order",
      after: "30% off first order",
    });
    expect(historyResult.offerChanges[0]?.evidenceLink).toContain("/artifacts/proof/");
    expect(historyResult.offerChanges[0]?.pageTextLink).toContain("/artifacts/page-text/");
    expect(historyResult.offerChanges[0]?.capturedAt).toBe("2026-06-15T10:00:00.000Z");
    expect(historyResult.events).toHaveLength(1);
    expect(historyResult.events[0]?.evidenceLink).toContain("/artifacts/proof/");
    expect(historyResult.events[0]?.capturedAt).toBe("2026-06-15T10:05:00.000Z");

    const state = await callMcpTool("get_offer_state_at", {
      domain: "gymshark.com",
      date: "2026-06-20",
    });
    const stateResult = state.result as {
      date: string;
      state: { headline: string; capturedAt: string; evidenceLink: string };
    };
    expect(stateResult.date).toBe("2026-06-20");
    expect(stateResult.state.headline).toBe("30% off first order");
    expect(stateResult.state.capturedAt).toBe("2026-06-15T10:00:00.000Z");
    expect(stateResult.state.evidenceLink).toContain(encodeURIComponent(SCREENSHOT_MID));

    const diff = await callMcpTool("diff_offer", {
      domain: "gymshark.com",
      dateA: "2026-06-01",
      dateB: "2026-07-01",
    });
    const diffResult = diff.result as {
      diff: {
        headline: { before: string; after: string };
        priceText: { before: string; after: string };
      };
      stateA: { capturedAt: string; evidenceLink: string };
      stateB: { capturedAt: string; evidenceLink: string };
    };
    expect(diffResult.diff.headline).toEqual({
      before: "20% off first order",
      after: "Summer sale",
    });
    expect(diffResult.diff.priceText).toEqual({
      before: "20% off",
      after: "From £25",
    });
    expect(diffResult.stateA.evidenceLink).toContain("/artifacts/proof/");
    expect(diffResult.stateB.capturedAt).toBe("2026-07-01T10:00:00.000Z");

    const suppressed = await callMcpTool("list_suppressed", { domain: "gymshark.com" });
    const suppressedResult = suppressed.result as {
      events: Array<{
        id: string;
        capturedAt: string;
        suppressedAt: string;
        evidenceLink: string;
        pageTextLink: string;
      }>;
    };
    expect(suppressedResult.events).toHaveLength(1);
    expect(suppressedResult.events[0]?.id).toBe("event-suppressed");
    expect(suppressedResult.events[0]?.capturedAt).toBe("2026-06-20T12:00:30.000Z");
    expect(suppressedResult.events[0]?.suppressedAt).toBe("2026-06-20T12:01:00.000Z");
    expect(suppressedResult.events[0]?.evidenceLink).toContain("/artifacts/proof/");
    expect(suppressedResult.events[0]?.pageTextLink).toContain("/artifacts/page-text/");
  });

  it("keeps Agency gating closed until CHANGE_HISTORY_READ_OPEN is flipped", async () => {
    setupRouteMocks({
      actionsWriteEnabled: false,
      plan: "scout",
    });
    const response = await postMcp({
      jsonrpc: "2.0",
      id: "gated",
      method: "tools/call",
      params: {
        name: "get_offer_state_at",
        arguments: { domain: "gymshark.com", date: "2026-06-20" },
      },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "plan_gated",
      feature: "mcp_access",
      plan: "scout",
    });
  });
});
