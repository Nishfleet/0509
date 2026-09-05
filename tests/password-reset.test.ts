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
      EMAIL_FROM_EMAIL: "alerts@0509.io",
    };

    const { sendPasswordResetEmail } = await import("~/lib/delivery.server");
    await sendPasswordResetEmail(env as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
      resetUrl: "https://0509.io/api/auth/reset-password/secret-token?callbackURL=/auth/reset-password",
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
      EMAIL_FROM_EMAIL: "alerts@0509.io",
    };

    const { sendPasswordResetEmail } = await import("~/lib/delivery.server");

    await expect(
      sendPasswordResetEmail(env as never, {
        userId: "user-1",
        email: "owner@example.com",
        name: null,
        resetUrl: "https://0509.io/api/auth/reset-password/secret-token",
      }),
    ).rejects.toThrow();

    const attempt = createDeliveryAttempt.mock.calls[0]?.[1];
    expect(attempt.status).toBe("failed");
  });
});

describe("password reset pages", () => {
  function mockReactRouter() {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Link: ({ children, to, ...props }: MockLinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
          React.createElement("form", props, children),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      };
    });
  }

  it("uses a passwordless login form", async () => {
    mockReactRouter();

    const { AuthForm } = await import("~/components/auth-form");
    const markup = renderToStaticMarkup(
      createElement(AuthForm, { mode: "login", redirectTo: "/app" }),
    );

    expect(markup).toContain("Send sign-in link");
    expect(markup).not.toContain("Forgot your password?");
    expect(markup).not.toContain("type=\"password\"");
  });
});

describe("account page", () => {
  function mockAccountPage() {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        Link: ({ children, to, ...props }: MockLinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
          React.createElement("form", props, children),
        useActionData: vi.fn().mockReturnValue(undefined),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
        useRevalidator: vi.fn().mockReturnValue({ revalidate: vi.fn(), state: "idle" }),
        useLoaderData: vi.fn().mockReturnValue({
          email: "owner@example.com",
          name: "Owner",
          sessionExpiresAt: "2026-06-30T00:00:00.000Z",
          plan: "agency",
          brandName: null,
          brandWebsite: null,
          passkeys: [],
          passkeysEnabled: true,
          activeSessions: [],
          sessionControlsMessage: null,
        }),
      };
    });
  }

  it("renders account security controls and deletion support", async () => {
    mockAccountPage();

    const { default: AccountRoute } = await import("~/routes/app.account");
    const markup = renderToStaticMarkup(createElement(AccountRoute));

    expect(markup).toContain("Sign-in security");
    expect(markup).toContain("Session and account controls");
    expect(markup).toContain("This device is signed in until");
    expect(markup).toContain("sensitive requests live here");
    expect(markup).not.toContain("session-1");
    expect(markup).toContain("Request account deletion support");
    expect(markup).toContain("This sends a support deletion request");
    expect(markup).toContain("Send support deletion request");
    expect(markup).toContain("Nothing is deleted automatically or in-app");
    expect(markup).not.toContain("Delete this account");
    expect(markup).toContain("support@0509.io");
    expect(markup).toContain("My brand");
    expect(markup).toContain("save-brand-profile");
    expect(markup).toContain("Agency reports");
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
      { EMAIL: { send: emailSend }, EMAIL_FROM_EMAIL: "alerts@0509.io" } as never,
      {
        userId: "user-1",
        email: "owner@example.com",
        name: "Owner",
        kind: "delete_account",
        actionUrl: "https://0509.io/api/auth/delete-user/callback?token=secret-delete-token",
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
