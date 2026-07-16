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
    }));

    const { loader } = await import("~/routes/app.ops");
    const result = await loader({
      context: createContext({
        OPS_ALLOWLIST_EMAILS: "owner@example.com, teammate@example.com",
      }),
      request: new Request("http://localhost/app/ops"),
    } as never);

    expect(result).toEqual({
      snapshot: expect.objectContaining({
        summary: expect.objectContaining({
          failingRuns: 1,
        }),
      }),
      billingLifecycleCandidates: [],
      billingLifecycleWarning: null,
    });
    expect(getOperatorSnapshot).toHaveBeenCalledTimes(1);
    expect(listBillingLifecycleReconciliationCandidates).toHaveBeenCalledTimes(1);
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

    const { loader } = await import("~/routes/app.ops");

    await expect(
      loader({
        context: createContext({
          OPS_ALLOWLIST_EMAILS: "owner@example.com",
        }),
        request: new Request("http://localhost/app/ops"),
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

    const { loader } = await import("~/routes/app.ops");

    await expect(
      loader({
        context: createContext({}),
        request: new Request("http://localhost/app/ops"),
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

    const { loader } = await import("~/routes/app.ops");

    await expect(
      loader({
        context: createContext({
          OPS_ALLOWLIST_EMAILS: "someone-else@example.com",
        }),
        request: new Request("http://localhost/app/ops"),
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
          deliveryAttention: 1,
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
        ],
        degradedWatchlists: [],
        discoveryFailures: [],
        discoveryProviders: [],
      },
    }));

    const { default: OpsRoute } = await import("~/routes/app.ops");
    const markup = renderToStaticMarkup(createElement(OpsRoute));

    expect(markup).toContain("Delivery attention");
    expect(markup).toContain("Recent delivery attention");
    expect(markup).toContain("Email delivery");
    expect(markup).toContain("Provider outcome is unknown");
    expect(markup).not.toContain("ops@example.com");
    expect(markup).not.toContain("Cloudflare Email send outcome is unknown after provider timeout.");
    expect(markup).not.toContain("No recent delivery failures.");
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

    const { default: OpsRoute } = await import("~/routes/app.ops");
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

    const { default: OpsRoute } = await import("~/routes/app.ops");
    const markup = renderToStaticMarkup(createElement(OpsRoute));

    expect(markup).toContain("Open support cases");
    expect(markup).toContain("Digest missing");
    expect(markup).toContain("Retry operator alert");
    expect(markup).not.toContain("owner@example.com");
    expect(markup).not.toContain("ops@example.com");
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

    const { action } = await import("~/routes/app.ops");
    const form = new FormData();
    form.set("intent", "retry-support-alert");
    form.set("caseId", "case-1");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/app/ops", { method: "POST", body: form }),
    } as never);

    expect(result).toMatchObject({ ok: true, intent: "retry-support-alert" });
    expect(sendOperatorAlertEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      idempotencyKey: "support-case:case-1",
    }));
  });

  it("returns a safe recovery message when support lookup fails", async () => {
    const getOperatorSupportCase = vi.fn().mockRejectedValue(new Error("raw database failure for requester@example.com"));
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSupportCase,
      getDeliveryAttemptByIdempotencyKey: vi.fn(),
    }));

    const { action } = await import("~/routes/app.ops");
    const form = new FormData();
    form.set("intent", "retry-support-alert");
    form.set("caseId", "case-1");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/app/ops", { method: "POST", body: form }),
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

    const { action } = await import("~/routes/app.ops");
    const form = new FormData();
    form.set("intent", "retry-support-alert");
    form.set("caseId", "case-1");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/app/ops", { method: "POST", body: form }),
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
      .mockResolvedValueOnce({ status: "pending", webhookStatus: "provider_unknown" });
    const sendOperatorAlertEmail = vi.fn().mockRejectedValue(
      new Error("raw provider failure for requester@example.com"),
    );
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSupportCase,
      getDeliveryAttemptByIdempotencyKey,
    }));
    vi.doMock("~/lib/delivery.server", () => ({ sendOperatorAlertEmail }));

    const { action } = await import("~/routes/app.ops");
    const form = new FormData();
    form.set("intent", "retry-support-alert");
    form.set("caseId", "case-1");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/app/ops", { method: "POST", body: form }),
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

    const { default: OpsRoute } = await import("~/routes/app.ops");
    const markup = renderToStaticMarkup(createElement(OpsRoute));

    expect(markup).toContain("Billing email provider reconciliation");
    expect(markup).toContain("Refund and access email");
    expect(markup).toContain("Record provider evidence");
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

    const { action } = await import("~/routes/app.ops");
    const form = new FormData();
    form.set("intent", "reconcile-billing-lifecycle-email");
    form.set("attemptId", "attempt-1");
    form.set("expectedUpdatedAt", "2026-07-15T04:02:00.000Z");
    form.set("outcome", "sent");
    form.set("evidenceReference", "cloudflare-event-123");
    form.set("providerMessageId", "provider-message-123");

    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/app/ops", { method: "POST", body: form }),
    } as never);

    expect(result).toMatchObject({ ok: true, intent: "reconcile-billing-lifecycle-email" });
    expect(reconcileBillingLifecycleEmailAttempt).toHaveBeenCalledWith(
      expect.anything(),
      {
        operatorUserId: "user-1",
        attemptId: "attempt-1",
        expectedUpdatedAt: "2026-07-15T04:02:00.000Z",
        outcome: "sent",
        evidenceReference: "cloudflare-event-123",
        providerMessageId: "provider-message-123",
      },
    );
  });

  it("keeps billing reconciliation query failure isolated from the operator snapshot", async () => {
    const getOperatorSnapshot = vi.fn().mockResolvedValue({
      summary: { failingRuns: 0 },
    });
    const listBillingLifecycleReconciliationCandidates = vi.fn().mockRejectedValue(
      new Error("raw database failure"),
    );
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSnapshot,
      listBillingLifecycleReconciliationCandidates,
    }));

    const { loader } = await import("~/routes/app.ops");
    const result = await loader({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/app/ops"),
    } as never);

    expect(result).toEqual({
      snapshot: { summary: { failingRuns: 0 } },
      billingLifecycleCandidates: [],
      billingLifecycleWarning: "Billing lifecycle reconciliation could not be loaded.",
    });
    expect(JSON.stringify(result)).not.toContain("raw database failure");
  });
});
