import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/better-auth.server");
  vi.doUnmock("~/lib/email-verification.server");
});

function mockDeliveryDataServer(createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1")) {
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
  return createDeliveryAttempt;
}

describe("sendEmailVerificationEmail", () => {
  it("sends via delivery without unsubscribe headers and never stores the token url", async () => {
    const emailSend = vi.fn().mockResolvedValue({ messageId: "msg_verify_1" });
    const createDeliveryAttempt = mockDeliveryDataServer();
    const env = {
      EMAIL: { send: emailSend },
      EMAIL_FROM_EMAIL: "alerts@0509.io",
    };

    const { sendEmailVerificationEmail } = await import("~/lib/delivery.server");
    await sendEmailVerificationEmail(env as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
      verifyUrl: "https://0509.io/api/auth/verify-email?token=secret-token&callbackURL=/app",
    });

    const payload = emailSend.mock.calls[0]?.[0];
    expect(payload.to).toBe("owner@example.com");
    expect(payload.subject).toContain("Verify");
    expect(payload.html).toContain("secret-token");
    expect(payload.headers["List-Unsubscribe"]).toBeUndefined();

    const attempt = createDeliveryAttempt.mock.calls[0]?.[1];
    expect(attempt.templateName).toBe("email_verification");
    expect(attempt.status).toBe("sent");
    expect(attempt.idempotencyKey).toContain("email-verification:user-1:");
    expect(JSON.stringify(attempt.payloadSnapshot)).not.toContain("secret-token");
    expect(JSON.stringify(attempt.payloadSnapshot)).not.toContain("verify-email");
  });
});

describe("email verification soft gates", () => {
  it("treats integer and boolean emailVerified flags as verified", async () => {
    const first = vi.fn().mockResolvedValue({ emailVerified: 1 });
    const { isUserEmailVerified } = await import("~/lib/email-verification.server");
    await expect(
      isUserEmailVerified({ DB: { prepare: () => ({ bind: () => ({ first }) }) } } as never, "user-1"),
    ).resolves.toBe(true);

    first.mockResolvedValueOnce({ emailVerified: true });
    await expect(
      isUserEmailVerified({ DB: { prepare: () => ({ bind: () => ({ first }) }) } } as never, "user-1"),
    ).resolves.toBe(true);

    first.mockResolvedValueOnce({ emailVerified: 0 });
    await expect(
      isUserEmailVerified({ DB: { prepare: () => ({ bind: () => ({ first }) }) } } as never, "user-1"),
    ).resolves.toBe(false);
  });

  it("skips customer digests for unverified users and never gates operator mail", async () => {
    const isUserEmailVerified = vi.fn().mockResolvedValue(false);
    vi.doMock("~/lib/email-verification.server", () => ({
      isUserEmailVerified,
    }));
    mockDeliveryDataServer();

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    const customer = await deliverWeeklyDigest(
      { EMAIL: { send: vi.fn() }, EMAIL_FROM_EMAIL: "alerts@0509.io" } as never,
      {
        userId: "user-1",
        userName: "Owner",
        accountEmail: "owner@example.com",
        digestRunId: "digest-1",
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-08T00:00:00.000Z",
        items: [],
        heartbeat: { runs: 1, watchlistsChecked: 1, adsSeen: 0 },
        lane: "customer",
      },
    );
    expect(customer.attempts).toBe(0);
    expect(isUserEmailVerified).toHaveBeenCalledTimes(1);

    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("app/lib/delivery.server.ts", "utf8"),
    );
    const operatorFn = source.slice(source.indexOf("export async function sendOperatorAlertEmail"));
    expect(operatorFn).not.toContain("isUserEmailVerified");
    expect(source).toContain('if (lane === "customer")');
  });
});

describe("requestEmailVerification anti-enumeration", () => {
  it("sanitizes callbackURL and always returns ok", async () => {
    const sendVerificationEmail = vi.fn().mockRejectedValue(new Error("unknown user"));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: () => true,
      getBetterAuth: () => ({
        api: { sendVerificationEmail },
      }),
    }));

    const { requestEmailVerification } = await import("~/lib/email-verification.server");
    const result = await requestEmailVerification(
      { DB: {}, BETTER_AUTH_SECRET: "secret", BETTER_AUTH_URL: "https://0509.io" } as never,
      new Request("https://0509.io/app/account"),
      {
        email: "owner@example.com",
        callbackURL: "https://evil.example/phish",
      },
    );

    expect(result).toEqual({ ok: true });
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          email: "owner@example.com",
          callbackURL: "/app",
        }),
      }),
    );
  });
});
