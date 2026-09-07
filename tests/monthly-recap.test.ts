import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildMonthlyRecapEmail,
  isFirstMondayOfMonth,
  monthBoundsUtc,
  previousCalendarMonthKey,
} from "~/lib/monthly-recap.server";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("monthly recap calendar helpers", () => {
  it("detects the first Monday of a month in UTC", () => {
    // 2026-07-06 is the first Monday of July 2026
    expect(isFirstMondayOfMonth(new Date("2026-07-06T05:00:00.000Z"))).toBe(true);
    // Second Monday
    expect(isFirstMondayOfMonth(new Date("2026-07-13T05:00:00.000Z"))).toBe(false);
    // First day is Wednesday
    expect(isFirstMondayOfMonth(new Date("2026-07-01T05:00:00.000Z"))).toBe(false);
  });

  it("keys the previous calendar month", () => {
    expect(previousCalendarMonthKey(new Date("2026-07-06T05:00:00.000Z"))).toBe("2026-06");
    expect(previousCalendarMonthKey(new Date("2026-01-05T05:00:00.000Z"))).toBe("2025-12");
  });

  it("bounds a month key as UTC half-open interval", () => {
    const bounds = monthBoundsUtc("2026-06");
    expect(bounds.start).toBe("2026-06-01T00:00:00.000Z");
    expect(bounds.end).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("buildMonthlyRecapEmail", () => {
  it("renders activity stats and billing link", () => {
    const model = buildMonthlyRecapEmail({
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
      plan: "starter",
      monthKey: "2026-06",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-07-01T00:00:00.000Z",
      changesCaught: 12,
      evidenceCaptured: 4,
      includedAllowance: 250,
      topCompetitorName: "Nykaa",
      topCompetitorChanges: 7,
      billingUrl: "https://0509.io/app/billing",
    });

    expect(model.subject).toContain("12 changes");
    expect(model.html).toContain("12");
    expect(model.html).toContain("4");
    expect(model.html).toContain("250");
    expect(model.html).toContain("Nykaa");
    expect(model.html).toContain("https://0509.io/app/billing");
    expect(model.text).toContain("Changes caught: 12");
  });

  it("escapes scraped competitor names and user names (HTML injection proof)", () => {
    const model = buildMonthlyRecapEmail({
      userId: "user-1",
      email: "owner@example.com",
      name: '<img src=x onerror=alert(1)>',
      plan: "starter",
      monthKey: "2026-06",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-07-01T00:00:00.000Z",
      changesCaught: 3,
      evidenceCaptured: 1,
      includedAllowance: 250,
      // topCompetitorName is a scraped/user-controlled watchlist label.
      topCompetitorName: '</strong><script>alert(document.cookie)</script>',
      topCompetitorChanges: 2,
      billingUrl: "https://0509.io/app/billing",
    });

    // Raw markup never reaches the rendered HTML.
    expect(model.html).not.toContain("<script>alert(document.cookie)</script>");
    expect(model.html).not.toContain("<img src=x onerror=alert(1)>");
    // The payloads survive as inert, escaped text.
    expect(model.html).toContain("&lt;script&gt;alert(document.cookie)&lt;/script&gt;");
    expect(model.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("sendMonthlyCustomerRecaps", () => {
  it("no-ops when not the first Monday unless forced", async () => {
    const { sendMonthlyCustomerRecaps } = await import("~/lib/monthly-recap.server");
    const result = await sendMonthlyCustomerRecaps(
      { DB: {} } as never,
      { scheduledTime: Date.parse("2026-07-13T05:00:00.000Z") },
    );
    expect(result).toEqual({
      attempted: 0,
      sent: 0,
      skipped: 0,
      duplicates: 0,
      claimLost: 0,
      failed: 0,
    });
  });

  it("sends one recap per paid user with activity and dedupes by month key", async () => {
    const claimInstantDeliveryAttempt = vi
      .fn()
      .mockResolvedValueOnce({
        attemptId: "attempt-1",
        claimUpdatedAt: "2026-07-06T05:00:00.000Z",
      })
      .mockResolvedValueOnce({ attemptId: null, claimUpdatedAt: null })
      .mockResolvedValueOnce({
        attemptId: "attempt-3",
        claimUpdatedAt: "2026-07-06T05:00:03.000Z",
      });
    const markInstantDeliveryDispatchStarted = vi
      .fn()
      .mockResolvedValueOnce("2026-07-06T05:00:01.000Z")
      .mockResolvedValueOnce(null);
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    const sendCloudflareEmail = vi.fn().mockResolvedValue({
      provider: "cloudflare",
      status: "sent",
      webhookStatus: "provider_unknown",
      providerMessageId: "msg-1",
      providerStatusLastSeenAt: "2026-07-06T05:00:02.000Z",
      errorMessage: null,
      deliveredAt: null,
    });
    const upsertDeliveryTarget = vi.fn().mockResolvedValue({
      id: "target-1",
      channel: "email",
      targetValue: "owner@example.com",
      validationStatus: "validated",
      isValidated: true,
      isOptedIn: true,
      isPaused: false,
      optedOutAt: null,
      optInSource: "account_email",
      metadata: { autoProvisioned: true },
    });

    vi.doMock("~/lib/email-verification.server", () => ({
      isUserEmailVerified: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("~/lib/unsubscribe.server", () => ({
      buildUnsubscribeUrl: vi.fn().mockResolvedValue("https://0509.io/unsubscribe/token"),
    }));
    vi.doMock("~/lib/data.server", () => ({
      claimInstantDeliveryAttempt,
      markInstantDeliveryDispatchStarted,
      updateDeliveryAttemptResult,
      getDeliveryAttemptByIdempotencyKey: vi
        .fn()
        .mockResolvedValueOnce({
          status: "pending",
          webhookStatus: "provider_unknown",
          updatedAt: "2026-07-06T05:00:04.000Z",
        })
        .mockResolvedValueOnce({
          status: "pending",
          webhookStatus: "pending",
          updatedAt: "2026-07-06T05:00:05.000Z",
        }),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        email: "owner@example.com",
        name: "Owner",
      }),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        emailEnabled: true,
      }),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      provisionVerifiedAccountEmailTargetIfUnsuppressed: upsertDeliveryTarget,
      upsertDeliveryTarget,
    }));
    vi.doMock("~/lib/delivery-email-core.server", () => ({
      EMAIL_PROVIDER: "cloudflare",
      appBaseUrl: () => "https://0509.io",
      escapeHtml: (value: string) => value,
      providerAcceptedAt: () => "2026-07-06T05:00:02.000Z",
      sendCloudflareEmail,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
    }));
    vi.doMock("~/lib/data/d1.server", () => ({
      queryAll: vi.fn().mockResolvedValue([
        {
          user_id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          plan: "starter",
        },
      ]),
      queryOne: vi.fn().mockImplementation(async (_env: unknown, sql: string) => {
        if (sql.includes("proof_capture")) {
          return { count: 3 };
        }
        if (sql.includes("COUNT(*)") && sql.includes("watch_event") && !sql.includes("GROUP BY")) {
          return { count: 5 };
        }
        if (sql.includes("GROUP BY")) {
          return { name: "Nykaa watch", target_label: "Nykaa", count: 5 };
        }
        return null;
      }),
    }));

    const { sendMonthlyCustomerRecaps } = await import("~/lib/monthly-recap.server");

    const first = await sendMonthlyCustomerRecaps(
      { DB: {} } as never,
      { scheduledTime: Date.parse("2026-07-06T05:00:00.000Z") },
    );
    expect(first.sent).toBe(1);
    expect(sendCloudflareEmail).toHaveBeenCalledTimes(1);
    expect(sendCloudflareEmail.mock.calls[0]?.[1]).toMatchObject({
      unsubscribeUrl: "https://0509.io/unsubscribe/token",
    });
    expect(claimInstantDeliveryAttempt.mock.calls[0]?.[1]).toMatchObject({
      idempotencyKey: "recap:user-1:2026-06",
      templateName: "monthly_recap",
      deliveryTargetId: "target-1",
    });
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        targetValue: "owner@example.com",
        optInSource: "account_email",
        metadata: { autoProvisioned: true },
      }),
    );

    const second = await sendMonthlyCustomerRecaps(
      { DB: {} } as never,
      { scheduledTime: Date.parse("2026-07-06T05:00:00.000Z") },
    );
    expect(second.duplicates).toBe(1);
    expect(second.sent).toBe(0);

    const claimLost = await sendMonthlyCustomerRecaps(
      { DB: {} } as never,
      { scheduledTime: Date.parse("2026-07-06T05:00:00.000Z") },
    );
    expect(claimLost).toMatchObject({
      claimLost: 1,
      failed: 0,
      sent: 0,
      duplicates: 0,
    });

    claimInstantDeliveryAttempt.mockResolvedValueOnce({
      attemptId: "attempt-4",
      claimUpdatedAt: "2026-07-06T05:00:05.000Z",
    });
    markInstantDeliveryDispatchStarted.mockResolvedValueOnce(null);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejected = await sendMonthlyCustomerRecaps(
      { DB: {} } as never,
      { scheduledTime: Date.parse("2026-07-06T05:00:00.000Z") },
    );
    expect(rejected).toMatchObject({
      claimLost: 0,
      failed: 1,
      sent: 0,
      duplicates: 0,
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Monthly recap dispatch gate rejected.",
      expect.objectContaining({
        userId: "user-1",
        reason: "dispatch_gate_rejected",
      }),
    );
  });

  it("skips users with zero activity", async () => {
    vi.doMock("~/lib/data.server", () => ({
      claimInstantDeliveryAttempt: vi.fn(),
      markInstantDeliveryDispatchStarted: vi.fn(),
      updateDeliveryAttemptResult: vi.fn(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        email: "owner@example.com",
        name: "Owner",
      }),
    }));
    vi.doMock("~/lib/delivery-email-core.server", () => ({
      EMAIL_PROVIDER: "cloudflare",
      appBaseUrl: () => "https://0509.io",
      escapeHtml: (value: string) => value,
      providerAcceptedAt: () => null,
      sendCloudflareEmail: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
    }));
    vi.doMock("~/lib/data/d1.server", () => ({
      queryAll: vi.fn().mockResolvedValue([
        {
          user_id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          plan: "starter",
        },
      ]),
      queryOne: vi.fn().mockResolvedValue({ count: 0 }),
    }));

    const { sendMonthlyCustomerRecaps } = await import("~/lib/monthly-recap.server");
    const result = await sendMonthlyCustomerRecaps(
      { DB: {} } as never,
      { force: true, scheduledTime: Date.parse("2026-07-06T05:00:00.000Z") },
    );
    expect(result).toMatchObject({
      attempted: 1,
      sent: 0,
      skipped: 1,
      failed: 0,
    });
  });

  it("counts per-user data failures separately from intentional skips", async () => {
    vi.doMock("~/lib/data.server", () => ({
      claimInstantDeliveryAttempt: vi.fn(),
      markInstantDeliveryDispatchStarted: vi.fn(),
      updateDeliveryAttemptResult: vi.fn(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        email: "owner@example.com",
        name: "Owner",
      }),
    }));
    vi.doMock("~/lib/delivery-email-core.server", () => ({
      EMAIL_PROVIDER: "cloudflare",
      appBaseUrl: () => "https://0509.io",
      escapeHtml: (value: string) => value,
      providerAcceptedAt: () => null,
      sendCloudflareEmail: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
    }));
    vi.doMock("~/lib/data/d1.server", () => ({
      queryAll: vi.fn().mockResolvedValue([
        {
          user_id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          plan: "starter",
        },
      ]),
      queryOne: vi.fn().mockRejectedValue(new Error("recap stats unavailable")),
    }));

    const { sendMonthlyCustomerRecaps } = await import("~/lib/monthly-recap.server");
    const result = await sendMonthlyCustomerRecaps(
      { DB: {} } as never,
      { force: true, scheduledTime: Date.parse("2026-07-06T05:00:00.000Z") },
    );

    expect(result).toMatchObject({
      attempted: 1,
      sent: 0,
      skipped: 0,
      failed: 1,
    });
  });
});
