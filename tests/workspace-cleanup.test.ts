import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteCollection,
  deleteCollectionItem,
  deactivateWatchlistsBeyondPlanLimit,
  setWatchlistActive,
} from "~/lib/data.server";

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

function createCapturingDb(changes = 1) {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];
  return {
    statements,
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            statements.push({ sql, bindings });
            return {
              async run() {
                return { success: true, meta: { changes } };
              },
              async all<T>() {
                return { results: [] as T[] };
              },
            };
          },
        };
      },
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/delivery.server");
  vi.doUnmock("~/lib/plan.server");
  vi.doUnmock("~/lib/monitoring.server");
  vi.doUnmock("~/lib/ad-source.server");
});

describe("workspace cleanup persistence", () => {
  it("pauses and resumes watchlists scoped to the owner", async () => {
    const mock = createCapturingDb();

    expect(
      await setWatchlistActive(
        { DB: mock.db } as never,
        "user-1",
        "watch-1",
        false,
      ),
    ).toBe(true);

    const update = mock.statements.find((statement) =>
      statement.sql.includes("UPDATE watchlist"),
    );
    expect(update?.sql).toContain("AND user_id = ?");
    expect(update?.bindings[0]).toBe(0);
    // a deliberate user pause is stamped so renewals never force-resume it
    expect(update?.bindings[1]).toBe("user");
    expect(update?.bindings.slice(3)).toEqual(["watch-1", "user-1"]);
    const mentionSync = mock.statements.find((statement) =>
      statement.sql.includes("UPDATE web_mention_target"),
    );
    expect(mentionSync?.sql).toContain("SELECT watchlist.is_active");
    expect(mentionSync?.bindings.slice(1)).toEqual(["user-1", "user-1"]);

    const noMatch = createCapturingDb(0);
    expect(
      await setWatchlistActive(
        { DB: noMatch.db } as never,
        "user-2",
        "watch-1",
        true,
      ),
    ).toBe(false);
  });

  it("deletes collections and items only for the owning user", async () => {
    const mock = createCapturingDb();

    expect(
      await deleteCollection(
        { DB: mock.db } as never,
        "user-1",
        "collection-1",
      ),
    ).toBe(true);
    expect(
      await deleteCollectionItem({ DB: mock.db } as never, "user-1", "item-1"),
    ).toBe(true);

    const collectionDelete = mock.statements.find((statement) =>
      statement.sql.includes("DELETE FROM collection "),
    );
    expect(collectionDelete?.sql).toContain("AND user_id = ?");

    const itemDelete = mock.statements.find((statement) =>
      statement.sql.includes("DELETE FROM collection_item"),
    );
    expect(itemDelete?.sql).toContain(
      "SELECT id FROM collection WHERE user_id = ?",
    );
  });
});

describe("reactivateWatchlistsUpToPlanLimit", () => {
  it("resumes the newest paused watchlists only up to the free slots", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            statements.push({ sql, bindings });
            return {
              async run() {
                return { success: true, meta: { changes: 2 } };
              },
              async all<T>() {
                if (sql.includes("COUNT(*)")) {
                  return { results: [{ count: 1 }] as T[] };
                }
                return { results: [] as T[] };
              },
            };
          },
        };
      },
    };

    const { reactivateWatchlistsUpToPlanLimit } =
      await import("~/lib/data.server");
    const resumed = await reactivateWatchlistsUpToPlanLimit(
      { DB: db } as never,
      "user-1",
      3,
    );

    expect(resumed).toBe(2);
    const update = statements.find((statement) =>
      statement.sql.includes("SET is_active = 1"),
    );
    // 1 already active of 3 allowed → 2 slots
    expect(update?.bindings.slice(1)).toEqual(["user-1", "user-1", 2]);
    expect(update?.sql).toContain("ORDER BY updated_at DESC");
    const mentionSync = statements.find((statement) =>
      statement.sql.includes("UPDATE web_mention_target"),
    );
    expect(mentionSync?.bindings.slice(1)).toEqual(["user-1", "user-1"]);
  });

  it("does nothing when the plan is already at its limit", async () => {
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async run() {
                statements.push(sql);
                return { success: true, meta: { changes: 9 } };
              },
              async all<T>() {
                return { results: [{ count: 3 }] as T[] };
              },
            };
          },
        };
      },
    };

    const { reactivateWatchlistsUpToPlanLimit } =
      await import("~/lib/data.server");
    const resumed = await reactivateWatchlistsUpToPlanLimit(
      { DB: db } as never,
      "user-1",
      3,
    );

    expect(resumed).toBe(0);
    expect(statements.some((sql) => sql.includes("SET is_active = 1"))).toBe(
      false,
    );
  });
});

