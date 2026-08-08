import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeedbackStrip } from "~/components/workspace/feedback-strip";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

async function mockRouter(loaderData: unknown, actionData: unknown = null) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    return {
      ...actual,
      useLoaderData: () => loaderData,
      useActionData: () => actionData,
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
  it("uses loader data for the entity detail page title", async () => {
    const { meta } = await import("~/routes/app.presence.$entityId");

    expect(meta({
      loaderData: { entity: { label: "Acme Corp" } },
    } as never)).toEqual([{ title: "Acme Corp | Presence" }]);
    expect(meta({ loaderData: undefined } as never)).toEqual([
      { title: "Presence | Five to Nine" },
    ]);
  });

  it("renders the quiet Presence instrument and honest source coverage", async () => {
    vi.resetModules();
    await mockRouter({
      snapshot: { entities: [], recentItems: [] },
      plan: "starter",
      limits: {
        maxTrackedEntities: 5,
        maxSelfEntities: 2,
        maxCompetitorEntities: 5,
        maxWebsiteSourcesPerEntity: 3,
      },
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
    expect(html).toContain(">Presence<");
    expect(html).toContain("Start with a website");
    expect(html).toContain("Source coverage");
    expect(html).toContain("Your brand");
    expect(html).toContain("Competitors");
    expect(html).toContain("Planned");
    expect(
      html.match(/This source is not available for customer checks yet\./g) ?? [],
    ).toHaveLength(1);
    expect(html).not.toContain("f9-wk-panel");
    expect(html).not.toContain("PRESENCE DESK");
    expect(html).not.toContain("whole-internet scanning");
  });

  it("keeps divergent self and competitor coverage reasons labelled and sanitized", async () => {
    vi.resetModules();
    await mockRouter({
      snapshot: { entities: [], recentItems: [] },
      plan: "scout",
      limits: {
        maxTrackedEntities: 5,
        maxSelfEntities: 0,
        maxCompetitorEntities: 5,
        maxWebsiteSourcesPerEntity: 3,
      },
      access: { rolloutState: "ga", allowed: true },
      selfAllowed: false,
      competitorAllowed: true,
      connectors: [],
      sourceCoverage: {
        self: [
          {
            sourceId: "website",
            label: "Website / open web",
            status: "unavailable",
            coverageLabel: "UNAVAILABLE",
            reasonCode: "mode_not_in_plan",
            reasonMessage: "raw provider detail must not leak",
            actionNeeded: "internal detail",
            connectorId: "website",
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
        ],
      },
      partialDataNotice: null,
      redirectFeedback: null,
      userEmail: "owner@example.com",
    });

    const route = await import("~/routes/app.presence");
    const html = renderToStaticMarkup(createElement(route.default));
    expect(html).toContain("Your brand: This entity type is not included in your current plan.");
    expect(html).toContain("Competitors: Available");
    expect(html).not.toContain("raw provider detail must not leak");
    expect(html).not.toContain("internal detail");
  });

  it("announces success and failure feedback atomically", () => {
    const success = renderToStaticMarkup(
      createElement(FeedbackStrip, { children: "Saved.", label: "Done" }),
    );
    const failure = renderToStaticMarkup(
      createElement(FeedbackStrip, {
        children: "Could not save.",
        label: "Not done",
        tone: "bad",
      }),
    );
    expect(success).toContain('role="status"');
    expect(success).toContain('aria-live="polite"');
    expect(success).toContain('aria-atomic="true"');
    expect(failure).toContain('role="alert"');
    expect(failure).toContain('aria-live="assertive"');
    expect(failure).toContain('aria-atomic="true"');
  });

  it("routes action feedback through the atomic strip before redirect feedback", async () => {
    vi.resetModules();
    await mockRouter(
      {
        snapshot: { entities: [], recentItems: [] },
        plan: "starter",
        limits: {
          maxTrackedEntities: 5,
          maxSelfEntities: 2,
          maxCompetitorEntities: 5,
          maxWebsiteSourcesPerEntity: 3,
        },
        access: { rolloutState: "ga", allowed: true },
        selfAllowed: true,
        competitorAllowed: true,
        connectors: [],
        sourceCoverage: { self: [], competitor: [] },
        partialDataNotice: null,
        redirectFeedback: { ok: true, message: "Entity deleted." },
        userEmail: "owner@example.com",
      },
      { ok: false, message: "The latest source check could not complete." },
    );

    const route = await import("~/routes/app.presence");
    const html = renderToStaticMarkup(createElement(route.default));
    expect(html).toContain("The latest source check could not complete.");
    expect(html).not.toContain("Entity deleted.");
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('aria-atomic="true"');
  });

  it.each([
    {
      plan: "free",
      selfAllowed: false,
      competitorAllowed: false,
      expectedAction: "Upgrade to Scout",
      expectedOptions: 0,
    },
    {
      plan: "scout",
      selfAllowed: false,
      competitorAllowed: true,
      expectedAction: "Start tracking",
      expectedOptions: 1,
    },
    {
      plan: "starter",
      selfAllowed: true,
      competitorAllowed: true,
      expectedAction: "Start tracking",
      expectedOptions: 2,
    },
    {
      plan: "agency",
      selfAllowed: true,
      competitorAllowed: true,
      expectedAction: "Start tracking",
      expectedOptions: 2,
    },
  ])(
    "renders exactly one primary action for the $plan entitlement state",
    async ({ plan, selfAllowed, competitorAllowed, expectedAction, expectedOptions }) => {
      vi.resetModules();
      await mockRouter({
        snapshot: { entities: [], recentItems: [] },
        plan,
        limits: {
          maxTrackedEntities: plan === "free" ? 0 : 8,
          maxSelfEntities: plan === "free" ? 0 : 2,
          maxCompetitorEntities: plan === "free" ? 0 : 8,
          maxWebsiteSourcesPerEntity: plan === "free" ? 0 : 4,
        },
        access: { rolloutState: "ga", allowed: true },
        selfAllowed,
        competitorAllowed,
        connectors: [],
        sourceCoverage: { self: [], competitor: [] },
        partialDataNotice: null,
        redirectFeedback: null,
        userEmail: "owner@example.com",
      });

      const route = await import("~/routes/app.presence");
      const html = renderToStaticMarkup(createElement(route.default));
      expect(html.match(/class="f9-wk-btn"/g) ?? []).toHaveLength(1);
      const primaryAction = html.match(
        /class="f9-wk-btn"[^>]*>([\s\S]*?)<\/(?:a|button)>/,
      )?.[1] ?? "";
      expect(primaryAction).toContain(expectedAction);
      const trackingModeOptions = html.match(
        /<select[^>]*name="trackingMode"[^>]*>([\s\S]*?)<\/select>/,
      )?.[1] ?? "";
      expect(trackingModeOptions.match(/<option/g) ?? []).toHaveLength(expectedOptions);
      if (plan === "free") {
        expect(html).not.toContain('name="trackingMode"');
        expect(html).toContain("read-only");
      } else {
        expect(html).toContain('name="trackingMode"');
      }
    },
  );

  it("turns a full paid-plan instrument into a capacity-specific primary action", async () => {
    vi.resetModules();
    const entities = Array.from({ length: 8 }, (_, index) => ({
      entity: {
        id: `entity-${index}`,
        label: `Tracked entity ${index + 1}`,
        trackingMode: "competitor" as const,
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      sources: [],
    }));
    await mockRouter({
      snapshot: { entities, recentItems: [] },
      plan: "starter",
      limits: {
        maxTrackedEntities: 8,
        maxSelfEntities: 2,
        maxCompetitorEntities: 8,
        maxWebsiteSourcesPerEntity: 4,
      },
      access: { rolloutState: "ga", allowed: true },
      selfAllowed: true,
      competitorAllowed: true,
      connectors: [],
      sourceCoverage: { self: [], competitor: [] },
      partialDataNotice: null,
      redirectFeedback: null,
      userEmail: "owner@example.com",
    });

    const route = await import("~/routes/app.presence");
    const html = renderToStaticMarkup(createElement(route.default));
    expect(html.match(/class="f9-wk-btn"/g) ?? []).toHaveLength(1);
    expect(html).toContain("All 8 tracked entity slots on the Starter plan are in use.");
    expect(html).toContain("Review tracked entities");
    expect(html).not.toContain('name="trackingMode"');
    expect(html).not.toContain("read-only on the Starter plan");
    // BL-034: the locked panel is ordinary prose, not a live region. Feedback
    // is announced by the shared strip, so a second announcing role here would
    // double-speak on every render.
    expect(html).not.toMatch(/<div class="f9-presence-lock"[^>]*role=/);
  });

  it("omits a tracking mode whose per-mode capacity is exhausted", async () => {
    vi.resetModules();
    const entities = Array.from({ length: 2 }, (_, index) => ({
      entity: {
        id: `self-${index}`,
        label: `Brand ${index + 1}`,
        trackingMode: "self" as const,
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      sources: [],
    }));
    await mockRouter({
      snapshot: { entities, recentItems: [] },
      plan: "starter",
      limits: {
        maxTrackedEntities: 8,
        maxSelfEntities: 2,
        maxCompetitorEntities: 8,
        maxWebsiteSourcesPerEntity: 4,
      },
      access: { rolloutState: "ga", allowed: true },
      selfAllowed: true,
      competitorAllowed: true,
      connectors: [],
      sourceCoverage: { self: [], competitor: [] },
      partialDataNotice: null,
      redirectFeedback: null,
      userEmail: "owner@example.com",
    });

    const route = await import("~/routes/app.presence");
    const html = renderToStaticMarkup(createElement(route.default));
    const trackingModeOptions = html.match(
      /<select[^>]*name="trackingMode"[^>]*>([\s\S]*?)<\/select>/,
    )?.[1] ?? "";
    expect(trackingModeOptions).not.toContain("Your brand");
    expect(trackingModeOptions).toContain("Competitor");
    expect(html).toContain('value="competitor"');
    expect(html).not.toContain("entity-type limits");
  });

  it("keeps a downgraded workspace slot count at zero", async () => {
    vi.resetModules();
    await mockRouter({
      snapshot: {
        entities: [
          {
            entity: {
              id: "entity-retained",
              label: "Retained competitor",
              trackingMode: "competitor",
              updatedAt: "2026-07-02T00:00:00.000Z",
            },
            sources: [],
          },
        ],
        recentItems: [],
      },
      plan: "free",
      limits: {
        maxTrackedEntities: 0,
        maxSelfEntities: 0,
        maxCompetitorEntities: 0,
        maxWebsiteSourcesPerEntity: 0,
      },
      access: { rolloutState: "ga", allowed: true },
      selfAllowed: false,
      competitorAllowed: false,
      connectors: [],
      sourceCoverage: { self: [], competitor: [] },
      partialDataNotice: null,
      redirectFeedback: null,
      userEmail: "owner@example.com",
    });

    const route = await import("~/routes/app.presence");
    const html = renderToStaticMarkup(createElement(route.default));
    expect(html).toContain("0 entity slots left");
    expect(html).not.toContain("-1 entity slots left");
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
      limits: {
        maxTrackedEntities: 5,
        maxSelfEntities: 2,
        maxCompetitorEntities: 5,
        maxWebsiteSourcesPerEntity: 3,
      },
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
    expect(html).toContain("No checkable website target yet");
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
    expect(html).toContain("No checkable website target yet");
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
			limits: {
        maxTrackedEntities: 5,
        maxSelfEntities: 2,
        maxCompetitorEntities: 5,
        maxWebsiteSourcesPerEntity: 3,
      },
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
