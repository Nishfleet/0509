import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-04-02 18:30:00",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-04-03T00:00:00.000Z",
  },
};

function createContext(env: Record<string, unknown> = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

type MockUseLoaderData = () => unknown;

async function mockRouter(useLoaderData: MockUseLoaderData, useActionData: MockUseLoaderData = () => null) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      useActionData: vi.fn(useActionData),
      useLoaderData: vi.fn(useLoaderData),
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

describe("ops route", () => {
  it("allows an allowlisted operator to load the snapshot", async () => {
    const listBillingLifecycleReconciliationCandidates = vi.fn().mockResolvedValue([]);
    const listPendingPartialRefundReconciliations = vi.fn().mockResolvedValue([]);
    const listStaleDodoSubscriptionPlanChangeClaims = vi.fn().mockResolvedValue([]);
    const getOperatorSnapshot = vi.fn().mockResolvedValue({
      summary: {
        failingRuns: 1,
        stuckRuns: 0,
        failedProofs: 0,
        budgetBlockedProofs: 0,
        blockedTargets: 0,
        deliveryFailures: 0,
        deliveryAttention: 0,
        degradedWatchlists: 1,
        discoveryFailures: 0,
        discoveryProvidersNeedingAttention: 0,
      },
      failingRuns: [],
      stuckRuns: [],
      failedProofs: [],
      budgetBlockedProofs: [],
      blockedTargets: [],
      deliveryFailures: [],
      deliveryAttention: [],
      degradedWatchlists: [],
      discoveryFailures: [],
      discoveryProviders: [],
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
      getOperatorSnapshot,
      listBillingLifecycleReconciliationCandidates,
      listPendingPartialRefundReconciliations,
      listStaleDodoSubscriptionPlanChangeClaims,
    }));

    const { loader } = await import("~/routes/ops");
    const result = await loader({
      context: createContext({
        OPS_ALLOWLIST_EMAILS: "owner@example.com, teammate@example.com",
      }),
      request: new Request("http://localhost/ops"),
    } as never);

    expect(result).toEqual({
      snapshot: expect.objectContaining({
        summary: expect.objectContaining({
          failingRuns: 1,
        }),
      }),
      billingLifecycleCandidates: [],
      billingLifecycleWarning: null,
      stalePlanChangeClaims: [],
      planChangeWarning: null,
      pendingPartialRefundReconciliations: [],
      partialRefundWarning: null,
    });
    expect(getOperatorSnapshot).toHaveBeenCalledTimes(1);
    expect(listBillingLifecycleReconciliationCandidates).toHaveBeenCalledTimes(1);
    expect(listPendingPartialRefundReconciliations).toHaveBeenCalledTimes(1);
    expect(listStaleDodoSubscriptionPlanChangeClaims).toHaveBeenCalledTimes(1);
  });

  it("denies authenticated users who are not on the allowlist", async () => {
    const getOperatorSnapshot = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue({
        ...session,
        user: {
          ...session.user,
          email: "other@example.com",
        },
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSnapshot,
    }));

    const { loader } = await import("~/routes/ops");

    await expect(
      loader({
        context: createContext({
          OPS_ALLOWLIST_EMAILS: "owner@example.com",
        }),
        request: new Request("http://localhost/ops"),
      } as never),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(getOperatorSnapshot).not.toHaveBeenCalled();
  });

  it("denies access when the allowlist is unset", async () => {
    const getOperatorSnapshot = vi.fn();

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
      getOperatorSnapshot,
    }));

    const { loader } = await import("~/routes/ops");

    await expect(
      loader({
        context: createContext({}),
        request: new Request("http://localhost/ops"),
      } as never),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(getOperatorSnapshot).not.toHaveBeenCalled();
  });

  it("does not fetch operator data when access is denied", async () => {
    const getOperatorSnapshot = vi.fn();

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
      getOperatorSnapshot,
    }));

    const { loader } = await import("~/routes/ops");

    await expect(
      loader({
        context: createContext({
          OPS_ALLOWLIST_EMAILS: "someone-else@example.com",
        }),
        request: new Request("http://localhost/ops"),
      } as never),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(getOperatorSnapshot).not.toHaveBeenCalled();
  });

  it("renders provider-unknown email attempts as delivery attention", async () => {
    await mockRouter(() => ({
      snapshot: {
        summary: {
          failingRuns: 0,
          stuckRuns: 0,
          failedProofs: 0,
          budgetBlockedProofs: 0,
          blockedTargets: 0,
          deliveryFailures: 0,
          deliveryAttention: 2,
          degradedWatchlists: 0,
          discoveryFailures: 0,
          discoveryProvidersNeedingAttention: 0,
        },
        failingRuns: [],
        stuckRuns: [],
        failedProofs: [],
        budgetBlockedProofs: [],
        blockedTargets: [],
        deliveryFailures: [],
        deliveryAttention: [
          {
            attempt_id: "attempt-1",
            watchlist_id: null,
            watchlist_name: null,
            channel: "email",
            target_value: "ops@example.com",
            status: "pending",
            webhook_status: "provider_unknown",
            provider_status_last_seen_at: "2026-07-02T00:00:00.000Z",
            error_message: "Cloudflare Email send outcome is unknown after provider timeout.",
            created_at: "2026-07-02T00:00:00.000Z",
          },
          {
            attempt_id: "attempt-2",
            watchlist_id: null,
            watchlist_name: null,
            channel: "email",
            target_value: "accepted@example.com",
            status: "sent",
            webhook_status: "provider_unknown",
            provider_status_last_seen_at: "2026-07-02T01:00:00.000Z",
            error_message: null,
            created_at: "2026-07-02T01:00:00.000Z",
          },
        ],
        degradedWatchlists: [],
        discoveryFailures: [],
        discoveryProviders: [],
      },
    }));

    const { default: OpsRoute } = await import("~/routes/ops");
    const markup = renderToStaticMarkup(createElement(OpsRoute));

    expect(markup).toContain("Delivery attention");
    expect(markup).toContain("Recent delivery attention");
    expect(markup).toContain("Email delivery");
    expect(markup).toContain("Provider outcome is unknown");
    expect(markup).toContain("Provider accepted this email, but final delivery is still unconfirmed");
    expect(markup).toContain("do not resend it");
    expect(markup).not.toContain("ops@example.com");
    expect(markup).not.toContain("accepted@example.com");
    expect(markup).not.toContain("Cloudflare Email send outcome is unknown after provider timeout.");
    expect(markup).not.toContain("No recent delivery failures.");
  });

  it("retains the failure class when a discovery failure has partial results", async () => {
    await mockRouter(() => ({
      snapshot: {
        summary: {
          failingRuns: 0,
          stuckRuns: 0,
          failedProofs: 0,
          budgetBlockedProofs: 0,
          blockedTargets: 0,
          deliveryFailures: 0,
          deliveryAttention: 0,
          degradedWatchlists: 0,
          discoveryFailures: 1,
          discoveryProvidersNeedingAttention: 0,
        },
        failingRuns: [],
        stuckRuns: [],
        failedProofs: [],
        budgetBlockedProofs: [],
        blockedTargets: [],
        deliveryFailures: [],
        deliveryAttention: [],
        degradedWatchlists: [],
        discoveryFailures: [
          {
            fetchId: "fetch-partial-1",
            provider: "meta",
            routeContext: "search",
            country: "US",
            cacheStatus: "miss",
            failureClass: "provider_timeout",
            partial: 1,
            createdAt: "2026-07-02T00:00:00.000Z",
          },
        ],
        discoveryProviders: [],
      },
    }));

    const { default: OpsRoute } = await import("~/routes/ops");
    const markup = renderToStaticMarkup(createElement(OpsRoute));

    expect(markup).toContain("Partial discovery result");
    expect(markup).toContain(
      "Any first-page results were retained; later-page retrieval failed.",
    );
    expect(markup).toContain("Failure class: provider_timeout.");
  });

  it("renders partial-load warnings without exposing internal failure text", async () => {
    await mockRouter(() => ({
      snapshot: {
        summary: {
          failingRuns: 0,
          stuckRuns: 0,
          failedProofs: 0,
          budgetBlockedProofs: 0,
          blockedTargets: 0,
          deliveryFailures: 0,
          deliveryAttention: 0,
          degradedWatchlists: 0,
          discoveryFailures: 0,
          discoveryProvidersNeedingAttention: 0,
        },
        warnings: [{ section: "failedProofs", message: "This section could not be loaded." }],
        failingRuns: [],
        stuckRuns: [],
        failedProofs: [],
        budgetBlockedProofs: [],
        blockedTargets: [],
        deliveryFailures: [],
        deliveryAttention: [],
        degradedWatchlists: [],
        discoveryFailures: [],
        discoveryProviders: [],
      },
    }));

    const { default: OpsRoute } = await import("~/routes/ops");
    const markup = renderToStaticMarkup(createElement(OpsRoute));

    expect(markup).toContain("Some operational sections could not be loaded");
    expect(markup).toContain("This section could not be loaded.");
    expect(markup).not.toContain("sensitive provider detail");
  });

  it("shows failed support alerts as recoverable without exposing recipient details", async () => {
    await mockRouter(() => ({
      snapshot: {
        summary: {
          failingRuns: 0,
          stuckRuns: 0,
          failedProofs: 0,
          budgetBlockedProofs: 0,
          blockedTargets: 0,
          deliveryFailures: 0,
          deliveryAttention: 0,
          degradedWatchlists: 0,
          discoveryFailures: 0,
          discoveryProvidersNeedingAttention: 0,
          openSupportCases: 1,
          supportAlertsNeedRetry: 1,
        },
        warnings: [],
        supportCases: [{
          case_id: "case-1",
          category: "delivery",
          priority: "urgent",
          subject: "Digest missing",
          updated_at: "2026-07-15T04:00:00.000Z",
          alert_status: "failed",
          alert_webhook_status: "failed",
        }],
        failingRuns: [],
        stuckRuns: [],
        failedProofs: [],
        budgetBlockedProofs: [],
        blockedTargets: [],
        deliveryFailures: [],
        deliveryAttention: [],
        degradedWatchlists: [],
        discoveryFailures: [],
        discoveryProviders: [],
      },
    }));

    const { default: OpsRoute } = await import("~/routes/ops");
    const markup = renderToStaticMarkup(createElement(OpsRoute));

    expect(markup).toContain("Open support cases");
    expect(markup).toContain("Digest missing");
    expect(markup).toContain("Retry operator alert");
    expect(markup).not.toContain("owner@example.com");
    expect(markup).not.toContain("ops@example.com");
  });

  it("shows provider-unknown support alerts as evidence-only reconciliation, never retry", async () => {
    await mockRouter(() => ({
      snapshot: {
        summary: {
          failingRuns: 0,
          stuckRuns: 0,
          failedProofs: 0,
          budgetBlockedProofs: 0,
          blockedTargets: 0,
          deliveryFailures: 0,
          deliveryAttention: 0,
          degradedWatchlists: 0,
          discoveryFailures: 0,
          discoveryProvidersNeedingAttention: 0,
          openSupportCases: 1,
          supportAlertsNeedRetry: 0,
        },
        warnings: [],
        supportCases: [{
          case_id: "case-1",
          category: "delivery",
          priority: "urgent",
          subject: "Digest missing",
          updated_at: "2026-07-15T04:00:00.000Z",
          alert_attempt_id: "support-attempt-1",
          alert_status: "failed",
          alert_webhook_status: "provider_unknown",
          alert_updated_at: "2026-07-15T04:01:00.000Z",
        }, {
          case_id: "case-2",
          category: "delivery",
          priority: "urgent",
          subject: "Accepted alert awaiting evidence",
          updated_at: "2026-07-15T04:00:00.000Z",
          alert_attempt_id: "support-attempt-2",
          alert_status: "sent",
          alert_webhook_status: "provider_unknown",
          alert_updated_at: "2026-07-15T04:01:00.000Z",
        }],
        failingRuns: [],
        stuckRuns: [],
        failedProofs: [],
        budgetBlockedProofs: [],
        blockedTargets: [],
        deliveryFailures: [],
        deliveryAttention: [],
        degradedWatchlists: [],
        discoveryFailures: [],
        discoveryProviders: [],
      },
    }));

    const { default: OpsRoute } = await import("~/routes/ops");
    const markup = renderToStaticMarkup(createElement(OpsRoute));

    expect(markup).toContain("Record provider evidence");
    expect(markup).toContain("Confirmed provider outcome");
    expect(markup).toContain("Provider accepted this operator alert, but final delivery is still unconfirmed");
    expect(markup).toContain("do not resend it");
    expect(markup).not.toContain("Retry operator alert");
    expect(markup).not.toContain("operator@example.test");
  });

  it("reconciles a provider-unknown support alert without calling the sender", async () => {
    const reconcileSupportAlertAttemptWithAudit = vi.fn().mockResolvedValue({
      ok: true,
      replayed: false,
      outcome: "failed",
    });
    const sendOperatorAlertEmail = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data/operator-delivery-reconciliation.server", () => ({
      createSupportAlertReconciliationKey: vi.fn(() =>
        "ops-support-alert-reconcile:11111111-1111-4111-8111-111111111111"
      ),
      reconcileSupportAlertAttemptWithAudit,
    }));
    vi.doMock("~/lib/delivery.server", () => ({ sendOperatorAlertEmail }));

    const { action } = await import("~/routes/ops");
    const form = new FormData();
    form.set("intent", "reconcile-support-alert");
    form.set("attemptId", "support-attempt-1");
    form.set("expectedUpdatedAt", "2026-07-15T04:01:00.000Z");
    form.set("outcome", "failed");
    form.set("classification", "provider_rejection_log");
    form.set("evidenceReference", "support_provider_reject_12345");
    form.set("observedAt", "2026-07-15T04:02:00.000Z");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/ops", { method: "POST", body: form }),
    } as never);

    expect(result).toMatchObject({
      ok: true,
      intent: "reconcile-support-alert",
      message: expect.stringContaining("No email was resent"),
    });
    expect(reconcileSupportAlertAttemptWithAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attemptId: "support-attempt-1",
        outcome: "failed",
        classification: "provider_rejection_log",
      }),
    );
    expect(sendOperatorAlertEmail).not.toHaveBeenCalled();
  });

  it("never treats an acceptance-only sent support alert as delivered", async () => {
    const getOperatorSupportCase = vi.fn().mockResolvedValue({
      id: "case-1",
      userEmail: "requester@example.com",
      category: "delivery",
      priority: "urgent",
      subject: "Digest missing",
      detail: "Private case detail.",
    });
    const getDeliveryAttemptByIdempotencyKey = vi.fn().mockResolvedValue({
      status: "sent",
      webhookStatus: "provider_unknown",
    });
    const sendOperatorAlertEmail = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSupportCase,
      getDeliveryAttemptByIdempotencyKey,
    }));
    vi.doMock("~/lib/delivery.server", () => ({ sendOperatorAlertEmail }));

    const { action } = await import("~/routes/ops");
    const form = new FormData();
    form.set("intent", "retry-support-alert");
    form.set("caseId", "case-1");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/ops", { method: "POST", body: form }),
    } as never);

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("Provider outcome is unknown"),
    });
    expect(sendOperatorAlertEmail).not.toHaveBeenCalled();
  });

  it("retries a failed support alert only for an allowlisted operator", async () => {
    const getOperatorSupportCase = vi.fn().mockResolvedValue({
      id: "case-1",
      userEmail: "requester@example.com",
      category: "delivery",
      priority: "urgent",
      subject: "Digest missing",
      detail: "Private case detail.",
    });
    const getDeliveryAttemptByIdempotencyKey = vi.fn().mockResolvedValue({
      status: "failed",
      webhookStatus: "failed",
    });
    const sendOperatorAlertEmail = vi.fn().mockResolvedValue(true);
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSupportCase,
      getDeliveryAttemptByIdempotencyKey,
    }));
    vi.doMock("~/lib/delivery.server", () => ({ sendOperatorAlertEmail }));

    const { action } = await import("~/routes/ops");
    const form = new FormData();
    form.set("intent", "retry-support-alert");
    form.set("caseId", "case-1");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/ops", { method: "POST", body: form }),
    } as never);

    expect(result).toMatchObject({ ok: true, intent: "retry-support-alert" });
    expect(sendOperatorAlertEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      idempotencyKey: "support-case:case-1",
    }));
  });

  it("retries the latest rejected reopened support alert instead of the original sent alert", async () => {
    const getOperatorSupportCase = vi.fn().mockResolvedValue({
      id: "case-1",
      userEmail: "requester@example.com",
      category: "security",
      priority: "urgent",
      subject: "Delete my Five to Nine account",
      detail: "Private case detail.",
      alertIdempotencyKey: "support-case-reopen:case-1:2026-07-16T10:00:00.000Z",
    });
    const getDeliveryAttemptByIdempotencyKey = vi.fn().mockImplementation(
      async (_env, idempotencyKey: string) => {
        if (idempotencyKey === "support-case-reopen:case-1:2026-07-16T10:00:00.000Z") {
          return { status: "failed", webhookStatus: "failed" };
        }
        return { status: "sent", webhookStatus: "delivered" };
      },
    );
    const sendOperatorAlertEmail = vi.fn().mockResolvedValue(true);
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSupportCase,
      getDeliveryAttemptByIdempotencyKey,
    }));
    vi.doMock("~/lib/delivery.server", () => ({ sendOperatorAlertEmail }));

    const { action } = await import("~/routes/ops");
    const form = new FormData();
    form.set("intent", "retry-support-alert");
    form.set("caseId", "case-1");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/ops", { method: "POST", body: form }),
    } as never);

    expect(result).toMatchObject({ ok: true, intent: "retry-support-alert" });
    expect(getDeliveryAttemptByIdempotencyKey).toHaveBeenCalledWith(
      expect.anything(),
      "support-case-reopen:case-1:2026-07-16T10:00:00.000Z",
    );
    expect(sendOperatorAlertEmail).toHaveBeenCalledTimes(1);
    expect(sendOperatorAlertEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      idempotencyKey: "support-case-reopen:case-1:2026-07-16T10:00:00.000Z",
    }));
  });

  it("returns a safe recovery message when support lookup fails", async () => {
    const getOperatorSupportCase = vi.fn().mockRejectedValue(new Error("raw database failure for requester@example.com"));
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSupportCase,
      getDeliveryAttemptByIdempotencyKey: vi.fn(),
    }));

    const { action } = await import("~/routes/ops");
    const form = new FormData();
    form.set("intent", "retry-support-alert");
    form.set("caseId", "case-1");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/ops", { method: "POST", body: form }),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "retry-support-alert",
      message: "Support alert recovery is temporarily unavailable. Refresh before trying again.",
    });
    expect(JSON.stringify(result)).not.toContain("raw database failure");
    expect(JSON.stringify(result)).not.toContain("requester@example.com");
  });

  it("re-reads the durable outcome after a concurrent support retry", async () => {
    const getOperatorSupportCase = vi.fn().mockResolvedValue({
      id: "case-1",
      userEmail: "requester@example.com",
      category: "delivery",
      priority: "urgent",
      subject: "Digest missing",
      detail: "Private case detail.",
    });
    const getDeliveryAttemptByIdempotencyKey = vi.fn()
      .mockResolvedValueOnce({ status: "failed", webhookStatus: "failed" })
      .mockResolvedValueOnce({ status: "sent", webhookStatus: "delivered" });
    const sendOperatorAlertEmail = vi.fn().mockResolvedValue(false);
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSupportCase,
      getDeliveryAttemptByIdempotencyKey,
    }));
    vi.doMock("~/lib/delivery.server", () => ({ sendOperatorAlertEmail }));

    const { action } = await import("~/routes/ops");
    const form = new FormData();
    form.set("intent", "retry-support-alert");
    form.set("caseId", "case-1");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/ops", { method: "POST", body: form }),
    } as never);

    expect(result).toEqual({
      ok: true,
      intent: "retry-support-alert",
      message: "The operator alert was already sent.",
    });
  });

  it("keeps a provider-unknown retry fail-closed after a sender exception", async () => {
    const getOperatorSupportCase = vi.fn().mockResolvedValue({
      id: "case-1",
      userEmail: "requester@example.com",
      category: "delivery",
      priority: "urgent",
      subject: "Digest missing",
      detail: "Private case detail.",
    });
    const getDeliveryAttemptByIdempotencyKey = vi.fn()
      .mockResolvedValueOnce({ status: "failed", webhookStatus: "failed" })
      .mockResolvedValueOnce({ status: "sent", webhookStatus: "provider_unknown" });
    const sendOperatorAlertEmail = vi.fn().mockRejectedValue(
      new Error("raw provider failure for requester@example.com"),
    );
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSupportCase,
      getDeliveryAttemptByIdempotencyKey,
    }));
    vi.doMock("~/lib/delivery.server", () => ({ sendOperatorAlertEmail }));

    const { action } = await import("~/routes/ops");
    const form = new FormData();
    form.set("intent", "retry-support-alert");
    form.set("caseId", "case-1");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/ops", { method: "POST", body: form }),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "retry-support-alert",
      message: "Provider outcome is unknown. Check the provider console before any resend.",
    });
    expect(JSON.stringify(result)).not.toContain("raw provider failure");
    expect(JSON.stringify(result)).not.toContain("requester@example.com");
  });

  it("renders only safe billing lifecycle reconciliation fields", async () => {
    await mockRouter(() => ({
      billingLifecycleWarning: null,
      billingLifecycleCandidates: [{
        attemptId: "attempt-opaque-1",
        lifecycleKind: "refund_revoked",
        status: "sent",
        providerStatusLastSeenAt: "2026-07-15T04:01:00.000Z",
        createdAt: "2026-07-15T04:00:00.000Z",
        updatedAt: "2026-07-15T04:02:00.000Z",
      }],
      snapshot: {
        summary: {
          failingRuns: 0,
          stuckRuns: 0,
          failedProofs: 0,
          budgetBlockedProofs: 0,
          blockedTargets: 0,
          deliveryFailures: 0,
          deliveryAttention: 0,
          degradedWatchlists: 0,
          discoveryFailures: 0,
          discoveryProvidersNeedingAttention: 0,
        },
        warnings: [],
        supportCases: [],
        failingRuns: [],
        stuckRuns: [],
        failedProofs: [],
        budgetBlockedProofs: [],
        blockedTargets: [],
        deliveryFailures: [],
        deliveryAttention: [],
        degradedWatchlists: [],
        discoveryFailures: [],
        discoveryProviders: [],
      },
    }));

    const { default: OpsRoute } = await import("~/routes/ops");
    const markup = renderToStaticMarkup(createElement(OpsRoute));

    expect(markup).toContain("Billing email provider reconciliation");
    expect(markup).toContain("Refund and access email");
    expect(markup).toContain("Record provider evidence");
    expect(markup).toContain("Confirmed delivered");
    expect(markup).toContain("Provider delivery confirmation");
    expect(markup).not.toContain("Provider acceptance log");
    expect(markup).toContain("attempt-opaque-1");
    expect(markup).not.toContain("owner@example.com");
    expect(markup).not.toContain("recipient@example.com");
    expect(markup).not.toContain("raw provider failure");
  });

  it("records an allowlisted operator's confirmed billing email evidence without resending", async () => {
    const reconcileBillingLifecycleEmailAttempt = vi.fn().mockResolvedValue({
      reconciled: true,
      auditId: "audit-1",
      idempotencyKey: "billing-lifecycle-reconcile:attempt-1:updated-1",
    });
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({ reconcileBillingLifecycleEmailAttempt }));

    const { action } = await import("~/routes/ops");
    const form = new FormData();
    form.set("intent", "reconcile-billing-lifecycle-email");
    form.set("attemptId", "attempt-1");
    form.set("expectedUpdatedAt", "2026-07-15T04:02:00.000Z");
    form.set("outcome", "sent");
    form.set("evidenceClassification", "provider_delivery_confirmation");
    form.set("evidenceReference", "cloudflare-event-123");
    form.set("observedAt", "2026-07-15T04:01:30.000Z");
    form.set("providerMessageId", "provider-message-123");

    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/ops", { method: "POST", body: form }),
    } as never);

    expect(result).toMatchObject({ ok: true, intent: "reconcile-billing-lifecycle-email" });
    expect(reconcileBillingLifecycleEmailAttempt).toHaveBeenCalledWith(
      expect.anything(),
      {
        operatorUserId: "user-1",
        attemptId: "attempt-1",
        expectedUpdatedAt: "2026-07-15T04:02:00.000Z",
        outcome: "sent",
        evidenceClassification: "provider_delivery_confirmation",
        evidenceReference: "cloudflare-event-123",
        observedAt: "2026-07-15T04:01:30.000Z",
        providerMessageId: "provider-message-123",
      },
    );
  });

  it("renders pending partial-refund recovery without exposing customer identity", async () => {
    await mockRouter(() => ({
      billingLifecycleCandidates: [],
      billingLifecycleWarning: null,
      stalePlanChangeClaims: [],
      planChangeWarning: null,
      pendingPartialRefundReconciliations: [{
        eventId: "evt-partial-provider-1234",
        paymentId: "pay-private-1234",
        refundId: "ref-private-1234",
        refundAmount: 1299,
        refundCurrency: "USD",
        refundReason: "private provider reason",
        processedAt: "2026-07-17T01:00:00.000Z",
        availableCredits: 8,
      }],
      partialRefundWarning: null,
      snapshot: {
        summary: {
          failingRuns: 0,
          stuckRuns: 0,
          failedProofs: 0,
          budgetBlockedProofs: 0,
          blockedTargets: 0,
          deliveryFailures: 0,
          deliveryAttention: 0,
          degradedWatchlists: 0,
          discoveryFailures: 0,
          discoveryProvidersNeedingAttention: 0,
        },
        warnings: [],
        supportCases: [],
        failingRuns: [],
        stuckRuns: [],
        failedProofs: [],
        budgetBlockedProofs: [],
        blockedTargets: [],
        deliveryFailures: [],
        deliveryAttention: [],
        degradedWatchlists: [],
        discoveryFailures: [],
        discoveryProviders: [],
      },
    }));

    const { default: OpsRoute } = await import("~/routes/ops");
    const markup = renderToStaticMarkup(createElement(OpsRoute));
    expect(markup).toContain("Partial refunds awaiting operator reconciliation");
    expect(markup).toContain("Record refund reconciliation");
    expect(markup).toContain('value="reconcile-partial-refund"');
    expect(markup).toContain("Proof credits to revoke");
    expect(markup).toContain("Private evidence reference");
    expect(markup).not.toContain("pay-private-1234");
    expect(markup).not.toContain("ref-private-1234");
    expect(markup).not.toContain("private provider reason");
    expect(markup).not.toContain("owner@example.com");
  });

  it("records an allowlisted operator's partial-refund decision without contacting the provider", async () => {
    const reconcilePartialRefundWithAudit = vi.fn().mockResolvedValue({
      reconciled: true,
      replayed: false,
      decision: "revoke",
      appliedQuantity: 5,
    });
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({ reconcilePartialRefundWithAudit }));

    const form = new FormData();
    form.set("intent", "reconcile-partial-refund");
    form.set("eventId", "evt-partial-1");
    form.set("expectedProcessedAt", "2026-07-17T01:00:00.000Z");
    form.set("decision", "revoke");
    form.set("creditQuantityToRevoke", "5");
    form.set("evidenceReference", "dodo-refund-observation-123");
    form.set("observedAt", "2026-07-17T02:00:00.000Z");

    const { action } = await import("~/routes/ops");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/ops", { method: "POST", body: form }),
    } as never);

    expect(result).toMatchObject({
      ok: true,
      intent: "reconcile-partial-refund",
      message: expect.stringContaining("No provider refund request was sent"),
    });
    expect(reconcilePartialRefundWithAudit).toHaveBeenCalledWith(expect.anything(), {
      operatorUserId: "user-1",
      eventId: "evt-partial-1",
      expectedProcessedAt: "2026-07-17T01:00:00.000Z",
      decision: "revoke",
      creditQuantityToRevoke: 5,
      evidenceReference: "dodo-refund-observation-123",
      observedAt: "2026-07-17T02:00:00.000Z",
    });
  });

  it("renders and checks stale plan changes without exposing account identity or resending", async () => {
    await mockRouter(() => ({
      billingLifecycleCandidates: [],
      billingLifecycleWarning: null,
      stalePlanChangeClaims: [{
        userId: "owner-ambiguous-1234",
        plan: "scout",
        status: "plan_change_pending",
        claimedAt: "2026-07-02T00:00:00.000Z",
      }],
      planChangeWarning: null,
      snapshot: {
        summary: {
          failingRuns: 0,
          stuckRuns: 0,
          failedProofs: 0,
          budgetBlockedProofs: 0,
          blockedTargets: 0,
          deliveryFailures: 0,
          deliveryAttention: 0,
          degradedWatchlists: 0,
          discoveryFailures: 0,
          discoveryProvidersNeedingAttention: 0,
        },
        warnings: [],
        supportCases: [],
        failingRuns: [],
        stuckRuns: [],
        failedProofs: [],
        budgetBlockedProofs: [],
        blockedTargets: [],
        deliveryFailures: [],
        deliveryAttention: [],
        degradedWatchlists: [],
        discoveryFailures: [],
        discoveryProviders: [],
      },
    }));

    const { default: OpsRoute } = await import("~/routes/ops");
    const markup = renderToStaticMarkup(createElement(OpsRoute));
    expect(markup).toContain("Plan changes awaiting provider reconciliation");
    expect(markup).toContain("Check current Dodo state");
    expect(markup).toContain('value="reconcile-dodo-plan-change"');
    expect(markup).not.toContain(">owner-ambiguous-1234<");

    vi.resetModules();
    const reconcileDodo0509SubscriptionPlanChange = vi.fn().mockResolvedValue({
      ok: true,
      replayed: false,
      outcome: "accepted",
    });
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/dodo-plan-change-reconciliation.server", () => ({
      reconcileDodo0509SubscriptionPlanChange,
    }));
    const form = new FormData();
    form.set("intent", "reconcile-dodo-plan-change");
    form.set("subjectUserId", "owner-ambiguous-1234");
    const { action } = await import("~/routes/ops");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/ops", { method: "POST", body: form }),
    } as never);
    expect(result).toMatchObject({
      ok: true,
      intent: "reconcile-dodo-plan-change",
      message: expect.stringContaining("No second plan change was sent"),
    });
    expect(reconcileDodo0509SubscriptionPlanChange).toHaveBeenCalledWith({
      env: expect.anything(),
      subjectUserId: "owner-ambiguous-1234",
      actorUserId: "user-1",
    });
  });

  it("keeps billing reconciliation query failure isolated from the operator snapshot", async () => {
    const getOperatorSnapshot = vi.fn().mockResolvedValue({
      summary: { failingRuns: 0 },
    });
    const listBillingLifecycleReconciliationCandidates = vi.fn().mockRejectedValue(
      new Error("raw database failure"),
    );
    const listStaleDodoSubscriptionPlanChangeClaims = vi.fn().mockResolvedValue([]);
    const listPendingPartialRefundReconciliations = vi.fn().mockResolvedValue([]);
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSnapshot,
      listBillingLifecycleReconciliationCandidates,
      listPendingPartialRefundReconciliations,
      listStaleDodoSubscriptionPlanChangeClaims,
    }));

    const { loader } = await import("~/routes/ops");
    const result = await loader({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/ops"),
    } as never);

    expect(result).toEqual({
      snapshot: { summary: { failingRuns: 0 } },
      billingLifecycleCandidates: [],
      billingLifecycleWarning: "Billing lifecycle reconciliation could not be loaded.",
      stalePlanChangeClaims: [],
      planChangeWarning: null,
      pendingPartialRefundReconciliations: [],
      partialRefundWarning: null,
    });
    expect(JSON.stringify(result)).not.toContain("raw database failure");
  });
});