describe("deactivateWatchlistsBeyondPlanLimit", () => {
  it("syncs web mention targets after plan-limit pauses", async () => {
    const mock = createCapturingDb();

    const paused = await deactivateWatchlistsBeyondPlanLimit(
      { DB: mock.db } as never,
      "user-1",
      1,
    );

    expect(paused).toBe(1);
    const mentionSync = mock.statements.find((statement) =>
      statement.sql.includes("UPDATE web_mention_target"),
    );
    expect(mentionSync?.sql).toContain("SELECT watchlist.is_active");
    expect(mentionSync?.bindings.slice(1)).toEqual(["user-1", "user-1"]);
  });
});

describe("watchlist pause/resume action", () => {
  it("blocks resume at the plan limit so paused watchlists cannot bypass it", async () => {
    const setWatchlistActiveMock = vi.fn();
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
      setWatchlistActive: setWatchlistActiveMock,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("scout"),
      checkPlanLimit: vi
        .fn()
        .mockResolvedValue({ allowed: false, limit: 3, current: 3 }),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "resume-watchlist");
    formData.set("watchlistId", "watch-1");

    const result = await action({
      context: { cloudflare: { env: {} } },
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({ ok: false, error: "plan_limit_exceeded" });
    expect(setWatchlistActiveMock).not.toHaveBeenCalled();
  });

  it("refuses to send a test email to another user's target", async () => {
    const sendDeliveryTestEmail = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("scout"),
      checkPlanLimit: vi.fn(),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById: vi.fn().mockResolvedValue({
        id: "target-1",
        userId: "someone-else",
        channel: "email",
        targetValue: "victim@example.com",
      }),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      sendDeliveryTestEmail,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "send-test-email");
    formData.set("targetId", "target-1");

    const result = await action({
      context: { cloudflare: { env: {} } },
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({ ok: false });
    expect(sendDeliveryTestEmail).not.toHaveBeenCalled();
  });
});

describe("sendDeliveryTestEmail", () => {
  it("sends through the shared email path and records a delivery_test attempt", async () => {
    const emailSend = vi.fn().mockResolvedValue({ messageId: "msg_test_1" });
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("scout"),
    }));
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getDeliveryTargetById: vi.fn(),
      getDeliveryTargetByProviderIdentifier: vi.fn(),
      getWatchlistDeliveryConfig: vi.fn(),
      getWorkspaceDeliveryConfig: vi.fn(),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
      updateDeliveryAttemptResult: vi.fn(),
      upsertDeliveryTarget: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));

    const { sendDeliveryTestEmail } = await import("~/lib/delivery.server");
    const sent = await sendDeliveryTestEmail(
      {
        EMAIL: { send: emailSend },
        EMAIL_FROM_EMAIL: "alerts@0509.io",
      } as never,
      { userId: "user-1", email: "owner@example.com", name: "Owner" },
    );

    expect(sent).toBe(true);
    const payload = emailSend.mock.calls[0]?.[0];
    expect(payload.to).toBe("owner@example.com");
    expect(payload.subject).toContain("Test email");

    const attempt = createDeliveryAttempt.mock.calls[0]?.[1];
    expect(attempt.templateName).toBe("delivery_test");
    expect(attempt.status).toBe("sent");
  });
});

