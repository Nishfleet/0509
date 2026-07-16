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
			createDigestScheduleJobRequeueKey: vi.fn(() => "digest-schedule-requeue:11111111-1111-4111-8111-111111111111"),
      createInstantChannelReconciliationKey: vi.fn((channel: string) => `ops-instant-${channel}-reconcile:11111111-1111-4111-8111-111111111111`),
      createInstantEmailReconciliationKey: vi.fn(() => "ops-instant-email-reconcile:11111111-1111-4111-8111-111111111111"),
      getOperatorSnapshot,
      listOutstandingBillingLifecycleProviderUnknownAttempts: vi.fn().mockResolvedValue([]),
      listOutstandingDigestProviderUnknownAttempts: vi.fn().mockResolvedValue([]),
      listOutstandingInstantProviderUnknownAttempts: vi.fn().mockResolvedValue([]),
			listExhaustedDigestScheduleJobs: vi.fn().mockResolvedValue([]),
      listStaleDodoSubscriptionPlanChangeClaims: vi.fn().mockResolvedValue([]),
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
      outstandingInstantAttempts: [],
		exhaustedDigestScheduleJobs: [],
      stalePlanChangeClaims: [],
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
      outstandingInstantAttempts: [
        {
          attemptId: "instant-attempt-1",
          channel: "email",
          recipient: "i•••@e•••.com",
          provider: "cloudflare_email",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:01:00.000Z",
          reconciliationKey: "ops-instant-email-reconcile:11111111-1111-4111-8111-111111111111",
        },
        {
          attemptId: "instant-whatsapp-attempt-1",
          channel: "whatsapp",
          recipient: "••••3210",
          provider: "whatsapp_cloud_api",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:01:00.000Z",
          reconciliationKey: "ops-instant-whatsapp-reconcile:22222222-2222-4222-8222-222222222222",
        },
        {
          attemptId: "instant-slack-attempt-1",
          channel: "slack",
          recipient: "••••",
          provider: "slack_incoming_webhook",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:01:00.000Z",
          reconciliationKey: "ops-instant-slack-reconcile:33333333-3333-4333-8333-333333333333",
        },
      ],
		stalePlanChangeClaims: [
		  {
		    userId: "owner-ambiguous",
		    plan: "scout",
		    status: "plan_change_pending",
		    claimedAt: "2026-07-02T00:00:00.000Z",
		  },
		],
		exhaustedDigestScheduleJobs: [
		{
			jobId: "digest-schedule:weekly:owner-1",
			cadence: "weekly",
			periodStart: "2026-07-06T05:00:00.000Z",
			periodEnd: "2026-07-13T05:00:00.000Z",
			attemptCount: 5,
			lastErrorCode: "digest_schedule_job_exhausted",
			updatedAt: "2026-07-13T05:05:00.000Z",
			requeueKey: "digest-schedule-requeue:11111111-1111-4111-8111-111111111111",
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
    expect(markup).toContain("Instant-alert provider reconciliation");
    expect(markup).toContain('value="reconcile-instant-email"');
    expect(markup).toContain("WhatsApp to ••••3210");
    expect(markup).toContain('value="reconcile-instant-whatsapp"');
    expect(markup).toContain("Slack destination ••••");
    expect(markup).toContain('value="reconcile-instant-slack"');
    expect(markup).toContain('value="meta_whatsapp_message_log"');
    expect(markup).toContain('value="controlled_channel_observation"');
		expect(markup).toContain("Digest periods awaiting operator recovery");
		expect(markup).toContain("Requeue after repair");
		expect(markup).toContain("Plan changes awaiting provider reconciliation");
		expect(markup).toContain("Check current Dodo state");
		expect(markup).toContain('value="reconcile-dodo-plan-change"');
		expect(markup).toContain('value="requeue-digest-schedule-job"');
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
			createDigestScheduleJobRequeueKey: vi.fn(() => "digest-schedule-requeue:11111111-1111-4111-8111-111111111111"),
      createInstantChannelReconciliationKey: vi.fn((channel: string) => `ops-instant-${channel}-reconcile:11111111-1111-4111-8111-111111111111`),
      createInstantEmailReconciliationKey: vi.fn(() => "ops-instant-email-reconcile:11111111-1111-4111-8111-111111111111"),
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
      listOutstandingInstantProviderUnknownAttempts: vi.fn().mockResolvedValue([
        {
          id: "instant-attempt-1",
          targetValue: "instant@example.com",
          provider: "cloudflare_email",
          createdAt: "2026-07-15T18:00:00.000Z",
          updatedAt: "2026-07-15T18:00:00.000Z",
        },
      ]),
			listExhaustedDigestScheduleJobs: vi.fn().mockResolvedValue([]),
      listStaleDodoSubscriptionPlanChangeClaims: vi.fn().mockResolvedValue([]),
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
    expect(serialized).toContain("i•••@e•••.com");
    expect(serialized).toContain("••••3210");
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("billing@example.com");
    expect(serialized).not.toContain("digest@example.com");
    expect(serialized).not.toContain("instant@example.com");
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
      INSTANT_SLACK_EVIDENCE_CLASSIFICATIONS: ["slack_webhook_response", "controlled_channel_observation", "provider_rejection_log"],
      INSTANT_WHATSAPP_EVIDENCE_CLASSIFICATIONS: ["meta_whatsapp_message_log", "controlled_recipient_receipt", "provider_rejection_log"],
      reconcileBillingEmailAttemptWithAudit,
      reconcileDigestEmailAttemptWithAudit: vi.fn(),
      reconcileInstantChannelAttemptWithAudit: vi.fn(),
      reconcileInstantEmailAttemptWithAudit: vi.fn(),
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

  it("checks a stale plan change from current Dodo state without sending another mutation", async () => {
    const reconcileDodo0509SubscriptionPlanChange = vi.fn().mockResolvedValue({
      ok: true,
      replayed: false,
      outcome: "accepted",
    });
    vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
    vi.doMock("~/lib/dodo-plan-change-reconciliation.server", () => ({
      reconcileDodo0509SubscriptionPlanChange,
    }));
    const formData = new FormData();
    formData.set("intent", "reconcile-dodo-plan-change");
    formData.set("subjectUserId", "owner-ambiguous");

    const { action } = await import("~/routes/app.ops");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/app/ops", { method: "POST", body: formData }),
    } as never);

    expect(result).toMatchObject({
      ok: true,
      intent: "reconcile-dodo-plan-change",
      subjectUserId: "owner-ambiguous",
      message: expect.stringContaining("No second plan change was sent"),
    });
    expect(reconcileDodo0509SubscriptionPlanChange).toHaveBeenCalledWith({
      env: expect.anything(),
      subjectUserId: "owner-ambiguous",
      actorUserId: "user-1",
    });
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
      INSTANT_SLACK_EVIDENCE_CLASSIFICATIONS: ["slack_webhook_response", "controlled_channel_observation", "provider_rejection_log"],
      INSTANT_WHATSAPP_EVIDENCE_CLASSIFICATIONS: ["meta_whatsapp_message_log", "controlled_recipient_receipt", "provider_rejection_log"],
      reconcileBillingEmailAttemptWithAudit: vi.fn(),
      reconcileDigestEmailAttemptWithAudit,
      reconcileInstantChannelAttemptWithAudit: vi.fn(),
      reconcileInstantEmailAttemptWithAudit: vi.fn(),
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

  it("records instant-alert provider evidence through the explicit no-resend recovery action", async () => {
    const reconcileInstantEmailAttemptWithAudit = vi.fn().mockResolvedValue({
      ok: true,
      replayed: false,
      attemptId: "instant-attempt-1",
      outcome: "failed",
      classification: "provider_rejection_log",
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
      INSTANT_SLACK_EVIDENCE_CLASSIFICATIONS: ["slack_webhook_response", "controlled_channel_observation", "provider_rejection_log"],
      INSTANT_WHATSAPP_EVIDENCE_CLASSIFICATIONS: ["meta_whatsapp_message_log", "controlled_recipient_receipt", "provider_rejection_log"],
      reconcileBillingEmailAttemptWithAudit: vi.fn(),
      reconcileDigestEmailAttemptWithAudit: vi.fn(),
      reconcileInstantChannelAttemptWithAudit: vi.fn(),
      reconcileInstantEmailAttemptWithAudit,
    }));
    const formData = new FormData();
    formData.set("intent", "reconcile-instant-email");
    formData.set("attemptId", "instant-attempt-1");
    formData.set("reconciliationKey", "ops-instant-email-reconcile:11111111-1111-4111-8111-111111111111");
    formData.set("expectedUpdatedAt", "2026-07-15T18:00:30.000Z");
    formData.set("outcome", "failed");
    formData.set("classification", "provider_rejection_log");
    formData.set("evidenceReference", "instant_provider_reject_12345");
    formData.set("observedAt", "2026-07-15T18:01:00Z");

    const { action } = await import("~/routes/app.ops");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/app/ops", { method: "POST", body: formData }),
    } as never);

    expect(result).toMatchObject({
      ok: true,
      attemptId: "instant-attempt-1",
      message: expect.stringContaining("did not resend email"),
    });
    expect(reconcileInstantEmailAttemptWithAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operatorUserId: "user-1",
        attemptId: "instant-attempt-1",
        outcome: "failed",
      }),
    );
  });

  it("records WhatsApp ambiguity evidence without invoking delivery", async () => {
    const reconcileInstantChannelAttemptWithAudit = vi.fn().mockResolvedValue({
      ok: true,
      replayed: false,
      attemptId: "instant-whatsapp-attempt-1",
      outcome: "sent",
      classification: "meta_whatsapp_message_log",
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
      INSTANT_SLACK_EVIDENCE_CLASSIFICATIONS: [
        "slack_webhook_response",
        "controlled_channel_observation",
        "provider_rejection_log",
      ],
      INSTANT_WHATSAPP_EVIDENCE_CLASSIFICATIONS: [
        "meta_whatsapp_message_log",
        "controlled_recipient_receipt",
        "provider_rejection_log",
      ],
      reconcileBillingEmailAttemptWithAudit: vi.fn(),
      reconcileDigestEmailAttemptWithAudit: vi.fn(),
      reconcileInstantChannelAttemptWithAudit,
      reconcileInstantEmailAttemptWithAudit: vi.fn(),
    }));
    const formData = new FormData();
    formData.set("intent", "reconcile-instant-whatsapp");
    formData.set("attemptId", "instant-whatsapp-attempt-1");
    formData.set("reconciliationKey", "ops-instant-whatsapp-reconcile:22222222-2222-4222-8222-222222222222");
    formData.set("expectedUpdatedAt", "2026-07-15T18:00:30.000Z");
    formData.set("outcome", "sent");
    formData.set("classification", "meta_whatsapp_message_log");
    formData.set("evidenceReference", "meta_message_log_12345");
    formData.set("observedAt", "2026-07-15T18:01:00Z");

    const { action } = await import("~/routes/app.ops");
    const result = await action({
      context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
      request: new Request("http://localhost/app/ops", { method: "POST", body: formData }),
    } as never);

    expect(result).toMatchObject({
      ok: true,
      attemptId: "instant-whatsapp-attempt-1",
      message: expect.stringContaining("No WhatsApp was resent"),
    });
    expect(reconcileInstantChannelAttemptWithAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operatorUserId: "user-1",
        attemptId: "instant-whatsapp-attempt-1",
        channel: "whatsapp",
        outcome: "sent",
      }),
    );
  });

	it("requeues an exhausted digest period through the audited no-send recovery action", async () => {
		const requeueExhaustedDigestScheduleJobWithAudit = vi.fn().mockResolvedValue({
			ok: true,
			replayed: false,
			jobId: "digest-schedule:weekly:owner-1",
			requeuedAt: "2026-07-16T12:00:00.000Z",
		});
		vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
		vi.doMock("~/lib/data.server", () => ({ requeueExhaustedDigestScheduleJobWithAudit }));
		const formData = new FormData();
		formData.set("intent", "requeue-digest-schedule-job");
		formData.set("jobId", "digest-schedule:weekly:owner-1");
		formData.set("requeueKey", "digest-schedule-requeue:11111111-1111-4111-8111-111111111111");
		formData.set("expectedUpdatedAt", "2026-07-16T11:59:00.000Z");

		const { action } = await import("~/routes/app.ops");
		const result = await action({
			context: createContext({ OPS_ALLOWLIST_EMAILS: "owner@example.com" }),
			request: new Request("http://localhost/app/ops", { method: "POST", body: formData }),
		} as never);

		expect(result).toMatchObject({
			ok: true,
			jobId: "digest-schedule:weekly:owner-1",
			message: expect.stringContaining("guarded retry"),
		});
		expect(requeueExhaustedDigestScheduleJobWithAudit).toHaveBeenCalledWith(
			expect.anything(),
			{
				operatorUserId: "user-1",
				jobId: "digest-schedule:weekly:owner-1",
				expectedUpdatedAt: "2026-07-16T11:59:00.000Z",
				idempotencyKey: "digest-schedule-requeue:11111111-1111-4111-8111-111111111111",
			},
		);
	});
});
