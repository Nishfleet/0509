import { describe, expect, it, vi } from "vitest";

import {
  createContext,
  deliveryTargets,
  session,
  setupWatchlistsRouteTestIsolation,
  watchlist,
  watchlistDeliveryConfig,
  workspaceDeliveryConfig,
} from "./helpers/watchlists-route-fixtures";

setupWatchlistsRouteTestIsolation();

describe("watchlists route actions", () => {
  it("blocks every delivery management intent for workspace members before loading target data", async () => {
    const requireWorkspaceSession = vi.fn().mockResolvedValue({
      session,
      workspaceUserId: session.user.id,
      isMember: true,
      ownerName: "Owner",
    });

    vi.doMock("~/lib/auth.server", () => ({ requireWorkspaceSession }));
    const { action } = await import("~/routes/app.watchlists");

    for (const intent of [
      "save-delivery-config",
      "add-delivery-target",
      "send-test-email",
      "toggle-delivery-target",
    ]) {
      const formData = new FormData();
      formData.set("intent", intent);
      formData.set("targetId", "owner-target");
      const result = await action({
        context: createContext(),
        request: new Request("http://localhost/app/watchlists", { method: "POST", body: formData }),
      } as never);

      expect("data" in result).toBe(true);
      if (!("data" in result)) {
        throw new Error("Expected a status-aware delivery authorization response.");
      }
      expect(result.data).toEqual({
        ok: false,
        error: undefined,
        message: "Only the account owner can manage delivery settings and targets for this workspace.",
      });
      expect(result.init?.status).toBe(403);
    }
    expect(requireWorkspaceSession).toHaveBeenCalledTimes(4);
  });

  it("keeps send-test-email responses free of recipient addresses", async () => {
    const target = deliveryTargets[0];
    const sendDeliveryTestEmail = vi.fn().mockResolvedValue(true);
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById: vi.fn().mockResolvedValue(target),
    }));
    vi.doMock("~/lib/delivery.server", () => ({ sendDeliveryTestEmail }));
    vi.doMock("~/lib/plan-feature-gate.server", () => ({
      requireDeliveryConfigSave: vi.fn().mockResolvedValue({ ok: true, plan: "starter" }),
      planFeatureDeniedActionResult: vi.fn(),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "send-test-email");
    formData.set("targetId", target.id);
    formData.set("requestToken", "00000000-0000-4000-8000-000000000000");
    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", { method: "POST", body: formData }),
    } as never);

    expect(result).toEqual({
      ok: true,
      message: "Test email sent — if it doesn't arrive within a few minutes, check your inbox and spam folder.",
    });
    expect(JSON.stringify(result)).not.toContain(target.targetValue);
    expect(sendDeliveryTestEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      email: target.targetValue,
      targetId: target.id,
      idempotencyKey: `delivery-test:user-1:${target.id}:00000000-0000-4000-8000-000000000000`,
    }));
  });

  it("rejects missing or malformed test-email request tokens before reading targets", async () => {
    const getDeliveryTargetById = vi.fn();
    const sendDeliveryTestEmail = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({ getDeliveryTargetById }));
    vi.doMock("~/lib/delivery.server", () => ({ sendDeliveryTestEmail }));

    const { action } = await import("~/routes/app.watchlists");
    for (const requestToken of ["", "not-a-route-token"]) {
      const formData = new FormData();
      formData.set("intent", "send-test-email");
      formData.set("targetId", "target-1");
      formData.set("requestToken", requestToken);

      await expect(action({
        context: createContext(),
        request: new Request("http://localhost/app/watchlists", { method: "POST", body: formData }),
      } as never)).resolves.toEqual({
        ok: false,
        message: "This test request expired. Refresh the page and try again.",
      });
    }

    expect(getDeliveryTargetById).not.toHaveBeenCalled();
    expect(sendDeliveryTestEmail).not.toHaveBeenCalled();
  });

  it("blocks manual refresh on the free plan and points at plans", async () => {
    const runWatchlistManual = vi.fn();
    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: class extends Error {},
    }));
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      checkPlanLimit: vi.fn(),
    }));
    vi.doMock("~/lib/monitoring.server", () => ({
      runWatchlistManual,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "refresh-watchlist");
    formData.set("watchlistId", "watch-1");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({ ok: false, error: "plan_limit_exceeded" });
    // the usage-billed live scan must never run for a free workspace
    expect(runWatchlistManual).not.toHaveBeenCalled();
  });

  it("returns a structured agency-share gate before creating a share link", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/plan-feature-gate.server", () => ({
      requireWorkspacePlanFeature: vi
        .fn()
        .mockResolvedValue({ ok: false, plan: "starter" }),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "share-watchlist");
    formData.set("watchlistId", "watch-1");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      error: "plan_gated",
      feature: "share_links",
      plan: "starter",
      message: "Share links are included on Starter and Agency plans.",
    });
    vi.doUnmock("~/lib/plan-feature-gate.server");
  });

  it("saves the free weekly digest toggle (free weekly watch)", async () => {
    const upsertWatchlistDeliveryConfig = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/env.server", () => ({
      isWhatsAppProviderConfigured: vi.fn(() => false),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi
        .fn()
        .mockResolvedValue(workspaceDeliveryConfig),
      upsertWatchlistDeliveryConfig,
    }));
    vi.doMock("~/lib/plan-feature-gate.server", () => ({
      planFeatureDeniedActionResult: (feature: string, plan: string) => ({
        ok: false,
        error: "plan_gated",
        feature,
        plan,
        message: "This capability is not included in your current plan.",
      }),
      requireDeliveryConfigSave: vi
        .fn()
        .mockResolvedValue({ ok: true, plan: "free" }),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "save-delivery-config");
    formData.set("watchlistId", "watch-1");
    formData.set("digestEnabled", "on");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    // Free carries the weekly_digest entitlement now, so the digest toggle
    // saves instead of plan-gating (opt-out must work for free users).
    expect(result).toMatchObject({
      ok: true,
    });
    expect(upsertWatchlistDeliveryConfig).toHaveBeenCalled();
    vi.doUnmock("~/lib/plan-feature-gate.server");
    vi.doUnmock("~/lib/env.server");
    vi.doUnmock("~/lib/data.server");
    vi.doUnmock("~/lib/auth.server");
    vi.doUnmock("~/lib/context.server");
  });

  it("returns a friendly message when manual refresh is rate limited", async () => {
    class MockCommercialDiscoveryError extends Error {
      failureClass = "rate_limited" as const;
      retryAfterSeconds: number | null = null;

      constructor(message: string) {
        super(message);
        this.name = "CommercialDiscoveryError";
      }
    }

    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit: vi.fn(),
    }));
    vi.doMock("~/lib/monitoring.server", () => ({
      runWatchlistManual: vi
        .fn()
        .mockRejectedValue(
          new MockCommercialDiscoveryError("Rate limit exceeded"),
        ),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "refresh-watchlist");
    formData.set("watchlistId", "watch-1");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "Competitor ad checks are temporarily rate limited. Scheduled checks will keep retrying.",
      ok: false,
    });
  });

  it("includes the retry window when manual refresh receives one", async () => {
    class MockCommercialDiscoveryError extends Error {
      failureClass = "rate_limited" as const;
      retryAfterSeconds: number | null;

      constructor(message: string, retryAfterSeconds: number) {
        super(message);
        this.name = "CommercialDiscoveryError";
        this.retryAfterSeconds = retryAfterSeconds;
      }
    }

    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit: vi.fn(),
    }));
    vi.doMock("~/lib/monitoring.server", () => ({
      runWatchlistManual: vi
        .fn()
        .mockRejectedValue(
          new MockCommercialDiscoveryError("Rate limit exceeded", 7200),
        ),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "refresh-watchlist");
    formData.set("watchlistId", "watch-1");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "Competitor ad checks are temporarily rate limited. Retry after about 2h. Scheduled checks will keep retrying.",
      ok: false,
    });
  });

  it("does not refresh an inactive watchlist left behind by retargeting", async () => {
    const runWatchlistManual = vi.fn();
    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue({
        ...watchlist,
        isActive: false,
      }),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit: vi.fn(),
    }));
    vi.doMock("~/lib/monitoring.server", () => ({
      runWatchlistManual,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "refresh-watchlist");
    formData.set("watchlistId", "watch-1");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "We couldn't find that watchlist. Refresh the page and try again.",
      ok: false,
    });
    expect(runWatchlistManual).not.toHaveBeenCalled();
  });

  it("saves watchlist delivery settings with parsed quiet hours and timezone", async () => {
    const upsertWatchlistDeliveryConfig = vi
      .fn()
      .mockResolvedValue(watchlistDeliveryConfig);

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi
        .fn()
        .mockResolvedValue(workspaceDeliveryConfig),
      upsertWatchlistDeliveryConfig,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit: vi.fn(),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "save-delivery-config");
    formData.set("watchlistId", "watch-1");
    formData.set("sensitivityMode", "aggressive");
    formData.set("instantEnabled", "on");
    formData.set("digestEnabled", "on");
    formData.set("emailEnabled", "on");
    formData.set("timezone", "Asia/Kolkata");
    formData.set("quietHoursStart", "22");
    formData.set("quietHoursEnd", "8");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery settings updated.",
      ok: true,
    });
    expect(upsertWatchlistDeliveryConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        watchlistId: "watch-1",
        userId: "user-1",
        sensitivityMode: "aggressive",
        instantEnabled: true,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        timezone: "Asia/Kolkata",
        quietHours: {
          startHour: 22,
          endHour: 8,
        },
      }),
    );
  });

  it("rejects an invalid delivery timezone before persistence", async () => {
    const upsertWatchlistDeliveryConfig = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(workspaceDeliveryConfig),
      upsertWatchlistDeliveryConfig,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit: vi.fn(),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "save-delivery-config");
    formData.set("watchlistId", "watch-1");
    formData.set("emailEnabled", "on");
    formData.set("timezone", "Not/AZone");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", { method: "POST", body: formData }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Enter a valid IANA timezone, such as America/New_York or UTC.",
    });
    expect(upsertWatchlistDeliveryConfig).not.toHaveBeenCalled();
  });

  it("preserves dormant WhatsApp settings and applies live Slack/Teams toggles on delivery saves", async () => {
    const upsertWatchlistDeliveryConfig = vi
      .fn()
      .mockResolvedValue(watchlistDeliveryConfig);

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue({
        ...watchlistDeliveryConfig,
        whatsappEnabled: true,
        slackEnabled: true,
        teamsEnabled: true,
      }),
      getWorkspaceDeliveryConfig: vi
        .fn()
        .mockResolvedValue(workspaceDeliveryConfig),
      upsertWatchlistDeliveryConfig,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit: vi.fn(),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "save-delivery-config");
    formData.set("watchlistId", "watch-1");
    formData.set("sensitivityMode", "balanced");
    formData.set("emailEnabled", "on");
    formData.set("slackEnabled", "on");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery settings updated.",
      ok: true,
    });
    expect(upsertWatchlistDeliveryConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        watchlistId: "watch-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        emailEnabled: true,
        // WhatsApp is still a dormant GA channel: its stored value is
        // preserved no matter what the form sends.
        whatsappEnabled: true,
        // Slack is live: the checked box applies.
        slackEnabled: true,
        // Teams is live but unchecked: it turns off.
        teamsEnabled: false,
      }),
    );
  });

  it("updates the selected watchlist competitor and name", async () => {
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...watchlist,
      name: "Mamaearth launch watch",
      targetId: "Mamaearth",
      targetLabel: "Mamaearth",
      targetCountry: null,
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Mamaearth launch watch");
    formData.set("targetLabel", "Mamaearth");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Watchlist updated.",
      ok: true,
    });
    expect(updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watch-1",
      expect.objectContaining({
        name: "Mamaearth launch watch",
        targetType: "advertiser",
        targetId: "Mamaearth",
        targetLabel: "Mamaearth",
        targetCountry: null,
      }),
    );
    expect(updateWatchlist.mock.calls[0][3].targetFingerprint).toMatch(
      /^fnv1a-/,
    );
  });

  it("redirects to the replacement watchlist when retargeting creates a new baseline", async () => {
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...watchlist,
      id: "watch-2",
      name: "Mamaearth launch watch",
      targetId: "Mamaearth",
      targetLabel: "Mamaearth",
      targetCountry: null,
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Mamaearth launch watch");
    formData.set("targetLabel", "Mamaearth");

    let redirectResponse: Response | null = null;
    try {
      await action({
        context: createContext(),
        request: new Request("http://localhost/app/watchlists", {
          method: "POST",
          body: formData,
        }),
      } as never);
    } catch (error) {
      redirectResponse = error as Response;
    }

    expect(redirectResponse?.status).toBe(302);
    expect(redirectResponse?.headers.get("Location")).toBe(
      "/app/watchlists?watchlist=watch-2",
    );
  });

  it("preserves direct competitor website proof tracking when editing a watchlist", async () => {
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...watchlist,
      name: "Nykaa launch watch",
      targetId: "https://nykaa.com",
      targetLabel: "Nykaa",
      targetCountry: null,
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue({
        ...watchlist,
        targetId: "https://nykaa.com",
        targetLabel: "Nykaa",
        targetCountry: null,
      }),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Nykaa launch watch");
    formData.set("competitorWebsite", "https://www.nykaa.com/?utm_source=meta");
    formData.set("targetLabel", "Nykaa");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Watchlist updated.",
      ok: true,
    });
    expect(updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watch-1",
      expect.objectContaining({
        name: "Nykaa launch watch",
        targetType: "advertiser",
        targetId: "https://nykaa.com",
        targetLabel: "Nykaa",
        targetCountry: null,
      }),
    );
    expect(updateWatchlist.mock.calls[0][3].targetFingerprint).toBe("fp-nykaa");
  });

  it("rejects an incomplete website when editing a watchlist", async () => {
    const updateWatchlist = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Samplebrand watch");
    formData.set("competitorWebsite", "samplebrand");
    formData.set("targetLabel", "Samplebrand");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "That website looks incomplete. Add the full domain, like brand.com.",
      ok: false,
    });
    expect(updateWatchlist).not.toHaveBeenCalled();
  });

  it("passes self tracking through watchlist edits", async () => {
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...watchlist,
      name: "Samplebrand watch",
      trackingRole: "self",
      targetId: "https://samplebrand.com",
      targetLabel: "Samplebrand",
      targetCountry: null,
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("trackingRole", "self");
    formData.set("name", "Samplebrand watch");
    formData.set("competitorWebsite", "samplebrand.com");
    formData.set("targetLabel", "Samplebrand");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Watchlist updated.",
      ok: true,
    });
    expect(updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watch-1",
      expect.objectContaining({
        name: "Samplebrand watch",
        targetId: "https://samplebrand.com",
        targetLabel: "Samplebrand",
        trackingRole: "self",
      }),
    );
  });

  it("keeps the existing fingerprint when only the tracking role changes", async () => {
    const countryWatchlist = {
      ...watchlist,
      targetId: "https://samplebrand.com",
      targetFingerprint: "existing-us-fingerprint",
      targetLabel: "Samplebrand",
      targetCountry: "US",
    };
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...countryWatchlist,
      trackingRole: "self",
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(countryWatchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("trackingRole", "self");
    formData.set("name", "Samplebrand watch");
    formData.set("competitorWebsite", "samplebrand.com");
    formData.set("targetLabel", "Samplebrand");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Watchlist updated.",
      ok: true,
    });
    expect(updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watch-1",
      expect.objectContaining({
        targetFingerprint: "existing-us-fingerprint",
        targetCountry: "US",
        trackingRole: "self",
      }),
    );
  });

  it("preserves saved-query targets and labels when editing a watchlist name", async () => {
    const savedQueryWatchlist = {
      ...watchlist,
      targetType: "saved_query" as const,
      targetId: "saved-query-1",
      targetFingerprint: "saved-query-fingerprint",
      targetLabel: "Nykaa launch searches",
      targetCountry: null,
    };
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...savedQueryWatchlist,
      name: "Renamed saved query watch",
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(savedQueryWatchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Renamed saved query watch");
    formData.set("targetLabel", "Renamed query label");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Watchlist updated.",
      ok: true,
    });
    expect(updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watch-1",
      expect.objectContaining({
        name: "Renamed saved query watch",
        targetType: "saved_query",
        targetId: "saved-query-1",
        targetFingerprint: "saved-query-fingerprint",
        targetLabel: "Nykaa launch searches",
        targetCountry: null,
      }),
    );
  });

  it("returns a friendly message when a watchlist edit duplicates another target", async () => {
    const updateWatchlist = vi
      .fn()
      .mockRejectedValue(new Error("watchlist_duplicate_target"));

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Duplicate watch");
    formData.set("targetLabel", "Nykaa");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Another active watchlist already tracks that competitor.",
      ok: false,
    });
  });

  it("blocks WhatsApp delivery targets while WhatsApp is not customer-facing", async () => {
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "add-delivery-target");
    formData.set("watchlistId", "watch-1");
    formData.set("channel", "whatsapp");
    formData.set("targetValue", "+919999999999");
    formData.set("explicitOptIn", "on");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "WhatsApp delivery isn’t available. Nothing was saved — use email delivery instead.",
      ok: false,
    });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("points watchlist-scoped Slack delivery targets to the Notifications page", async () => {
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "add-delivery-target");
    formData.set("watchlistId", "watch-1");
    formData.set("channel", "slack");
    formData.set("targetValue", "https://hooks.slack.test/services/fake");
    formData.set("explicitOptIn", "on");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "Connect Slack or Teams delivery from the Notifications page — watchlist-scoped webhook targets aren't supported.",
      ok: false,
    });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("pauses an existing watchlist delivery target", async () => {
    const upsertDeliveryTarget = vi.fn();
    const getDeliveryTargetById = vi.fn().mockResolvedValue(deliveryTargets[0]);

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getDeliveryTargetById,
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "toggle-delivery-target");
    formData.set("targetId", "target-email-1");
    formData.set("watchlistId", "forged-watchlist");
    formData.set("channel", "whatsapp");
    formData.set("targetValue", "forged@example.com");
    formData.set("isPaused", "false");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery target paused.",
      ok: true,
    });
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        watchlistId: "watch-1",
        userId: "user-1",
        channel: "email",
        targetValue: "owner@example.com",
        isPaused: true,
      }),
    );
    expect(getDeliveryTargetById).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      targetId: "target-email-1",
    });
  });

  it("resumes every unsubscribe-suppressed email target when the workspace default is re-opted", async () => {
    const defaultTarget = {
      ...deliveryTargets[0],
      id: "target-email-default",
      watchlistId: null,
      isOptedIn: false,
      isPaused: true,
      pausedAt: "2026-07-16T00:00:00.000Z",
      optedOutAt: "2026-07-16T00:00:00.000Z",
    };
    const getDeliveryTargetById = vi.fn().mockResolvedValue(defaultTarget);
    const resumeEmailTargetsForUserAndAddress = vi.fn().mockResolvedValue(2);
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn(),
      getDeliveryTargetById,
      resumeEmailTargetsForUserAndAddress,
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "toggle-delivery-target");
    formData.set("targetId", defaultTarget.id);

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery target resumed.",
      ok: true,
    });
    expect(resumeEmailTargetsForUserAndAddress).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      targetValue: "owner@example.com",
      source: "delivery_settings",
    });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("resumes every unsubscribe-suppressed email target when a watchlist target is re-opted", async () => {
    const watchlistTarget = {
      ...deliveryTargets[0],
      isOptedIn: false,
      isPaused: true,
      pausedAt: "2026-07-16T00:00:00.000Z",
      optedOutAt: "2026-07-16T00:00:00.000Z",
    };
    const getDeliveryTargetById = vi.fn().mockResolvedValue(watchlistTarget);
    const resumeEmailTargetsForUserAndAddress = vi.fn().mockResolvedValue(2);
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getDeliveryTargetById,
      resumeEmailTargetsForUserAndAddress,
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "toggle-delivery-target");
    formData.set("targetId", watchlistTarget.id);

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery target resumed.",
      ok: true,
    });
    expect(resumeEmailTargetsForUserAndAddress).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      targetValue: "owner@example.com",
      source: "delivery_settings",
    });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("resumes only the workspace default when it was merely paused", async () => {
    const defaultTarget = {
      ...deliveryTargets[0],
      id: "target-email-default",
      watchlistId: null,
      isOptedIn: true,
      isPaused: true,
      pausedAt: "2026-07-16T00:00:00.000Z",
      optedOutAt: null,
    };
    const getDeliveryTargetById = vi.fn().mockResolvedValue(defaultTarget);
    const resumeEmailTargetsForUserAndAddress = vi.fn();
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn(),
      getDeliveryTargetById,
      resumeEmailTargetsForUserAndAddress,
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "toggle-delivery-target");
    formData.set("targetId", defaultTarget.id);

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery target resumed.",
      ok: true,
    });
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        watchlistId: null,
        channel: "email",
        targetValue: "owner@example.com",
        isPaused: false,
        pausedAt: null,
        optedOutAt: null,
      }),
    );
    expect(resumeEmailTargetsForUserAndAddress).not.toHaveBeenCalled();
  });

  it("blocks toggling WhatsApp delivery targets while WhatsApp is not customer-facing", async () => {
    const upsertDeliveryTarget = vi.fn();
    const getDeliveryTargetById = vi.fn().mockResolvedValue({
      ...deliveryTargets[0],
      id: "target-whatsapp-1",
      channel: "whatsapp",
      targetValue: "+919999999999",
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getDeliveryTargetById,
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "toggle-delivery-target");
    formData.set("watchlistId", "watch-1");
    formData.set("channel", "whatsapp");
    formData.set("targetValue", "+919999999999");
    formData.set("isPaused", "true");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "WhatsApp delivery isn’t available. Nothing was saved — use email delivery instead.",
      ok: false,
    });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("points watchlist-scoped Slack delivery toggles to the Notifications page", async () => {
    const upsertDeliveryTarget = vi.fn();
    const getDeliveryTargetById = vi.fn().mockResolvedValue({
      ...deliveryTargets[0],
      id: "target-slack-1",
      channel: "slack",
      targetValue: "slack-target",
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getDeliveryTargetById,
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "toggle-delivery-target");
    formData.set("watchlistId", "watch-1");
    formData.set("channel", "slack");
    formData.set("targetValue", "https://hooks.slack.test/services/fake");
    formData.set("isPaused", "true");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "Manage Slack or Teams delivery from the Notifications page — watchlist-scoped webhook targets aren't supported.",
      ok: false,
    });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });
});