describe("customer-at-risk operator alert", () => {
  it("counts only LEADING failures as consecutive", async () => {
    const { countLeadingFailures } = await import("~/lib/data.server");

    expect(countLeadingFailures(["failed", "failed", "failed"])).toBe(3);
    expect(countLeadingFailures(["failed", "succeeded", "failed"])).toBe(1);
    expect(countLeadingFailures(["succeeded", "failed", "failed"])).toBe(0);
    expect(countLeadingFailures([])).toBe(0);
  });

  it("treats provider-cooldown failures as soft so they don't trip the streak", async () => {
    const { isSoftScanFailure } = await import("~/lib/data.server");

    expect(isSoftScanFailure("failed", "rate_limited")).toBe(true);
    expect(isSoftScanFailure("failed", "cache_only")).toBe(true);
    expect(isSoftScanFailure("failed", "browser_crash")).toBe(false);
    expect(isSoftScanFailure("failed", null)).toBe(false);
    expect(isSoftScanFailure("succeeded", "rate_limited")).toBe(false);
  });

  it("sends one alert with all signals, and nothing when all clear", async () => {
    const sendOperatorAlertEmail = vi.fn().mockResolvedValue(true);
    vi.doMock("~/lib/delivery.server", () => ({ sendOperatorAlertEmail }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorRiskSummary: vi.fn().mockResolvedValue({
        troubleWatchlists: [
          {
            id: "w1",
            name: "Nykaa watch",
            userEmail: "owner@example.com",
            consecutiveFailures: 4,
          },
        ],
        staleWatchlists: [
          {
            id: "w2",
            name: "Mamaearth watch",
            userEmail: "owner@example.com",
            lastScannedAt: null,
          },
        ],
        deliveryFailures24h: 2,
        stuckRuns: 0,
      }),
    }));

    const { sendCustomerAtRiskAlert } = await import("~/lib/monitoring.server");
    const result = await sendCustomerAtRiskAlert({ DB: {} } as never, {
      skippedForBudget: 3,
      idempotencyKey: "operator-alert:scan-budget:2026-07-03",
    });

    expect(result.sent).toBe(true);
    const call = sendOperatorAlertEmail.mock.calls[0]?.[1] as {
      subject: string;
      lines: string[];
      idempotencyKey?: string;
    };
    expect(call.idempotencyKey).toBe("operator-alert:scan-budget:2026-07-03");
    expect(call.lines).toHaveLength(4);
    expect(call.lines[0]).toContain("3 watchlist(s) were SKIPPED");
    expect(call.lines[1]).toContain("Mamaearth watch");
    expect(call.lines[1]).toContain("not been scanned");
    expect(call.lines[2]).toContain("Nykaa watch");
    expect(call.lines[2]).toContain("4 scans in a row");

    vi.resetModules();
    vi.doMock("~/lib/delivery.server", () => ({ sendOperatorAlertEmail }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorRiskSummary: vi.fn().mockResolvedValue({
        troubleWatchlists: [],
        staleWatchlists: [],
        deliveryFailures24h: 0,
        stuckRuns: 0,
      }),
    }));
    const fresh = await import("~/lib/monitoring.server");
    const quiet = await fresh.sendCustomerAtRiskAlert({ DB: {} } as never);
    expect(quiet).toMatchObject({ sent: false, reason: "all_clear" });
  });

  it("reports fan-out dispatch failures separately from scan-budget skips", async () => {
    const sendOperatorAlertEmail = vi.fn().mockResolvedValue(true);
    vi.doMock("~/lib/delivery.server", () => ({ sendOperatorAlertEmail }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorRiskSummary: vi.fn().mockResolvedValue({
        troubleWatchlists: [],
        staleWatchlists: [],
        deliveryFailures24h: 0,
        stuckRuns: 0,
      }),
    }));

    const { sendCustomerAtRiskAlert } = await import("~/lib/monitoring.server");
    const result = await sendCustomerAtRiskAlert({ DB: {} } as never, {
      dispatchFailures: 2,
      idempotencyKey: "operator-alert:fanout-dispatch:2026-07-03",
    });

    expect(result.sent).toBe(true);
    const call = sendOperatorAlertEmail.mock.calls[0]?.[1] as {
      lines: string[];
      idempotencyKey?: string;
    };
    expect(call.idempotencyKey).toBe(
      "operator-alert:fanout-dispatch:2026-07-03",
    );
    expect(call.lines).toHaveLength(1);
    expect(call.lines[0]).toContain("fan-out job(s) failed to dispatch");
    expect(call.lines[0]).not.toContain("check window filled");
  });
});

describe("account deletion billing guard", () => {
  it("blocks deletion for any non-free plan and allows settled accounts", async () => {
    const { assertAccountDeletable } = await import("~/lib/auth.server");

    for (const plan of ["scout", "starter", "agency"]) {
      expect(() =>
        assertAccountDeletable({ plan, dodoStatus: "active" }),
      ).toThrow(/subscription is still active/i);
    }
    expect(() =>
      assertAccountDeletable({
        plan: "starter",
        dodoStatus: "subscription.on_hold",
      }),
    ).toThrow();
    expect(() =>
      assertAccountDeletable({ plan: "free", dodoStatus: null }),
    ).not.toThrow();
    expect(() =>
      assertAccountDeletable({ plan: "free", dodoStatus: "refunded" }),
    ).not.toThrow();
    expect(() =>
      assertAccountDeletable({
        plan: "free",
        dodoStatus: "subscription.cancelled",
      }),
    ).not.toThrow();
  });
});

