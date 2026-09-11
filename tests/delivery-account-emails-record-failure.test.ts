import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/data.server");
});

// The provider send is irreversible by the time these functions record the
// attempt: the email is already in the inbox. A D1 insert failure must not
// surface as a send failure, or the caller retries and a second identical
// secret-bearing email goes out with the first send never recorded.
function mockDeliveryDataServer(createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1")) {
  vi.doMock("~/lib/data.server", () => ({
    claimInstantDeliveryAttempt: vi.fn(),
    createDeliveryAttempt,
    getDeliveryAttemptByIdempotencyKey: vi.fn(),
    getOldestUserId: vi.fn(),
    getUserDeliveryProfile: vi.fn(),
    getUserIdByEmail: vi.fn(),
    markInstantDeliveryDispatchStarted: vi.fn(),
    updateDeliveryAttemptResult: vi.fn(),
  }));
  return createDeliveryAttempt;
}

function emailSendEnv(emailSend = vi.fn().mockResolvedValue({ messageId: "m1" })) {
  return {
    env: {
      EMAIL: { send: emailSend },
      EMAIL_FROM_EMAIL: "alerts@0509.io",
    } as never,
    emailSend,
  };
}

const recordFailure = () => vi.fn().mockRejectedValue(new Error("D1 insert failed"));

describe("post-send delivery_attempt record failure", () => {
  it("sendPasswordResetEmail resolves when the send succeeded but the audit insert fails", async () => {
    mockDeliveryDataServer(recordFailure());
    const { env, emailSend } = emailSendEnv();
    const { sendPasswordResetEmail } = await import("~/lib/delivery-account-emails.server");

    await expect(
      sendPasswordResetEmail(env, {
        userId: "user-1",
        email: "owner@example.com",
        name: "Owner",
        resetUrl: "https://0509.io/api/auth/reset-password?token=secret-token",
      }),
    ).resolves.toBeUndefined();
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it("sendEmailVerificationEmail resolves when the send succeeded but the audit insert fails", async () => {
    mockDeliveryDataServer(recordFailure());
    const { env, emailSend } = emailSendEnv();
    const { sendEmailVerificationEmail } = await import("~/lib/delivery-account-emails.server");

    await expect(
      sendEmailVerificationEmail(env, {
        userId: "user-1",
        email: "owner@example.com",
        name: "Owner",
        verifyUrl: "https://0509.io/api/auth/verify-email?token=secret-token",
      }),
    ).resolves.toBeUndefined();
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it("sendAccountActionEmail returns sent when the send succeeded but the audit insert fails", async () => {
    mockDeliveryDataServer(recordFailure());
    const { env, emailSend } = emailSendEnv();
    const { sendAccountActionEmail } = await import("~/lib/delivery-account-emails.server");

    await expect(
      sendAccountActionEmail(env, {
        userId: "user-1",
        email: "owner@example.com",
        name: "Owner",
        kind: "change_email",
        actionUrl: "https://0509.io/api/auth/change-email?token=secret-token",
      }),
    ).resolves.toBe(true);
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it("sendTeamInviteEmail returns sent when the send succeeded but the audit insert fails", async () => {
    mockDeliveryDataServer(recordFailure());
    const { env, emailSend } = emailSendEnv();
    const { sendTeamInviteEmail } = await import("~/lib/delivery-account-emails.server");

    await expect(
      sendTeamInviteEmail(env, {
        ownerUserId: "user-1",
        ownerName: "Owner",
        inviteeEmail: "invitee@example.com",
        acceptUrl: "https://0509.io/api/auth/accept-invite?token=secret-token",
      }),
    ).resolves.toBe(true);
    expect(emailSend).toHaveBeenCalledTimes(1);
  });
});

describe("provider failure still surfaces", () => {
  it("sendPasswordResetEmail throws when the provider reports failure", async () => {
    mockDeliveryDataServer();
    const { env } = emailSendEnv(vi.fn().mockRejectedValue(new Error("provider down")));
    const { sendPasswordResetEmail } = await import("~/lib/delivery-account-emails.server");

    await expect(
      sendPasswordResetEmail(env, {
        userId: "user-1",
        email: "owner@example.com",
        name: "Owner",
        resetUrl: "https://0509.io/api/auth/reset-password?token=secret-token",
      }),
    ).rejects.toThrow();
  });

  it("sendPasswordResetEmail still throws the provider error when the audit insert also fails", async () => {
    mockDeliveryDataServer(recordFailure());
    const { env } = emailSendEnv(vi.fn().mockRejectedValue(new Error("provider down")));
    const { sendPasswordResetEmail } = await import("~/lib/delivery-account-emails.server");

    await expect(
      sendPasswordResetEmail(env, {
        userId: "user-1",
        email: "owner@example.com",
        name: "Owner",
        resetUrl: "https://0509.io/api/auth/reset-password?token=secret-token",
      }),
    ).rejects.toThrow();
  });

  it("sendEmailVerificationEmail throws when the provider reports failure", async () => {
    mockDeliveryDataServer();
    const { env } = emailSendEnv(vi.fn().mockRejectedValue(new Error("provider down")));
    const { sendEmailVerificationEmail } = await import("~/lib/delivery-account-emails.server");

    await expect(
      sendEmailVerificationEmail(env, {
        userId: "user-1",
        email: "owner@example.com",
        name: "Owner",
        verifyUrl: "https://0509.io/api/auth/verify-email?token=secret-token",
      }),
    ).rejects.toThrow();
  });
});
