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

async function mockRouter(useLoaderData: MockUseLoaderData) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(null),
      useLoaderData: vi.fn(useLoaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle", formData: null }),
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
      createBillingEmailReconciliationKey: vi.fn(() => "ops-billing-email-reconcile:11111111-1111-4111-8111-111111111111"),
      createDigestEmailReconciliationKey: vi.fn(() => "ops-digest-email-reconcile:11111111-1111-4111-8111-111111111111"),
      getOperatorSnapshot,
      listOutstandingBillingLifecycleProviderUnknownAttempts: vi.fn().mockResolvedValue([]),
      listOutstandingDigestProviderUnknownAttempts: vi.fn().mockResolvedValue([]),
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
      outstandingBillingAttempts: [],
      outstandingDigestAttempts: [],
    });
    expect(getOperatorSnapshot).toHaveBeenCalledTimes(1);
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
            target_value: "o•••@e•••.com",
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
      outstandingBillingAttempts: [],
      outstandingDigestAttempts: [
        {
          attemptId: "digest-attempt-1",
          recipient: "o•••@e•••.com",
          provider: "cloudflare_email",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:01:00.000Z",
          reconciliationKey: "ops-digest-email-reconcile:11111111-1111-4111-8111-111111111111",
        },
      ],
    }));

    const { default: OpsRoute } = await import("~/routes/app.ops");
    const markup = renderToStaticMarkup(createElement(OpsRoute));

    expect(markup).toContain("Delivery attention");
    expect(markup).toContain("Recent delivery attention");
    expect(markup).toContain("Email to o•••@e•••.com");
    expect(markup).toContain("Provider outcome is unknown.");
    expect(markup).toContain("Digest email provider reconciliation");
    expect(markup).toContain("Recording evidence never resends it");
    expect(markup).toContain('value="reconcile-digest-email"');
    expect(markup).not.toContain("ops@example.com");
    expect(markup).not.toContain("provider timeout");
    expect(markup).not.toContain("No recent delivery failures.");
  });

  it("masks recipient targets before operator loader data is serialized", async () => {
    const getOperatorSnapshot = vi.fn().mockResolvedValue({
      summary: {
        failingRuns: 0,
        stuckRuns: 0,
        failedProofs: 0,
        budgetBlockedProofs: 0,
        blockedTargets: 1,
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
      blockedTargets: [{ target_value: "+919876543210" }],
      deliveryFailures: [],
      deliveryAttention: [{ target_value: "owner@example.com" }],
      degradedWatchlists: [],
      discoveryFailures: [],
      discoveryProviders: [],
    });
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({
      createBillingEmailReconciliationKey: vi.fn(() => "ops-billing-email-reconcile:11111111-1111-4111-8111-111111111111"),
      createDigestEmailReconciliationKey: vi.fn(() => "ops-digest-email-reconcile:11111111-1111-4111-8111-111111111111"),
      getOperatorSnapshot,
      listOutstandingBillingLifecycleProviderUnknownAttempts: vi.fn().mockResolvedValue([
        {
          id: "attempt-1",
          targetValue: "billing@example.com",
          templateName: "billing_refund_revoked",
          provider: "cloudflare_email",
          createdAt: "2026-07-15T18:00:00.000Z",
          updatedAt: "2026-07-15T18:00:00.000Z",
        },
      ]),
      listOutstandingDigestProviderUnknownAttempts: vi.fn().mockResolvedValue([
        {
          id: "digest-attempt-1",
          targetValue: "digest@example.com",
          templateName: null,
          provider: "cloudflare_email",
          createdAt: "2026-07-15T18:00:00.000Z",
          updatedAt: "2026-07-15T18:00:00.000Z",
        },
      ]),
    }));

    const { loader } = await import("~/routes/app.ops");
    const result = await loader({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/app/ops"),
    } as never);
    const serialized = JSON.stringify(result);

    expect(serialized).toContain("o•••@e•••.com");
    expect(serialized).toContain("b•••@e•••.com");
    expect(serialized).toContain("d•••@e•••.com");
    expect(serialized).toContain("••••3210");
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("billing@example.com");
    expect(serialized).not.toContain("digest@example.com");
    expect(serialized).not.toContain("+919876543210");
  });

  it("records provider evidence without invoking an email send", async () => {
    const reconcileBillingEmailAttemptWithAudit = vi.fn().mockResolvedValue({
      ok: true,
      replayed: false,
      attemptId: "attempt-1",
      outcome: "sent",
      classification: "controlled_inbox_receipt",
      observedAt: "2026-07-15T18:01:00.000Z",
      reconciledAt: "2026-07-15T18:02:00.000Z",
    });
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({
      BILLING_EMAIL_EVIDENCE_CLASSIFICATIONS: [
        "cloudflare_email_log",
        "controlled_inbox_receipt",
        "provider_rejection_log",
      ],
      reconcileBillingEmailAttemptWithAudit,
      reconcileDigestEmailAttemptWithAudit: vi.fn(),
    }));
    const formData = new FormData();
    formData.set("intent", "reconcile-billing-email");
    formData.set("attemptId", "attempt-1");
    formData.set("reconciliationKey", "ops-billing-email-reconcile:11111111-1111-4111-8111-111111111111");
    formData.set("expectedUpdatedAt", "2026-07-15T18:00:00.000Z");
    formData.set("outcome", "sent");
    formData.set("classification", "controlled_inbox_receipt");
    formData.set("evidenceReference", "inbox_receipt_12345");
    formData.set("observedAt", "2026-07-15T18:01:00Z");

    const { action } = await import("~/routes/app.ops");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/app/ops", { method: "POST", body: formData }),
    } as never);

    expect(result).toMatchObject({
      ok: true,
      attemptId: "attempt-1",
      message: expect.stringContaining("No email was resent"),
    });
    expect(reconcileBillingEmailAttemptWithAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operatorUserId: "user-1",
        attemptId: "attempt-1",
        outcome: "sent",
      }),
    );
  });

  it("records digest provider evidence through the explicit no-resend recovery action", async () => {
    const reconcileDigestEmailAttemptWithAudit = vi.fn().mockResolvedValue({
      ok: true,
      replayed: false,
      attemptId: "digest-attempt-1",
      outcome: "sent",
      classification: "cloudflare_email_log",
      observedAt: "2026-07-15T18:01:00.000Z",
      reconciledAt: "2026-07-15T18:02:00.000Z",
    });
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/data.server", () => ({
      BILLING_EMAIL_EVIDENCE_CLASSIFICATIONS: [
        "cloudflare_email_log",
        "controlled_inbox_receipt",
        "provider_rejection_log",
      ],
      reconcileBillingEmailAttemptWithAudit: vi.fn(),
      reconcileDigestEmailAttemptWithAudit,
    }));
    const formData = new FormData();
    formData.set("intent", "reconcile-digest-email");
    formData.set("attemptId", "digest-attempt-1");
    formData.set("reconciliationKey", "ops-digest-email-reconcile:11111111-1111-4111-8111-111111111111");
    formData.set("expectedUpdatedAt", "2026-07-15T18:00:30.000Z");
    formData.set("outcome", "sent");
    formData.set("classification", "cloudflare_email_log");
    formData.set("evidenceReference", "digest_provider_log_12345");
    formData.set("observedAt", "2026-07-15T18:01:00Z");

    const { action } = await import("~/routes/app.ops");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/app/ops", { method: "POST", body: formData }),
    } as never);

    expect(result).toMatchObject({
      ok: true,
      attemptId: "digest-attempt-1",
      message: expect.stringContaining("No email was resent"),
    });
    expect(reconcileDigestEmailAttemptWithAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operatorUserId: "user-1",
        attemptId: "digest-attempt-1",
        outcome: "sent",
      }),
    );
  });
});