describe("operator alert FK attribution", () => {
  function deliveryDataMock(userByEmail: string | null, oldest: string | null) {
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getOldestUserId: vi.fn().mockResolvedValue(oldest),
      getUserIdByEmail: vi.fn().mockResolvedValue(userByEmail),
      getDeliveryTargetById: vi.fn(),
      getDeliveryTargetByProviderIdentifier: vi.fn(),
      getWatchlistDeliveryConfig: vi.fn(),
      getWorkspaceDeliveryConfig: vi.fn(),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
      updateDeliveryAttemptResult: vi.fn(),
      upsertDeliveryTarget: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    return createDeliveryAttempt;
  }

  it("attributes the ledger row to a REAL user id, never a synthetic one", async () => {
    const emailSend = vi.fn().mockResolvedValue({ messageId: "msg_op_1" });
    const createDeliveryAttempt = deliveryDataMock(null, "founder-user-id");

    const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
    const sent = await sendOperatorAlertEmail(
      {
        EMAIL: { send: emailSend },
        EMAIL_FROM_EMAIL: "alerts@0509.io",
        LAUNCH_CANARY_EMAIL: "me@inish.in",
      } as never,
      { subject: "test", lines: ["signal"] },
    );

    expect(sent).toBe(true);
    const attempt = createDeliveryAttempt.mock.calls[0]?.[1];
    expect(attempt.userId).toBe("founder-user-id");
    expect(attempt.userId).not.toBe("operator");
  });

  it("stores only the case id for support-case operator alert snapshots", async () => {
    const emailSend = vi.fn().mockResolvedValue({ messageId: "msg_support_1" });
    const createDeliveryAttempt = deliveryDataMock(null, "founder-user-id");

    const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
    const sent = await sendOperatorAlertEmail(
      {
        EMAIL: { send: emailSend },
        EMAIL_FROM_EMAIL: "alerts@0509.io",
        LAUNCH_CANARY_EMAIL: "me@inish.in",
      } as never,
      {
        subject: "0509 support case: Digest did not arrive",
        lines: [
          "Case: case-1",
          "Requester: owner@example.com",
          "Details: Private support detail should not persist.",
        ],
        idempotencyKey: "support-case:case-1",
      },
    );

    expect(sent).toBe(true);
    const attempt = createDeliveryAttempt.mock.calls[0]?.[1];
    expect(attempt.payloadSnapshot).toEqual({
      kind: "support_case_operator_alert",
      caseId: "case-1",
    });
    expect(JSON.stringify(attempt.payloadSnapshot)).not.toContain(
      "Private support detail",
    );
    expect(JSON.stringify(attempt.payloadSnapshot)).not.toContain(
      "owner@example.com",
    );
  });

  it("stores only the case id for reopened support-case operator alert snapshots", async () => {
    const emailSend = vi
      .fn()
      .mockResolvedValue({ messageId: "msg_support_reopen_1" });
    const createDeliveryAttempt = deliveryDataMock(null, "founder-user-id");

    const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
    const sent = await sendOperatorAlertEmail(
      {
        EMAIL: { send: emailSend },
        EMAIL_FROM_EMAIL: "alerts@0509.io",
        LAUNCH_CANARY_EMAIL: "me@inish.in",
      } as never,
      {
        subject: "0509 support case reopened: Delete my account",
        lines: [
          "Case: case-1",
          "Requester: owner@example.com",
          "Details: Private support detail should not persist.",
        ],
        idempotencyKey: "support-case-reopen:case-1:2026-06-28T17:30:00.000Z",
      },
    );

    expect(sent).toBe(true);
    const attempt = createDeliveryAttempt.mock.calls[0]?.[1];
    expect(attempt.payloadSnapshot).toEqual({
      kind: "support_case_operator_alert",
      caseId: "case-1",
    });
    expect(JSON.stringify(attempt.payloadSnapshot)).not.toContain(
      "Private support detail",
    );
    expect(JSON.stringify(attempt.payloadSnapshot)).not.toContain(
      "owner@example.com",
    );
  });

  it("fails closed before the provider when no durable operator-attempt owner exists", async () => {
    const emailSend = vi.fn().mockResolvedValue({ messageId: "msg_op_2" });
    const createDeliveryAttempt = deliveryDataMock(null, null);

    const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
    const sent = await sendOperatorAlertEmail(
      {
        EMAIL: { send: emailSend },
        EMAIL_FROM_EMAIL: "alerts@0509.io",
        LAUNCH_CANARY_EMAIL: "me@inish.in",
      } as never,
      {
        subject: "test",
        lines: ["signal"],
        idempotencyKey: "operator-deletion:user-9",
      },
    );

    expect(sent).toBe(false);
    expect(emailSend).not.toHaveBeenCalled();
    expect(createDeliveryAttempt).not.toHaveBeenCalled();
  });

  it("retries failed operator alerts by updating the existing ledger row", async () => {
    const emailSend = vi.fn().mockResolvedValue({ messageId: "msg_op_retry" });
    const createDeliveryAttempt = vi.fn();
    const updateDeliveryAttemptResult = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue({
        id: "attempt-failed-1",
        status: "failed",
        webhookStatus: "failed",
        updatedAt: "2026-07-16T08:59:00.000Z",
      }),
      getOldestUserId: vi.fn().mockResolvedValue("founder-user-id"),
      getUserIdByEmail: vi.fn().mockResolvedValue(null),
      getDeliveryTargetById: vi.fn(),
      getDeliveryTargetByProviderIdentifier: vi.fn(),
      getWatchlistDeliveryConfig: vi.fn(),
      getWorkspaceDeliveryConfig: vi.fn(),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
      updateDeliveryAttemptResult,
      upsertDeliveryTarget: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));

    const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
    const sent = await sendOperatorAlertEmail(
      {
        EMAIL: { send: emailSend },
        EMAIL_FROM_EMAIL: "alerts@0509.io",
        LAUNCH_CANARY_EMAIL: "me@inish.in",
      } as never,
      {
        subject: "test",
        lines: ["signal"],
        idempotencyKey: "support-case:case-1",
      },
    );

    expect(sent).toBe(true);
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(createDeliveryAttempt).not.toHaveBeenCalled();
    expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
      expect.anything(),
      "attempt-failed-1",
      expect.objectContaining({
        provider: "cloudflare_email",
        status: "sent",
        providerMessageId: "msg_op_retry",
      }),
    );
  });

  it("does not resend an operator alert after provider acceptance becomes locally ambiguous", async () => {
    const emailSend = vi
      .fn()
      .mockResolvedValue({ messageId: "msg_op_ambiguous" });
    const createDeliveryAttempt = vi
      .fn()
      .mockResolvedValue("attempt-ambiguous-1");
    const durableAttempt = {
      id: "attempt-ambiguous-1",
      status: "pending",
      webhookStatus: "provider_unknown",
      updatedAt: "2026-07-16T09:00:01.000Z",
    };
    const getDeliveryAttemptByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(durableAttempt);
    const updateDeliveryAttemptResult = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(
        new Error("injected post-provider persistence failure"),
      );
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey,
      getOldestUserId: vi.fn().mockResolvedValue("founder-user-id"),
      getUserIdByEmail: vi.fn().mockResolvedValue(null),
      getDeliveryTargetById: vi.fn(),
      getDeliveryTargetByProviderIdentifier: vi.fn(),
      getWatchlistDeliveryConfig: vi.fn(),
      getWorkspaceDeliveryConfig: vi.fn(),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
      updateDeliveryAttemptResult,
      upsertDeliveryTarget: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));

    const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
    const env = {
      EMAIL: { send: emailSend },
      EMAIL_FROM_EMAIL: "alerts@0509.io",
      LAUNCH_CANARY_EMAIL: "me@inish.in",
    } as never;
    const alert = {
      subject: "test",
      lines: ["signal"],
      idempotencyKey: "cron-failure:digest_schedule_job_exhausted:job-1:1",
    };

    await expect(sendOperatorAlertEmail(env, alert)).rejects.toThrow(
      "injected post-provider persistence failure",
    );
    await expect(sendOperatorAlertEmail(env, alert)).resolves.toBe(false);

    expect(createDeliveryAttempt).toHaveBeenCalledTimes(1);
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "attempt-ambiguous-1",
      expect.objectContaining({
        status: "pending",
        webhookStatus: "provider_unknown",
        expectedStatus: "pending",
        expectedWebhookStatus: "pending",
      }),
    );
  });
});

