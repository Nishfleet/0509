import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COURT_PACK_EXCLUSION_REASON_CODES,
  type CourtPack,
} from "~/lib/court-pack";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<
  string,
  unknown
>;

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-05-15T00:00:00.000Z",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-05-16T00:00:00.000Z",
  },
};

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

async function mockRouter(loaderData: unknown, actionData?: unknown) {
  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement(
          "a",
          { ...props, href: typeof to === "string" ? to : "" },
          children,
        ),
      useActionData: vi.fn().mockReturnValue(actionData),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function mockAuth(plan: "free" | "scout" | "starter" | "agency" = "agency") {
  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn((context) => context.cloudflare.env),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn(async () => plan),
  }));
  // The Court Pack loader path assembles packs via `buildCourtPack`, which
  // looks up optional workspace branding through the leaf
  // `~/lib/data/workspace-branding.server` module (real D1 access). Stub it
  // so loader tests never touch the D1 binding; branding is optional by
  // contract, so `null` is the honest default. Registered exactly once per
  // test here — never re-registered inside a test body (see
  // tests/mock-registration-race.test.ts).
  const getWorkspaceBranding = vi.fn(async () => null);
  vi.doMock("~/lib/data/workspace-branding.server", () => ({
    getWorkspaceBranding,
  }));
  return { getWorkspaceBranding };
}

