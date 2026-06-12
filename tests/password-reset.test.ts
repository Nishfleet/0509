import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
  vi.doUnmock("~/lib/auth-client");
  vi.doUnmock("~/lib/data.server");
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

describe("sendPasswordResetEmail", () => {
  it("sends the reset link without unsubscribe headers and never stores the token", async () => {
    const emailSend = vi.fn().mockResolvedValue({ messageId: "msg_reset_1" });
    const createDeliveryAttempt = mockDeliveryDataServer();
    const env = {
      EMAIL: { send: emailSend },
      EMAIL_FROM_EMAIL: "alerts@0509.in",
    };

    const { sendPasswordResetEmail } = await import("~/lib/delivery.server");
    await sendPasswordResetEmail(env as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
      resetUrl: "https://0509.in/api/auth/reset-password/secret-token?callbackURL=/auth/reset-password",
    });

    const payload = emailSend.mock.calls[0]?.[0];
    expect(payload.to).toBe("owner@example.com");
    expect(payload.subject).toContain("Reset");
    expect(payload.html).toContain("secret-token");
    // transactional: must reach unsubscribed users, so no unsubscribe header
    expect(payload.headers["List-Unsubscribe"]).toBeUndefined();

    const attempt = createDeliveryAttempt.mock.calls[0]?.[1];
    expect(attempt.templateName).toBe("password_reset");
    expect(attempt.status).toBe("sent");
    expect(attempt.idempotencyKey).toContain("password-reset:user-1:");
    // the reset URL carries a secret token — it must never be persisted
    expect(JSON.stringify(attempt.payloadSnapshot)).not.toContain("secret-token");
  });

  it("records a failed attempt and throws when the provider rejects the send", async () => {
    const emailSend = vi.fn().mockRejectedValue(new Error("smtp down"));
    const createDeliveryAttempt = mockDeliveryDataServer();
    const env = {
      EMAIL: { send: emailSend },
      EMAIL_FROM_EMAIL: "alerts@0509.in",
    };

    const { sendPasswordResetEmail } = await import("~/lib/delivery.server");

    await expect(
      sendPasswordResetEmail(env as never, {
        userId: "user-1",
        email: "owner@example.com",
        name: null,
        resetUrl: "https://0509.in/api/auth/reset-password/secret-token",
      }),
    ).rejects.toThrow();

    const attempt = createDeliveryAttempt.mock.calls[0]?.[1];
    expect(attempt.status).toBe("failed");
  });
});

describe("password reset pages", () => {
  function mockReactRouter(searchParams: Record<string, string> = {}) {
    vi.doMock("~/lib/auth-client", () => ({
      authClient: {
        requestPasswordReset: vi.fn(),
        resetPassword: vi.fn(),
      },
    }));
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Link: ({ children, to, ...props }: MockLinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useNavigate: vi.fn(() => vi.fn()),
        useSearchParams: vi.fn(() => [new URLSearchParams(searchParams)]),
      };
    });
  }

  it("renders the forgot-password request form", async () => {
    mockReactRouter();

    const { default: ForgotPasswordRoute } = await import("~/routes/auth.forgot-password");
    const markup = renderToStaticMarkup(createElement(ForgotPasswordRoute));

    expect(markup).toContain("Forgot your password?");
    expect(markup).toContain("Send reset link");
    expect(markup).toContain("/auth/login");
  });

  it("renders the new-password form when a token is present", async () => {
    mockReactRouter({ token: "valid-token" });

    const { default: ResetPasswordRoute } = await import("~/routes/auth.reset-password");
    const markup = renderToStaticMarkup(createElement(ResetPasswordRoute));

    expect(markup).toContain("Set a new password.");
    expect(markup).toContain("At least 8 characters");
  });

  it("explains expired links and offers a fresh request", async () => {
    mockReactRouter({ error: "INVALID_TOKEN" });

    const { default: ResetPasswordRoute } = await import("~/routes/auth.reset-password");
    const markup = renderToStaticMarkup(createElement(ResetPasswordRoute));

    expect(markup).toContain("valid anymore");
    expect(markup).toContain("/auth/forgot-password");
  });

  it("shows a forgot-password link on the login form", async () => {
    mockReactRouter();

    const { AuthForm } = await import("~/components/auth-form");
    const markup = renderToStaticMarkup(
      createElement(AuthForm, { mode: "login", redirectTo: "/app" }),
    );

    expect(markup).toContain("/auth/forgot-password");
    expect(markup).toContain("Forgot your password?");
  });
});

describe("account page", () => {
  function mockAccountPage() {
    vi.doMock("~/lib/auth-client", () => ({
      authClient: {
        changePassword: vi.fn(),
        changeEmail: vi.fn(),
        revokeOtherSessions: vi.fn(),
        deleteUser: vi.fn(),
      },
    }));
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
          React.createElement("form", props, children),
        useActionData: vi.fn().mockReturnValue(undefined),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
        useLoaderData: vi.fn().mockReturnValue({
          email: "owner@example.com",
          name: "Owner",
          currentSessionId: "session-1",
          plan: "agency",
          brandName: null,
          sessions: [
            { id: "session-1", createdAt: "2026-06-01T00:00:00.000Z", userAgent: "Safari" },
            { id: "session-2", createdAt: "2026-05-01T00:00:00.000Z", userAgent: "Chrome" },
          ],
        }),
      };
    });
  }

  it("renders password, email, sessions, and deletion sections", async () => {
    mockAccountPage();

    const { default: AccountRoute } = await import("~/routes/app.account");
    const markup = renderToStaticMarkup(createElement(AccountRoute));

    expect(markup).toContain("Change password");
    expect(markup).toContain("Change email");
    expect(markup).toContain("Active sessions");
    expect(markup).toContain("This device");
    expect(markup).toContain("Other device");
    expect(markup).toContain("Sign out other devices");
    expect(markup).toContain("Delete this account");
    expect(markup).toContain("support@0509.in");
    expect(markup).toContain("Report branding");
    expect(markup).toContain("save-report-branding");
  });

  it("sends account-action emails through the shared path without storing the secret URL", async () => {
    const emailSend = vi.fn().mockResolvedValue({ messageId: "msg_account_1" });
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
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

    const { sendAccountActionEmail } = await import("~/lib/delivery.server");
    const sent = await sendAccountActionEmail(
      { EMAIL: { send: emailSend }, EMAIL_FROM_EMAIL: "alerts@0509.in" } as never,
      {
        userId: "user-1",
        email: "owner@example.com",
        name: "Owner",
        kind: "delete_account",
        actionUrl: "https://0509.in/api/auth/delete-user/callback?token=secret-delete-token",
      },
    );

    expect(sent).toBe(true);
    const payload = emailSend.mock.calls[0]?.[0];
    expect(payload.subject).toContain("deletion");
    expect(payload.html).toContain("secret-delete-token");
    expect(payload.headers["List-Unsubscribe"]).toBeUndefined();

    const attempt = createDeliveryAttempt.mock.calls[0]?.[1];
    expect(attempt.templateName).toBe("account_delete_account");
    expect(JSON.stringify(attempt.payloadSnapshot)).not.toContain("secret-delete-token");
  });
});