describe("paused_reason semantics", () => {
  it("reactivation targets only plan-limit pauses, never user pauses or retargets", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            statements.push({ sql, bindings });
            return {
              async run() {
                return { success: true, meta: { changes: 1 } };
              },
              async all<T>() {
                if (sql.includes("COUNT(*)"))
                  return { results: [{ count: 0 }] as T[] };
                return { results: [] as T[] };
              },
            };
          },
        };
      },
    };

    const { reactivateWatchlistsUpToPlanLimit } =
      await import("~/lib/data.server");
    await reactivateWatchlistsUpToPlanLimit({ DB: db } as never, "user-1", 3);

    const update = statements.find((statement) =>
      statement.sql.includes("SET is_active = 1"),
    );
    expect(update?.sql).toContain(
      "paused_reason = 'plan_limit' OR paused_reason IS NULL",
    );
    expect(update?.sql).toContain("paused_reason = NULL");
  });
});

describe("migrateAutoProvisionedEmailTargets", () => {
  it("retargets only auto-provisioned, non-opted-out email rows and cleans twins", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            statements.push({ sql, bindings });
            return {
              async run() {
                return { success: true, meta: { changes: 1 } };
              },
              async all<T>() {
                return { results: [] as T[] };
              },
            };
          },
        };
      },
    };

    const { migrateAutoProvisionedEmailTargets } =
      await import("~/lib/data.server");
    const changed = await migrateAutoProvisionedEmailTargets(
      { DB: db } as never,
      "user-1",
      "new@example.com",
    );

    expect(changed).toBe(1);
    const update = statements.find((statement) =>
      statement.sql.includes("UPDATE OR IGNORE delivery_target"),
    );
    expect(update?.sql).toContain("opt_in_source = 'account_email'");
    expect(update?.sql).toContain("opted_out_at IS NULL");
    expect(update?.bindings[0]).toBe("new@example.com");
    const cleanup = statements.find((statement) =>
      statement.sql.includes("DELETE FROM delivery_target"),
    );
    expect(cleanup?.sql).toContain("opt_in_source = 'account_email'");
  });
});