function clientRoomFixture() {
  return {
    id: "room-1",
    name: "Nykaa weekly desk",
    clientLabel: "Nykaa",
    status: "active",
    notes: {
      goal: "Weekly proof review.",
      reportApprovals: {
        "watchlist:watchlist-1": {
          evidenceFingerprint: "fixture-approved-evidence",
          reviewedAt: new Date(Date.now() - 60_000).toISOString(),
          approvalExpiresAt: new Date(
            Date.now() + 60 * 60 * 1000,
          ).toISOString(),
        },
      },
    },
    resourceRefs: [
      {
        resourceType: "watchlist",
        resourceId: "watchlist-1",
        label: "Nykaa watchlist",
      },
      {
        resourceType: "report",
        resourceId: "watchlist:watchlist-1",
        label: "Nykaa watchlist report",
      },
    ],
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
}

function courtPackReportDocument() {
  return {
    kind: "report" as const,
    reportId: "watchlist:watchlist-1",
    resourceType: "watchlist" as const,
    resourceId: "watchlist-1",
    title: "Nykaa watchlist",
    subtitle: "advertiser · Nykaa",
    summary: "2 verified-evidence watch events.",
    generatedAt: "2026-07-15T08:00:00.000Z",
    stats: [{ label: "Events", value: "2" }],
    insightDepth: {
      topHooks: [],
      mediaMix: [],
      campaignDurations: [],
      metricProof: [],
      creativeTimeline: [],
      landingPageHistory: [],
    },
    rows: [
      {
        id: "row-1",
        advertiser: "Nykaa",
        previewHeadline: "New offer",
        offer: "Buy one get one",
        cta: "Shop now",
        formatLabel: "Image",
        languageLabel: "English",
        previewImageUrl: null,
        creativeText: "A proven message.",
        translatedText: null,
        landingPage: {
          url: "https://nykaa.example/offer",
          headline: "Offer headline",
          captureLabel: "Browser proof",
          capturedAt: "2026-07-15T07:55:00.000Z",
          signals: [{ label: "CTA", value: "Shop now" }],
        },
        analysisFields: [{ label: "hook", value: "A proven message." }],
        tags: [],
        note: null,
        event: {
          typeLabel: "Offer",
          title: "Offer changed",
          summary: "The offer changed on the landing page.",
          createdAt: "2026-07-15T08:00:00.000Z",
          priorityScore: 80,
          priorityBand: "high",
          recommendedAction: "Review the new offer",
          proofTrail: "Saved evidence: browser capture",
          proofStatusLabel: "Verified evidence",
          sourceTypeLabel: "Saved evidence",
          sourceUrl: "https://evidence.example/capture/1",
          metaAdId: "ad-1",
        },
      },
    ],
  };
}

function approvedCourtPackFixture(): CourtPack {
  const report = courtPackReportDocument();
  return {
    roomId: "room-1",
    roomName: "Nykaa weekly desk",
    clientLabel: "Nykaa",
    preparedBy: null,
    branding: null,
    generatedAt: "2026-08-12T08:00:00.000Z",
    sections: [
      {
        reportId: "watchlist:watchlist-1",
        resourceType: "watchlist",
        title: report.title,
        subtitle: report.subtitle,
        summary: report.summary,
        generatedAt: report.generatedAt,
        reviewedAt: new Date(Date.now() - 60_000).toISOString(),
        approvalExpiresAt: new Date(
          Date.now() + 60 * 60 * 1000,
        ).toISOString(),
        evidenceFingerprint: "fixture-approved-evidence",
        report,
      },
    ],
    plates: [
      {
        plateNumber: 1,
        reportId: "watchlist:watchlist-1",
        resourceType: "watchlist",
        resourceLabel: "Nykaa watchlist report",
        title: report.title,
        advertiser: "Nykaa",
        headline: "New offer",
        capturedAt: "2026-07-15T07:55:00.000Z",
        proofStatusLabel: "Verified evidence",
        sourceUrl: "https://evidence.example/capture/1",
        event: report.rows[0].event ?? null,
        analysisFields: report.rows[0].analysisFields,
        captureLabel: "Browser proof",
      },
    ],
    excluded: [],
    coverage: {
      approvedReports: 1,
      includedSections: 1,
      excluded: 0,
      excludedByReason: {
        no_approval: 0,
        approval_invalid: 0,
        approval_expired: 0,
        fingerprint_mismatch: 0,
        readiness_failed: 0,
        load_failed: 0,
      },
      plates: 1,
    },
    hasNothingToPack: false,
  };
}

function emptyCourtPackFixture(): CourtPack {
  return {
    roomId: "room-1",
    roomName: "Nykaa weekly desk",
    clientLabel: "Nykaa",
    preparedBy: null,
    branding: null,
    generatedAt: "2026-08-12T08:00:00.000Z",
    sections: [],
    plates: [],
    excluded: [
      {
        reportId: "watchlist:watchlist-1",
        resourceType: "watchlist",
        resourceLabel: "Nykaa watchlist report",
        reasonCode: COURT_PACK_EXCLUSION_REASON_CODES.noApproval,
        reason: "This report has not been approved for client review yet.",
      },
    ],
    coverage: {
      approvedReports: 0,
      includedSections: 0,
      excluded: 1,
      excludedByReason: {
        no_approval: 1,
        approval_invalid: 0,
        approval_expired: 0,
        fingerprint_mismatch: 0,
        readiness_failed: 0,
        load_failed: 0,
      },
      plates: 0,
    },
    hasNothingToPack: true,
  };
}

describe("clients route agent memory", () => {
  it("closes the composer only after its own successful navigation completes", async () => {
    const { transitionClientRoomComposerSubmission } =
      await import("~/routes/app.clients");

    const submitting = transitionClientRoomComposerSubmission(
      false,
      "submitting",
      "upsert-client-room",
      undefined,
      undefined,
    );
    expect(submitting).toEqual({ pending: true, close: false });
    expect(
      transitionClientRoomComposerSubmission(
        submitting.pending,
        "idle",
        undefined,
        "upsert-client-room",
        true,
      ),
    ).toEqual({ pending: false, close: true });
    expect(
      transitionClientRoomComposerSubmission(
        submitting.pending,
        "idle",
        undefined,
        "upsert-client-room",
        false,
      ),
    ).toEqual({ pending: false, close: false });
    expect(
      transitionClientRoomComposerSubmission(
        false,
        "submitting",
        "upsert-agent-memory",
        undefined,
        undefined,
      ),
    ).toEqual({ pending: false, close: false });
    expect(
      transitionClientRoomComposerSubmission(
        submitting.pending,
        "idle",
        undefined,
        "upsert-agent-memory",
        true,
      ),
    ).toEqual({ pending: true, close: false });
  });

  it("does not offer inactive watchlists as client-room choices", async () => {
    const { filterSelectableClientRoomWatchlists } =
      await import("~/routes/app.clients");

    expect(
      filterSelectableClientRoomWatchlists([
        { id: "active", isActive: true },
        { id: "implicit-active" },
        { id: "inactive", isActive: false },
      ]),
    ).toEqual([{ id: "active", isActive: true }, { id: "implicit-active" }]);
  });

  it("saves owner-created operating memory through existing account storage", async () => {
    mockAuth();
    const upsertAgentMemory = vi.fn().mockResolvedValue({
      id: "memory-1",
    });
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom: vi
        .fn()
        .mockResolvedValue({ id: "room-1", name: "Nykaa weekly desk" }),
      getCollection: vi.fn(),
      getWatchlist: vi.fn(),
      upsertAgentMemory,
      upsertClientRoom: vi.fn(),
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "upsert-agent-memory");
    formData.set("key", "review_cadence");
    formData.set("scope", "customer");
    formData.set("clientRoomId", "room-1");
    formData.set("value", "Weekly client-ready review with direct tone.");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({ ok: true, message: "Context saved." });
    expect(upsertAgentMemory).toHaveBeenCalledWith({}, "user-1", {
      scope: "customer",
      key: "review_cadence",
      clientRoomId: "room-1",
      value: { value: "Weekly client-ready review with direct tone." },
      source: "owner_ui",
    });
  });

  it("rejects secret-like operating memory before persistence", async () => {
    mockAuth();
    const upsertAgentMemory = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom: vi.fn(),
      getCollection: vi.fn(),
      getWatchlist: vi.fn(),
      upsertAgentMemory,
      upsertClientRoom: vi.fn(),
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "upsert-agent-memory");
    formData.set("key", "review_cadence");
    formData.set("scope", "workspace");
    formData.set("value", "https://hooks.slack.com/services/T/B/C");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Memory values cannot contain secrets or credentials.",
    });
    expect(upsertAgentMemory).not.toHaveBeenCalled();
  });

  it("rejects secret-like client-room text before persistence", async () => {
    mockAuth();
    const upsertClientRoom = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom: vi.fn(),
      getCollection: vi.fn(),
      getWatchlist: vi.fn(),
      upsertAgentMemory: vi.fn(),
      upsertClientRoom,
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "upsert-client-room");
    formData.set("name", "Beauty client");
    formData.set("clientLabel", "https://hooks.slack.com/services/T/B/C");
    formData.set("goal", "Weekly client-ready review.");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "upsert-client-room",
      message: "Client label cannot contain secrets or credentials.",
    });
    expect(upsertClientRoom).not.toHaveBeenCalled();
  });

  it("allows ordinary client-room display text that contains security-adjacent words", async () => {
    mockAuth();
    const upsertClientRoom = vi.fn().mockResolvedValue({
      id: "room-1",
      userId: "user-1",
      name: "Token Metrics",
      clientLabel: "Secret Sales",
      status: "active",
      notes: {
        goal: "Webhook QA review.",
      },
      resourceRefs: [],
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom: vi.fn(),
      getCollection: vi.fn(),
      getWatchlist: vi.fn(),
      upsertAgentMemory: vi.fn(),
      upsertClientRoom,
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "upsert-client-room");
    formData.set("name", "Token Metrics");
    formData.set("clientLabel", "Secret Sales");
    formData.set("goal", "Webhook QA review.");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({ ok: true, intent: "upsert-client-room" });
    expect(upsertClientRoom).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        name: "Token Metrics",
        clientLabel: "Secret Sales",
        notes: expect.objectContaining({
          goal: "Webhook QA review.",
        }),
      }),
    );
  });

  it("does not save client-room memory when the room is not owned by the workspace", async () => {
    mockAuth();
    const upsertAgentMemory = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom: vi.fn().mockResolvedValue(null),
      getCollection: vi.fn(),
      getWatchlist: vi.fn(),
      upsertAgentMemory,
      upsertClientRoom: vi.fn(),
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "upsert-agent-memory");
    formData.set("key", "review_cadence");
    formData.set("scope", "customer");
    formData.set("clientRoomId", "room-from-another-workspace");
    formData.set("value", "Weekly client-ready review with direct tone.");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message:
        "We couldn't find that client room. Refresh the page and try again.",
    });
    expect(upsertAgentMemory).not.toHaveBeenCalled();
  });

  it("returns summarized memory instead of raw values from the loader", async () => {
    mockAuth();
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([
        {
          id: "memory-1",
          userId: "user-1",
          scope: "workspace",
          key: "slack-note",
          watchlistId: null,
          clientRoomId: null,
          value: { value: "https://hooks.slack.com/services/T/B/C" },
          source: "owner_ui",
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listAgentMemoryForClientRooms: vi.fn().mockResolvedValue([]),
      listClientRooms: vi.fn().mockResolvedValue([]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(JSON.stringify(result)).not.toContain("hooks.slack.com");
    expect(result).toMatchObject({
      plan: "agency",
      canManageClientRooms: true,
    });
    expect(result.memories[0]).toMatchObject({
      key: "slack-note",
      preview: "[redacted]",
    });
  });

  it("loads room-scoped memory for displayed client rooms beyond the recent workspace list", async () => {
    mockAuth();
    const listAgentMemory = vi.fn().mockResolvedValue([]);
    const listAgentMemoryForClientRooms = vi.fn().mockResolvedValue([
      {
        id: "memory-room-1",
        userId: "user-1",
        scope: "customer",
        key: "client_review_tone",
        watchlistId: null,
        clientRoomId: "room-1",
        value: { value: "Direct weekly review with evidence links." },
        source: "owner_ui",
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      },
    ]);
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory,
      listAgentMemoryForClientRooms,
      listClientRooms: vi.fn().mockResolvedValue([
        {
          id: "room-1",
          userId: "user-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {},
          resourceRefs: [],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(listAgentMemory).toHaveBeenCalledWith({}, "user-1", { limit: 20 });
    expect(listAgentMemoryForClientRooms).toHaveBeenCalledWith(
      {},
      "user-1",
      ["room-1"],
      { limitPerRoom: 20 },
    );
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      id: "memory-room-1",
      key: "client_review_tone",
      clientRoomId: "room-1",
      preview: "Direct weekly review with evidence links.",
    });
  });

  it("keeps client rooms available when optional room memory lookup fails", async () => {
    mockAuth();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([
        {
          id: "memory-recent-1",
          userId: "user-1",
          scope: "workspace",
          key: "review_cadence",
          watchlistId: null,
          clientRoomId: null,
          value: { value: "Weekly review." },
          source: "owner_ui",
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listAgentMemoryForClientRooms: vi
        .fn()
        .mockRejectedValue(new Error("D1 unavailable")),
      listClientRooms: vi.fn().mockResolvedValue([
        {
          id: "room-1",
          userId: "user-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {},
          resourceRefs: [],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(result.rooms).toHaveLength(1);
    expect(result.roomMemoryUnavailable).toBe(true);
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      id: "memory-recent-1",
      key: "review_cadence",
      preview: "Weekly review.",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[clients] room memory lookup failed",
      expect.any(Error),
    );
  });

  it("redacts legacy secret-like client-room fields from loader data", async () => {
    mockAuth();
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([]),
      listAgentMemoryForClientRooms: vi.fn().mockResolvedValue([]),
      listClientRooms: vi.fn().mockResolvedValue([
        {
          id: "room-1",
          userId: "user-1",
          name: "https://hooks.slack.com/services/T/B/C",
          clientLabel: "apiKey=f9_live_secret",
          status: "active",
          notes: {
            goal: "bearer abcdefghijklmnop",
            cadence: "Weekly",
            handoff: {
              webhook: "https://hooks.slack.com/services/T/B/C",
              owner: "Growth",
            },
            channels: ["Email", "bearer nestedabcdefghijklmnop"],
          },
          resourceRefs: [
            {
              resourceType: "watchlist",
              resourceId: "watchlist-1",
              label: "https://hooks.slack.com/services/T/B/C",
            },
          ],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(JSON.stringify(result)).not.toContain("hooks.slack.com");
    expect(JSON.stringify(result)).not.toContain("f9_live_secret");
    expect(JSON.stringify(result)).not.toContain("nestedabcdefghijklmnop");
    expect(result.rooms[0]).toMatchObject({
      name: "Client room",
      clientLabel: "Client",
      notes: {
        goal: "[redacted]",
        cadence: "Weekly",
        handoff: {
          "[redacted]": "[redacted]",
          owner: "Growth",
        },
        channels: ["Email", "[redacted]"],
      },
      resourceRefs: [],
    });
  });

  it("renders the operating memory form and saved memory previews", async () => {
    await mockRouter({
      rooms: [
        {
          id: "room-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {
            goal: "Weekly proof review for growth team.",
            cadence: "Weekly",
            reportApprovals: {
              "watchlist-watchlist-1": {
                evidenceFingerprint: "fixture-approved-evidence",
                reviewedAt: new Date(Date.now() - 60_000).toISOString(),
                approvalExpiresAt: new Date(
                  Date.now() + 60 * 60 * 1000,
                ).toISOString(),
              },
            },
          },
          resourceRefs: [
            {
              resourceType: "watchlist",
              resourceId: "watchlist-1",
              label: "Nykaa watchlist",
            },
            {
              resourceType: "report",
              resourceId: "watchlist-watchlist-1",
              label: "Nykaa watchlist report",
            },
          ],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ],
      watchlists: [],
      collections: [],
      memories: [
        {
          id: "memory-1",
          key: "review_cadence",
          scope: "customer",
          watchlistId: null,
          clientRoomId: "room-1",
          source: "owner_ui",
          updatedAt: "2026-06-20T00:00:00.000Z",
          preview: "Weekly client-ready review with direct tone.",
        },
      ],
      plan: "agency",
      canManageClientRooms: true,
      roomMemoryUnavailable: true,
      approvalUnavailableRoomIds: [],
    });

    const { default: ClientsRoute } = await import("~/routes/app.clients");
    const markup = renderToStaticMarkup(createElement(ClientsRoute));

    expect(markup).toContain("Report preferences, tone, and follow-up notes");
    expect(markup).toContain("Save context");
    expect(markup).toContain("review_cadence");
    expect(markup).toContain("Weekly client-ready review with direct tone.");
    expect(markup).toContain("Nykaa weekly desk");
    expect(markup).toContain("Create client room");
    expect(markup).toContain("f9-wk-page f9-rooms-page");
    expect(markup).not.toContain("f9-wk-panel");
    expect(markup).not.toContain("f9-dash-state-empty");
    expect(markup).not.toContain("f9-primary-button");
    expect(markup).toContain("Client context status unavailable");
    expect(markup).toContain("1 evidence source");
    expect(markup).toContain("1 report");
    expect(markup).toContain("1 loaded memory");
    expect(markup).toContain("room notes saved");
    expect(markup).toContain(
      "Refresh before sharing; saved client context could not be loaded.",
    );
    expect(markup).not.toContain("Ready for client review");
    expect(markup).not.toContain(
      "Open the report and share the snapshot when ready.",
    );
    expect(markup).toContain("Saved client context could not be loaded.");
    expect(markup).toContain('name="intent" value="approve-client-room"');
    expect(markup).toContain("Create client room");
    expect(markup).toContain("f9-wk-page f9-rooms-page");
    expect(markup).not.toContain("f9-wk-panel");
    expect(markup).not.toContain("f9-dash-state-empty");
    expect(markup).not.toContain("f9-primary-button");
  });

  it("renders a populated Court Pack on a report-linked client room", async () => {
    await mockRouter({
      rooms: [clientRoomFixture()],
      watchlists: [],
      collections: [],
      memories: [],
      packs: [approvedCourtPackFixture()],
      plan: "agency",
      canManageClientRooms: true,
      roomMemoryUnavailable: false,
      approvalUnavailableRoomIds: [],
    });

    const { default: ClientsRoute } = await import("~/routes/app.clients");
    const markup = renderToStaticMarkup(createElement(ClientsRoute));

    expect(markup).toContain('data-testid="court-pack"');
    expect(markup).toContain("Agency Court Pack");
    expect(markup).toContain("Evidence plate 1: Nykaa watchlist");
    expect(markup).toContain("Nykaa watchlist report");
    expect(markup).toContain(
      "Five to Nine · Read-only HTML for browser printing",
    );
    expect(markup).toContain("Ready for client review");
    expect(markup).not.toContain("No approved reports yet");
  });

  it("renders the honest Court Pack empty state when the room has nothing to pack", async () => {
    await mockRouter({
      rooms: [{ ...clientRoomFixture(), notes: { goal: "Weekly proof review." } }],
      watchlists: [],
      collections: [],
      memories: [],
      packs: [emptyCourtPackFixture()],
      plan: "agency",
      canManageClientRooms: true,
      roomMemoryUnavailable: false,
      approvalUnavailableRoomIds: [],
    });

    const { default: ClientsRoute } = await import("~/routes/app.clients");
    const markup = renderToStaticMarkup(createElement(ClientsRoute));

    expect(markup).toContain('data-testid="court-pack"');
    expect(markup).toContain("No approved reports yet");
    expect(markup).toContain(
      "Review and approve current report evidence to prepare this Court Pack.",
    );
    expect(markup).toContain("Excluded from verified evidence");
    expect(markup).toContain(
      "Nykaa watchlist report: This report has not been approved for client review yet.",
    );
    expect(markup).toContain(
      "Five to Nine · Read-only HTML for browser printing",
    );
  });

  it("labels the saved-context preview honestly when more than eight loaded memories exist", async () => {
    await mockRouter({
      rooms: [],
      watchlists: [],
      collections: [],
      memories: Array.from({ length: 9 }, (_, index) => ({
        id: `memory-${index + 1}`,
        key: `context_${index + 1}`,
        scope: "workspace",
        watchlistId: null,
        clientRoomId: null,
        source: "owner_ui",
        updatedAt: "2026-06-20T00:00:00.000Z",
        preview: `Context preview ${index + 1}`,
      })),
      plan: "agency",
      canManageClientRooms: true,
    });

    const { default: ClientsRoute } = await import("~/routes/app.clients");
    const markup = renderToStaticMarkup(createElement(ClientsRoute));

    expect(markup).toContain("Showing 8 of 9 loaded memories");
    expect(markup).toContain("Context preview 8");
    expect(markup).not.toContain("Context preview 9");
  });

  it("labels the saved-context preview honestly when more than eight loaded memories exist", async () => {
    await mockRouter({
      rooms: [],
      watchlists: [],
      collections: [],
      memories: Array.from({ length: 9 }, (_, index) => ({
        id: `memory-${index + 1}`,
        key: `context_${index + 1}`,
        scope: "workspace",
        watchlistId: null,
        clientRoomId: null,
        source: "owner_ui",
        updatedAt: "2026-06-20T00:00:00.000Z",
        preview: `Context preview ${index + 1}`,
      })),
      plan: "agency",
      canManageClientRooms: true,
    });

    const { default: ClientsRoute } = await import("~/routes/app.clients");
    const markup = renderToStaticMarkup(createElement(ClientsRoute));

    expect(markup).toContain("Showing 8 of 9 loaded memories");
    expect(markup).toContain("Context preview 8");
    expect(markup).not.toContain("Context preview 9");
  });

  it("preserves saved approvals but marks readiness unavailable when revalidation helpers are unavailable", async () => {
    mockAuth();
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([]),
      listAgentMemoryForClientRooms: vi.fn().mockResolvedValue([]),
      listClientRooms: vi.fn().mockResolvedValue([
        {
          id: "room-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {
            reportApprovals: {
              "watchlist-watchlist-1": {
                evidenceFingerprint: "approved",
                reviewedAt: new Date(Date.now() - 60_000).toISOString(),
                approvalExpiresAt: new Date(
                  Date.now() + 60 * 60 * 1000,
                ).toISOString(),
              },
            },
          },
          resourceRefs: [
            { resourceType: "report", resourceId: "watchlist-watchlist-1" },
          ],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
      getLatestDigestRunSummaryForWatchlist: undefined,
      listAdsByIds: undefined,
      listCollectionItems: undefined,
      listProofCapturePairsForEventIds: undefined,
      listWatchEvents: undefined,
      getCollection: undefined,
      getWatchlist: undefined,
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(result.rooms[0].notes.reportApprovals).toEqual({
      "watchlist-watchlist-1": {
        evidenceFingerprint: "approved",
        reviewedAt: expect.any(String),
        approvalExpiresAt: expect.any(String),
      },
    });
    expect(result.approvalUnavailableRoomIds).toEqual(["room-1"]);
  });

  it("preserves a saved approval and labels it unavailable when revalidation throws", async () => {
    mockAuth();
    const reviewedAt = new Date(Date.now() - 60_000).toISOString();
    const approvalExpiresAt = new Date(
      Date.now() + 60 * 60 * 1000,
    ).toISOString();
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([]),
      listAgentMemoryForClientRooms: vi.fn().mockResolvedValue([]),
      listClientRooms: vi.fn().mockResolvedValue([
        {
          id: "room-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {
            reportApprovals: {
              "watchlist:watchlist-1": {
                evidenceFingerprint: "approved",
                reviewedAt,
                approvalExpiresAt,
              },
            },
          },
          resourceRefs: [
            { resourceType: "report", resourceId: "watchlist:watchlist-1" },
          ],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([
        {
          id: "watchlist-1",
          isActive: true,
          updatedAt: new Date(Date.parse(reviewedAt) + 30_000).toISOString(),
        },
      ]),
      getLatestDigestRunSummaryForWatchlist: vi.fn(),
      listAdsByIds: vi.fn(),
      listCollectionItems: vi.fn(),
      listProofCapturePairsForEventIds: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi
        .fn()
        .mockRejectedValue(new Error("transient D1 failure")),
      getCollection: vi.fn(),
      getWatchlist: vi
        .fn()
        .mockResolvedValue({ id: "watchlist-1", isActive: true }),
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(result.rooms[0].notes.reportApprovals).toEqual({
      "watchlist:watchlist-1": {
        evidenceFingerprint: "approved",
        reviewedAt,
        approvalExpiresAt,
      },
    });
    expect(result.approvalUnavailableRoomIds).toEqual(["room-1"]);
    expect(result.rooms[0].resourceRefs).toEqual([
      { resourceType: "report", resourceId: "watchlist:watchlist-1" },
    ]);
  });

  it("renders approval read failures as unavailable without calling the saved approval revoked", async () => {
    await mockRouter({
      rooms: [
        {
          id: "room-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {
            goal: "Weekly proof review.",
            reportApprovals: {
              "watchlist:watchlist-1": {
                evidenceFingerprint: "approved",
                reviewedAt: new Date(Date.now() - 60_000).toISOString(),
                approvalExpiresAt: new Date(
                  Date.now() + 60 * 60 * 1000,
                ).toISOString(),
              },
            },
          },
          resourceRefs: [
            { resourceType: "watchlist", resourceId: "watchlist-1" },
            { resourceType: "report", resourceId: "watchlist:watchlist-1" },
          ],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ],
      watchlists: [],
      collections: [],
      memories: [],
      plan: "agency",
      canManageClientRooms: true,
      roomMemoryUnavailable: false,
      approvalUnavailableRoomIds: ["room-1"],
    });

    const { default: ClientsRoute } = await import("~/routes/app.clients");
    const markup = renderToStaticMarkup(createElement(ClientsRoute));

    expect(markup).toContain(
      "One or more report approvals could not be rechecked.",
    );
    expect(markup).toContain("Report approval status unavailable");
    expect(markup).toContain("saved approval was not changed");
    expect(markup).not.toContain("Ready for client review");
    expect(markup).toContain('href="/app/reports/watchlist:watchlist-1"');
    expect(markup).toContain('name="intent" value="approve-client-room"');
  });

  it("strips expired and malformed room approvals", async () => {
    mockAuth();
    const now = Date.now();
    const validReviewedAt = new Date(now - 60_000).toISOString();
    const validApprovalExpiresAt = new Date(now + 60 * 60 * 1000).toISOString();
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([]),
      listAgentMemoryForClientRooms: vi.fn().mockResolvedValue([]),
      listClientRooms: vi.fn().mockResolvedValue([
        {
          id: "room-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {
            reportApprovals: {
              valid: {
                evidenceFingerprint: "current",
                reviewedAt: validReviewedAt,
                approvalExpiresAt: validApprovalExpiresAt,
              },
              expired: {
                evidenceFingerprint: "old",
                reviewedAt: new Date(
                  now - 2 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                approvalExpiresAt: new Date(now - 60_000).toISOString(),
              },
              malformed: {
                evidenceFingerprint: "missing-expiry",
                reviewedAt: "not-a-date",
                approvalExpiresAt: validApprovalExpiresAt,
              },
            },
          },
          resourceRefs: [],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(result.rooms[0].notes.reportApprovals).toEqual({
      valid: {
        evidenceFingerprint: "current",
        reviewedAt: validReviewedAt,
        approvalExpiresAt: validApprovalExpiresAt,
      },
    });
  });

  it("drops synthetic report references and inactive watchlists from the client-room view", async () => {
    mockAuth();
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([]),
      listAgentMemoryForClientRooms: vi.fn().mockResolvedValue([]),
      listClientRooms: vi.fn().mockResolvedValue([
        {
          id: "room-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {},
          resourceRefs: [
            {
              resourceType: "watchlist",
              resourceId: "watchlist-inactive",
              label: "Inactive",
            },
            {
              resourceType: "report",
              resourceId: "synthetic-report",
              label: "Synthetic",
            },
          ],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi
        .fn()
        .mockResolvedValue([{ id: "watchlist-inactive", isActive: false }]),
      getLatestDigestRunSummaryForWatchlist: undefined,
      listAdsByIds: undefined,
      listCollectionItems: undefined,
      listProofCapturePairsForEventIds: undefined,
      listWatchEvents: undefined,
      getCollection: undefined,
      getWatchlist: undefined,
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(result.rooms[0].resourceRefs).toEqual([]);
    expect(JSON.stringify(result.rooms[0])).not.toContain("Synthetic");
  });

  it("returns an honest empty Court Pack for a report-linked room without approvals", async () => {
    const { getWorkspaceBranding } = mockAuth();
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([]),
      listAgentMemoryForClientRooms: vi.fn().mockResolvedValue([]),
      listClientRooms: vi.fn().mockResolvedValue([
        {
          id: "room-1",
          userId: "user-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {},
          resourceRefs: [
            {
              resourceType: "report",
              resourceId: "watchlist:watchlist-1",
              label: "Nykaa watchlist report",
            },
          ],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([
        {
          id: "watchlist-1",
          isActive: true,
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      getLatestDigestRunSummaryForWatchlist: vi.fn(),
      listAdsByIds: vi.fn(),
      listCollectionItems: vi.fn(),
      listProofCapturePairsForEventIds: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi.fn(),
      getCollection: vi.fn(),
      getWatchlist: vi.fn(),
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    // The loader's Court Pack assembly reaches the branding lookup through
    // the stubbed leaf module — never real D1.
    expect(getWorkspaceBranding).toHaveBeenCalledWith({}, "user-1");
    expect(result.packs).toHaveLength(1);
    expect(result.packs[0]).toMatchObject({
      roomId: "room-1",
      roomName: "Nykaa weekly desk",
      clientLabel: "Nykaa",
      preparedBy: null,
      branding: null,
      hasNothingToPack: true,
      sections: [],
      plates: [],
      coverage: {
        approvedReports: 0,
        includedSections: 0,
        excluded: 1,
        plates: 0,
      },
    });
    expect(result.packs[0].excluded).toEqual([
      {
        reportId: "watchlist:watchlist-1",
        resourceType: "watchlist",
        resourceLabel: "Nykaa watchlist report",
        reasonCode: COURT_PACK_EXCLUSION_REASON_CODES.noApproval,
        reason: "This report has not been approved for client review yet.",
      },
    ]);
    expect(result.packs[0].coverage.excludedByReason).toEqual({
      [COURT_PACK_EXCLUSION_REASON_CODES.noApproval]: 1,
      approval_invalid: 0,
      approval_expired: 0,
      fingerprint_mismatch: 0,
      readiness_failed: 0,
      load_failed: 0,
    });
  });

  it("fails closed instead of approving evidence from an inactive watchlist", async () => {
    mockAuth();
    const upsertClientRoom = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom: vi.fn().mockResolvedValue({
        id: "room-1",
        name: "Nykaa weekly desk",
        clientLabel: "Nykaa",
        status: "active",
        notes: {},
        resourceRefs: [
          { resourceType: "report", resourceId: "watchlist:watchlist-1" },
        ],
      }),
      getCollection: vi.fn(),
      getWatchlist: vi
        .fn()
        .mockResolvedValue({ id: "watchlist-1", isActive: false }),
      getLatestDigestRunSummaryForWatchlist: vi.fn(),
      listAdsByIds: vi.fn(),
      listCollectionItems: vi.fn(),
      listProofCapturePairsForEventIds: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi.fn(),
      upsertAgentMemory: vi.fn(),
      upsertClientRoom,
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "approve-client-room");
    formData.set("roomId", "room-1");
    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({
      ok: false,
      intent: "approve-client-room",
      error: "evidence_not_ready",
    });
    expect(upsertClientRoom).not.toHaveBeenCalled();
  });

  it("shows a concrete next step for client rooms that are not ready to hand off", async () => {
    await mockRouter({
      rooms: [
        {
          id: "room-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {},
          resourceRefs: [],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ],
      watchlists: [],
      collections: [],
      memories: [],
      plan: "agency",
      canManageClientRooms: true,
    });

    const { default: ClientsRoute } = await import("~/routes/app.clients");
    const markup = renderToStaticMarkup(createElement(ClientsRoute));

    expect(markup).toContain("Needs setup before client review");
    expect(markup).toContain("No linked evidence yet");
    expect(markup).toContain("No client context saved");
    expect(markup).toContain("Link a watchlist or collection to this room.");
  });

  it.each(["free", "scout", "starter"] as const)(
    "rejects every client-room mutation before data access on the %s plan",
    async (plan) => {
      mockAuth(plan);
      const getClientRoom = vi.fn();
      const getCollection = vi.fn();
      const getWatchlist = vi.fn();
      const upsertAgentMemory = vi.fn();
      const upsertClientRoom = vi.fn();
      vi.doMock("~/lib/data.server", () => ({
        getClientRoom,
        getCollection,
        getWatchlist,
        upsertAgentMemory,
        upsertClientRoom,
      }));

      const { action } = await import("~/routes/app.clients");
      for (const [intent, fields] of [
        [
          "upsert-client-room",
          { name: "Nykaa weekly desk", watchlistIds: "watchlist-1" },
        ],
        [
          "upsert-agent-memory",
          { key: "tone", value: "Direct weekly review." },
        ],
        ["set-client-room-status", { roomId: "room-1", status: "archived" }],
        ["approve-client-room", { roomId: "room-1" }],
      ] as const) {
        const formData = new FormData();
        formData.set("intent", intent);
        for (const [key, value] of Object.entries(fields))
          formData.set(key, value);
        const result = await action({
          context: createContext(),
          request: new Request("http://localhost/app/clients", {
            method: "POST",
            body: formData,
          }),
        } as never);

        expect(result).toMatchObject({
          ok: false,
          error: "plan_gated",
          feature: "client_reports",
          plan,
          message: "This capability is not included in your current plan.",
        });
      }

      expect(getClientRoom).not.toHaveBeenCalled();
      expect(getCollection).not.toHaveBeenCalled();
      expect(getWatchlist).not.toHaveBeenCalled();
      expect(upsertAgentMemory).not.toHaveBeenCalled();
      expect(upsertClientRoom).not.toHaveBeenCalled();
    },
  );

  it("keeps Agency status actions unchanged", async () => {
    mockAuth("agency");
    const getClientRoom = vi.fn().mockResolvedValue({
      id: "room-1",
      name: "Nykaa weekly desk",
      clientLabel: "Nykaa",
    });
    const upsertClientRoom = vi.fn().mockResolvedValue({ id: "room-1" });
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom,
      getCollection: vi.fn(),
      getWatchlist: vi.fn(),
      upsertAgentMemory: vi.fn(),
      upsertClientRoom,
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "set-client-room-status");
    formData.set("roomId", "room-1");
    formData.set("status", "archived");
    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({ ok: true, message: "Client room archived." });
    expect(getClientRoom).toHaveBeenCalledWith({}, "user-1", "room-1");
    expect(upsertClientRoom).toHaveBeenCalledWith({}, "user-1", {
      roomId: "room-1",
      name: "Nykaa weekly desk",
      clientLabel: "Nykaa",
      status: "archived",
    });
  });

  it("renders downgraded rooms and context as read-only with a billing recovery path", async () => {
    await mockRouter({
      plan: "starter",
      canManageClientRooms: false,
      rooms: [
        {
          id: "room-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: { goal: "Weekly proof review." },
          resourceRefs: [
            {
              resourceType: "watchlist",
              resourceId: "watchlist-1",
              label: "Nykaa watchlist",
            },
          ],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
        {
          id: "room-2",
          name: "Archived desk",
          clientLabel: "Acme",
          status: "archived",
          notes: {},
          resourceRefs: [],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ],
      watchlists: [],
      collections: [],
      memories: [
        {
          id: "memory-1",
          key: "review_tone",
          scope: "workspace",
          watchlistId: null,
          clientRoomId: "room-1",
          source: "owner_ui",
          updatedAt: "2026-06-20T00:00:00.000Z",
          preview: "Direct and evidence-led.",
        },
      ],
    });

    const { default: ClientsRoute } = await import("~/routes/app.clients");
    const markup = renderToStaticMarkup(createElement(ClientsRoute));

    expect(markup).toContain("Nykaa weekly desk");
    expect(markup).toContain("Nykaa watchlist");
    expect(markup).toContain("Direct and evidence-led.");
    expect(markup).toContain("Archived desk");
    expect(markup).toContain("Upgrade to Agency");
    expect(markup).toContain("/app/billing?source=clients#plans");
    expect(markup.match(/Upgrade to Agency/g)).toHaveLength(1);
    expect(markup).not.toContain("is-error");
    expect(markup).not.toContain("Save client room");
    expect(markup).not.toContain("Save context");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain(">Archive<");
    expect(markup).not.toContain(">Restore<");
  });

  it.each(["free", "scout", "starter"] as const)(
    "renders a quiet locked empty state instead of a dead-end create prompt on %s",
    async (plan) => {
      await mockRouter({
        plan,
        canManageClientRooms: false,
        rooms: [],
        watchlists: [],
        collections: [],
        memories: [],
      });

      const { default: ClientsRoute } = await import("~/routes/app.clients");
      const markup = renderToStaticMarkup(createElement(ClientsRoute));

      expect(markup).toContain("f9-rooms-page");
      expect(markup).toContain("f9-rooms-gate");
      expect(markup).toContain("Client rooms stay readable");
      expect(markup).toContain("Agency plan unlocks creation and updates");
      expect(markup).toContain("Upgrade to Agency");
      expect(markup).toContain("/app/billing?source=clients#plans");
      expect(markup.match(/Upgrade to Agency/g)).toHaveLength(1);
      expect(markup).not.toContain("is-error");
      expect(markup).not.toContain("f9-locked-feature");
      expect(markup).not.toContain("f9-evidence-specimen");
      expect(markup).not.toContain("f9-dash-state-empty");
      expect(markup).not.toContain("Create the first client room");
      expect(markup).not.toContain("Save client room");
      expect(markup).not.toContain("Save context");
      expect(markup).not.toContain("<form");
    },
  );
});
