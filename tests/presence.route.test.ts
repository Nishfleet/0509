import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

async function mockRouter(loaderData: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    return {
      ...actual,
      useLoaderData: () => loaderData,
      useActionData: () => null,
      useNavigation: () => ({ state: "idle", formData: null }),
      Form: ({ children, ...props }: MockFormProps) => createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) => createElement("a", { href: to, ...props }, children),
    };
  });
}

function mockPresenceActionDeps(
  pollPresenceSourceTarget: ReturnType<typeof vi.fn>,
  deletePresenceEntity: ReturnType<typeof vi.fn> = vi.fn(),
) {
  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn(async () => ({ workspaceUserId: "user-1" })),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn((context) => context.cloudflare.env),
  }));

  class PresenceServiceError extends Error {
    code: string;
    status: number;

    constructor(code: string, message: string, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  vi.doMock("~/lib/presence-service.server", () => ({
    addPresenceSourceTarget: vi.fn(),
    createPresenceEntity: vi.fn(),
    deletePresenceEntity,
    pollPresenceSourceTarget,
    PresenceServiceError,
  }));

  return { deletePresenceEntity };
}

function pollSourceRequest(url: string) {
  const formData = new FormData();
  formData.set("intent", "poll-source");
  formData.set("targetId", "target-1");
  return new Request(url, {
    method: "POST",
    body: formData,
  });
}

function deleteEntityRequest(url: string, entityId?: string) {
  const formData = new FormData();
  formData.set("intent", "delete-entity");
  if (entityId) formData.set("entityId", entityId);
  return new Request(url, {
    method: "POST",
    body: formData,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("presence desk routes", () => {
  it("renders repositioned Presence Desk index copy", async () => {
    vi.resetModules();
    await mockRouter({
      snapshot: { entities: [], recentItems: [] },
      plan: "starter",
      limits: { maxTrackedEntities: 5, maxWebsiteSourcesPerEntity: 3 },
      access: { rolloutState: "ga", allowed: true },
      selfAllowed: true,
      competitorAllowed: true,
      connectors: [],
      sourceCoverage: {
        self: [
          {
            sourceId: "website",
            label: "Website / open web",
            status: "available",
            coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
            reasonCode: null,
            reasonMessage: null,
            actionNeeded: "Add a source target",
            connectorId: "website",
          },
          {
            sourceId: "youtube",
            label: "YouTube",
            status: "planned",
            coverageLabel: "UNAVAILABLE",
            reasonCode: "api_not_configured",
            reasonMessage: "YouTube tracking requires official API credentials.",
            actionNeeded: "Not available yet",
            connectorId: null,
          },
        ],
        competitor: [
          {
            sourceId: "website",
            label: "Website / open web",
            status: "available",
            coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
            reasonCode: null,
            reasonMessage: null,
            actionNeeded: "Add a source target",
            connectorId: "website",
          },
          {
            sourceId: "youtube",
            label: "YouTube",
            status: "planned",
            coverageLabel: "UNAVAILABLE",
            reasonCode: "api_not_configured",
            reasonMessage: "YouTube tracking requires official API credentials.",
            actionNeeded: "Not available yet",
            connectorId: null,
          },
        ],
      },
      partialDataNotice: null,
      userEmail: "owner@example.com",
    });

    const route = await import("~/routes/app.presence");
    const html = renderToStaticMarkup(createElement(route.default));
    expect(html).toContain("Presence Desk");
    expect(html).toContain("Proof-backed entity tracking");
    expect(html).toContain("Declared sources");
    expect(html).toContain("Your brand");
    expect(html).toContain("Competitors");
    expect(html).toContain("Planned");
    expect(html).not.toContain("whole-internet scanning");
  });

  it("does not render retained unsupported social targets as active index coverage", async () => {
    vi.resetModules();
    await mockRouter({
      snapshot: {
        entities: [
          {
            entity: {
              id: "entity-1",
              label: "Acme Corp",
              trackingMode: "competitor",
              updatedAt: "2026-07-02T00:00:00.000Z",
            },
            sources: [
              {
                id: "target-x",
                connectorId: "x",
                coverageLabel: "OFFICIAL_PUBLIC_API",
              },
            ],
          },
        ],
        recentItems: [],
      },
      plan: "starter",
      limits: { maxTrackedEntities: 5, maxWebsiteSourcesPerEntity: 3 },
      access: { rolloutState: "ga", allowed: true },
      selfAllowed: true,
      competitorAllowed: true,
      connectors: [],
      sourceCoverage: {
        self: [],
        competitor: [],
      },
      partialDataNotice: null,
      userEmail: "owner@example.com",
    });

    const route = await import("~/routes/app.presence");
    const html = renderToStaticMarkup(createElement(route.default));
    expect(html).toContain("Website source not configured");
    expect(html).not.toContain("Official public API");
  });

  it("renders entity brief and source coverage on detail route", async () => {
    vi.resetModules();
    await mockRouter({
      entity: {
        id: "entity-1",
        label: "Acme Corp",
        trackingMode: "competitor",
        canonicalUrl: "https://acme.example",
      },
      sources: [
        {
          id: "target-1",
          connectorId: "website",
          coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
          targetUrl: "https://acme.example/blog",
          targetHandle: null,
        },
      ],
      pollableSources: [
        {
          id: "target-1",
          connectorId: "website",
          coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
          targetUrl: "https://acme.example/blog",
          targetHandle: null,
        },
      ],
      items: [],
      compareEntities: [],
      sourceCoverage: [
        {
          sourceId: "website",
          label: "Website / open web",
          status: "connected",
          coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
          reasonCode: null,
          reasonMessage: null,
          actionNeeded: null,
          connectorId: "website",
        },
        {
          sourceId: "amazon",
          label: "Amazon marketplace",
          status: "manual_only",
          coverageLabel: "LIMITED_COVERAGE",
          reasonCode: "manual_proof_required",
          reasonMessage: "Automated Amazon marketplace monitoring is not launched.",
          actionNeeded: "Add manual proof",
          connectorId: null,
        },
      ],
      brief: {
        state: "queued",
        headline: "Ready for first check",
        summary: "Website sources are configured for Acme Corp.",
        proofStrength: "Awaiting first poll",
        sourceConfidence: "Moderate — public web best effort",
        nextAction: { label: "Check website source now" },
        recentChanges: [],
        sourceCoverage: [],
        lastPollAt: null,
        lastChangeAt: null,
      },
    });

    const route = await import("~/routes/app.presence.$entityId");
    const html = renderToStaticMarkup(createElement(route.default));
    expect(html).toContain("Entity brief");
    expect(html).toContain("Ready for first check");
    expect(html).toContain("All declared sources");
    expect(html).toContain("Manual proof only");
  });

  it("does not render retained unsupported social targets as checkable", async () => {
    vi.resetModules();
    await mockRouter({
      entity: {
        id: "entity-1",
        label: "Acme Corp",
        trackingMode: "competitor",
        canonicalUrl: "https://acme.example",
      },
      sources: [
        {
          id: "target-x",
          connectorId: "x",
          coverageLabel: "OFFICIAL_PUBLIC_API",
          targetUrl: null,
          targetHandle: "acme",
        },
      ],
      pollableSources: [],
      items: [],
      compareEntities: [],
      sourceCoverage: [
        {
          sourceId: "x",
          label: "X",
          status: "unavailable",
          coverageLabel: "UNAVAILABLE",
          reasonCode: "poll_not_implemented",
          reasonMessage: "X polling is not active for customer-facing coverage yet.",
          actionNeeded: null,
          connectorId: "x",
        },
      ],
      brief: {
        state: "not_enough_data",
        headline: "Add a website source to start",
        summary: "Acme Corp has no website or open-web sources yet.",
        proofStrength: "No proof yet",
        sourceConfidence: "Unavailable",
        nextAction: { label: "Add website source" },
        recentChanges: [],
        sourceCoverage: [],
        lastPollAt: null,
        lastChangeAt: null,
      },
    });

    const route = await import("~/routes/app.presence.$entityId");
    const html = renderToStaticMarkup(createElement(route.default));
    expect(html).toContain("No checkable website targets yet");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Check now");
  });

  it("does not render plan-gated website targets as checkable", async () => {
    vi.resetModules();
    await mockRouter({
      entity: {
        id: "entity-1",
        label: "Acme Corp",
        trackingMode: "competitor",
        canonicalUrl: "https://acme.example",
      },
      sources: [
        {
          id: "target-1",
          connectorId: "website",
          coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
          targetUrl: "https://acme.example/blog",
          targetHandle: null,
        },
      ],
      pollableSources: [],
      items: [],
      compareEntities: [],
      sourceCoverage: [
        {
          sourceId: "website",
          label: "Website / open web",
          status: "unavailable",
          coverageLabel: "UNAVAILABLE",
          reasonCode: "mode_not_in_plan",
          reasonMessage: "This entity mode is not included in the current plan.",
          actionNeeded: "Upgrade plan to enable this entity type",
          connectorId: "website",
        },
      ],
      brief: {
        state: "source_unavailable",
        headline: "Website source unavailable",
        summary: "This entity mode is not included in the current plan.",
        proofStrength: "No active proof path",
        sourceConfidence: "Unavailable",
        nextAction: { label: "Upgrade plan to enable this entity type" },
        recentChanges: [],
        sourceCoverage: [],
        lastPollAt: null,
        lastChangeAt: null,
      },
    });

    const route = await import("~/routes/app.presence.$entityId");
    const html = renderToStaticMarkup(createElement(route.default));
    expect(html).toContain("No checkable website targets yet");
    expect(html).not.toContain("Check now");
  });

  it("returns an error action response when an index manual poll fails", async () => {
    vi.resetModules();
    const pollPresenceSourceTarget = vi.fn(async () => ({
      target: { connectorId: "website" },
      pollResult: {
        ok: false,
        items: [],
        errorCode: "fetch_failed",
        errorMessage: "Could not fetch the website.",
      },
      upsertStats: { inserted: 0, updated: 0 },
      reconcileStats: { tombstoned: 0 },
    }));
    mockPresenceActionDeps(pollPresenceSourceTarget);

    const route = await import("~/routes/app.presence");
    const result = await route.action({
      context: { cloudflare: { env: {} } },
      request: pollSourceRequest("http://localhost/app/presence"),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "poll-source",
      targetId: "target-1",
      message: "Could not fetch the website.",
    });
    expect(pollPresenceSourceTarget).toHaveBeenCalledWith({}, "user-1", "target-1");
  });

  it("reports inserted, updated, and removed counts when an index manual poll succeeds", async () => {
    vi.resetModules();
    const pollPresenceSourceTarget = vi.fn(async () => ({
      target: { connectorId: "website" },
      pollResult: { ok: true, items: [] },
      upsertStats: { inserted: 1, updated: 3 },
      reconcileStats: { tombstoned: 2 },
    }));
    mockPresenceActionDeps(pollPresenceSourceTarget);

    const route = await import("~/routes/app.presence");
    const result = await route.action({
      context: { cloudflare: { env: {} } },
      request: pollSourceRequest("http://localhost/app/presence"),
    } as never);

    expect(result).toEqual({
      ok: true,
      intent: "poll-source",
      targetId: "target-1",
      message: "Checked website: 1 new, 3 updated, 2 removed.",
    });
    expect(pollPresenceSourceTarget).toHaveBeenCalledWith({}, "user-1", "target-1");
  });

  it("returns an error action response when a detail manual poll fails", async () => {
    vi.resetModules();
    const pollPresenceSourceTarget = vi.fn(async () => ({
      target: { connectorId: "website" },
      pollResult: {
        ok: false,
        items: [],
        errorCode: "robots_disallowed",
        errorMessage: "robots.txt disallows crawling the requested path.",
      },
      upsertStats: { inserted: 0, updated: 0 },
      reconcileStats: { tombstoned: 0 },
    }));
    mockPresenceActionDeps(pollPresenceSourceTarget);

    const route = await import("~/routes/app.presence.$entityId");
    const result = await route.action({
      context: { cloudflare: { env: {} } },
      params: { entityId: "entity-1" },
      request: pollSourceRequest("http://localhost/app/presence/entity-1"),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "poll-source",
      targetId: "target-1",
      message: "robots.txt disallows crawling the requested path.",
    });
    expect(pollPresenceSourceTarget).toHaveBeenCalledWith({}, "user-1", "target-1");
  });

  it("reports inserted, updated, and removed counts when a detail manual poll succeeds", async () => {
    vi.resetModules();
    const pollPresenceSourceTarget = vi.fn(async () => ({
      target: { connectorId: "website" },
      pollResult: { ok: true, items: [] },
      upsertStats: { inserted: 1, updated: 3 },
      reconcileStats: { tombstoned: 2 },
    }));
    mockPresenceActionDeps(pollPresenceSourceTarget);

    const route = await import("~/routes/app.presence.$entityId");
    const result = await route.action({
      context: { cloudflare: { env: {} } },
      params: { entityId: "entity-1" },
      request: pollSourceRequest("http://localhost/app/presence/entity-1"),
    } as never);

    expect(result).toEqual({
      ok: true,
      intent: "poll-source",
      targetId: "target-1",
      message: "Polled: 1 new, 3 updated, 2 removed.",
    });
    expect(pollPresenceSourceTarget).toHaveBeenCalledWith({}, "user-1", "target-1");
  });

  it("redirects to the Presence list after deleting an entity from detail", async () => {
    vi.resetModules();
    const deletePresenceEntity = vi.fn(async () => {});
    mockPresenceActionDeps(vi.fn(), deletePresenceEntity);

    const route = await import("~/routes/app.presence.$entityId");
    const result = await route.action({
      context: { cloudflare: { env: {} } },
      params: { entityId: "entity-1" },
      request: deleteEntityRequest("http://localhost/app/presence/entity-1"),
    } as never);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect((result as Response).headers.get("location")).toBe(
      "/app/presence?notice=entity-deleted",
    );
    expect(deletePresenceEntity).toHaveBeenCalledWith({}, "user-1", "entity-1");
  });

  it("restores accessible deletion feedback from the redirect query on the Presence list", async () => {
    vi.resetModules();
    const route = await import("~/routes/app.presence");

    expect(
      route.readPresenceRedirectFeedback(
        new Request("http://localhost/app/presence?notice=entity-deleted"),
      ),
    ).toEqual({ ok: true, message: "Entity deleted." });
    expect(
      route.readPresenceRedirectFeedback(new Request("http://localhost/app/presence")),
    ).toBeNull();
  });

  it("renders the restored deletion notice in the list page live region", async () => {
    vi.resetModules();
    await mockRouter({
      snapshot: { entities: [], recentItems: [] },
      plan: "starter",
      limits: { maxTrackedEntities: 5, maxWebsiteSourcesPerEntity: 3 },
      access: { rolloutState: "ga", allowed: true },
      selfAllowed: true,
      competitorAllowed: true,
      connectors: [],
      sourceCoverage: { self: [], competitor: [] },
      partialDataNotice: null,
      redirectFeedback: { ok: true, message: "Entity deleted." },
      userEmail: "owner@example.com",
    });

    const route = await import("~/routes/app.presence");
    const markup = renderToStaticMarkup(createElement(route.default));
    expect(markup).toContain("Entity deleted.");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
  });
});