describe("weekly business numbers", () => {
  it("formats the operator summary lines and dedupes per week", async () => {
    const sendOperatorAlertEmail = vi.fn().mockResolvedValue(true);
    vi.doMock("~/lib/delivery.server", () => ({ sendOperatorAlertEmail }));
    vi.doMock("~/lib/data.server", () => ({
      getWeeklyBusinessSummary: vi.fn().mockResolvedValue({
        signups7d: 5,
        activated7d: 3,
        payingByPlan: [
          { plan: "agency", count: 1 },
          { plan: "starter", count: 4 },
        ],
        dunningCount: 1,
        revokedToFree7d: 2,
        digestAttempts7d: 40,
        digestSent7d: 38,
        oldestActivePaidScanAt: "2026-06-10T04:00:00.000Z",
      }),
    }));

    const { sendWeeklyBusinessNumbers } =
      await import("~/lib/monitoring.server");
    const result = await sendWeeklyBusinessNumbers({ DB: {} } as never);

    expect(result.sent).toBe(true);
    const call = sendOperatorAlertEmail.mock.calls[0]?.[1] as {
      subject: string;
      lines: string[];
      idempotencyKey: string;
    };
    expect(call.subject).toContain("weekly business numbers");
    expect(call.idempotencyKey).toMatch(/^business-weekly:\d{4}-\d{2}-\d{2}$/);
    expect(call.lines[0]).toContain("Signups (7d): 5");
    expect(call.lines[0]).toContain("activated onboarding: 3");
    expect(call.lines[1]).toContain("agency: 1, starter: 4");
    expect(call.lines[2]).toContain("Dunning");
    expect(call.lines[4]).toContain("95% (38/40)");
  });

  it("reports honest empties when there is no traffic yet", async () => {
    const { buildWeeklyBusinessLines } =
      await import("~/lib/monitoring.server");
    const lines = buildWeeklyBusinessLines({
      signups7d: 0,
      activated7d: 0,
      payingByPlan: [],
      dunningCount: 0,
      revokedToFree7d: 0,
      digestAttempts7d: 0,
      digestSent7d: 0,
      oldestActivePaidScanAt: null,
    });

    expect(lines[1]).toContain("none yet");
    expect(lines[4]).toContain("no digests sent");
    expect(lines[5]).toContain("n/a");
  });
});
