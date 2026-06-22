import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  BetterAuthMagicLinkCallbackError,
  BetterAuthUnknownUserError,
  betterAuthMagicLinkConfirmationCookie,
  buildBetterAuthMagicLinkChallengeEmail,
  buildBetterAuthMagicLinkEmail,
  enabledBetterAuthOAuthProviders,
  isBetterAuthConfigured,
  isBetterAuthOAuthProviderConfigured,
  isSameOriginAuthFormPost,
  readBetterAuthMagicLinkConfirmation,
  sendBetterAuthMagicLink,
} from "~/lib/better-auth.server";
import type { AppEnv } from "~/lib/env.server";

const db = {} as D1Database;

function env(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    APP_ORIGIN: "https://0509.io",
    AUTH_PROVIDER: "better-auth",
    BETTER_AUTH_SECRET: "secret-test",
    BETTER_AUTH_URL: "https://0509.io",
    DB: db,
    EMAIL: { send: vi.fn().mockResolvedValue({ messageId: "msg-1" }) },
    EMAIL_FROM_EMAIL: "alerts@0509.io",
    ...overrides,
  };
}

function dbWithUser(userId: string | null) {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(userId ? { id: userId } : null),
      }),
    }),
  } as unknown as D1Database;
}

function dbWithMagicLinkEmail(email: string | null) {
  const challengeRows = new Map<string, string>();
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn().mockImplementation(async () => {
          const identifier = String(args[0] ?? "");
          if (identifier.startsWith("0509:magic-link-challenge:")) {
            const value = challengeRows.get(identifier);
            return value ? { value } : null;
          }
          return email
            ? {
                value: JSON.stringify({ email }),
              }
            : null;
        }),
        run: vi.fn().mockImplementation(async () => {
          if (sql.startsWith("INSERT INTO verification")) {
            challengeRows.set(String(args[1] ?? ""), String(args[2] ?? ""));
          }
          if (sql.startsWith("DELETE FROM verification")) {
            challengeRows.delete(String(args[0] ?? ""));
          }
          return { success: true };
        }),
      })),
    })),
  } as unknown as D1Database;
}

function context(testEnv: AppEnv) {
  return {
    cloudflare: {
      country: null,
      ctx: {} as ExecutionContext,
      env: testEnv,
    },
  };
}

beforeEach(() => {
  vi.doUnmock("react-router");
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/better-auth.server");
  vi.doUnmock("~/lib/workspace.server");
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Better Auth configuration", () => {
  it("requires the Better Auth provider, secret, and D1 binding", () => {
    expect(isBetterAuthConfigured(env())).toBe(true);
    expect(isBetterAuthConfigured(env({ AUTH_PROVIDER: "legacy" }))).toBe(false);
    expect(isBetterAuthConfigured(env({ BETTER_AUTH_SECRET: "" }))).toBe(false);
    expect(isBetterAuthConfigured(env({ DB: undefined }))).toBe(false);
  });

  it("enables OAuth providers only when credentials and branded verification exist", () => {
    expect(enabledBetterAuthOAuthProviders(env())).toEqual([]);

    const credentialsOnlyEnv = env({
      BETTER_AUTH_GOOGLE_CLIENT_ID: "google-client",
      BETTER_AUTH_GOOGLE_CLIENT_SECRET: "google-secret",
    });
    expect(enabledBetterAuthOAuthProviders(credentialsOnlyEnv)).toEqual([]);
    expect(isBetterAuthOAuthProviderConfigured(credentialsOnlyEnv, "google")).toBe(false);

    const googleEnv = env({
      BETTER_AUTH_GOOGLE_CLIENT_ID: "google-client",
      BETTER_AUTH_GOOGLE_CLIENT_SECRET: "google-secret",
      BETTER_AUTH_OAUTH_BRANDED_PROVIDERS: "google",
    });
    expect(enabledBetterAuthOAuthProviders(googleEnv)).toEqual(["google"]);
    expect(isBetterAuthOAuthProviderConfigured(googleEnv, "google")).toBe(true);
    expect(isBetterAuthOAuthProviderConfigured(googleEnv, "microsoft")).toBe(false);

    expect(
      enabledBetterAuthOAuthProviders(
        env({
          BETTER_AUTH_MICROSOFT_CLIENT_ID: "microsoft-client",
          BETTER_AUTH_MICROSOFT_CLIENT_SECRET: "microsoft-secret",
          BETTER_AUTH_OAUTH_BRANDED_PROVIDERS: "microsoft",
        }),
      ),
    ).toEqual([]);

    expect(
      enabledBetterAuthOAuthProviders(
        env({
          BETTER_AUTH_MICROSOFT_ACCOUNT_LINKING_TRUSTED: "true",
          BETTER_AUTH_MICROSOFT_CLIENT_ID: "microsoft-client",
          BETTER_AUTH_MICROSOFT_CLIENT_SECRET: "microsoft-secret",
          BETTER_AUTH_OAUTH_BRANDED_PROVIDERS: "microsoft",
        }),
      ),
    ).toEqual(["microsoft"]);
  });

  it("accepts only same-origin auth form posts", () => {
    expect(
      isSameOriginAuthFormPost(
        env(),
        new Request("https://0509.io/auth/login", {
          headers: { origin: "https://0509.io" },
          method: "POST",
        }),
      ),
    ).toBe(true);

    expect(
      isSameOriginAuthFormPost(
        env({ BETTER_AUTH_TRUSTED_ORIGINS: "https://preview.0509.dev" }),
        new Request("https://preview.0509.dev/auth/login", {
          headers: { origin: "https://preview.0509.dev" },
          method: "POST",
        }),
      ),
    ).toBe(true);

    expect(
      isSameOriginAuthFormPost(
        env(),
        new Request("https://0509.io/auth/login", {
          headers: { origin: "https://evil.example" },
          method: "POST",
        }),
      ),
    ).toBe(false);
    expect(isSameOriginAuthFormPost(env(), new Request("https://0509.io/auth/login"))).toBe(false);
  });
});

describe("auth session boundary", () => {
  it("returns null when no database binding is present", async () => {
    const { getOptionalSession } = await import("~/lib/auth.server");
    await expect(getOptionalSession(env({ DB: undefined }), new Request("https://0509.io/app"))).resolves.toBeNull();
  });

  it("maps Better Auth sessions into the app session shape", async () => {
    vi.doMock("~/lib/better-auth.server", () => ({
      getBetterAuthSession: vi.fn().mockResolvedValue({
        session: {
          expiresAt: "2026-06-30T00:00:00.000Z",
          id: "session-1",
          userId: "user-1",
        },
        user: {
          email: "owner@example.com",
          id: "user-1",
          image: null,
          name: "Owner",
          onboardedAt: null,
        },
      }),
    }));

    const { getOptionalSession } = await import("~/lib/auth.server");
    const session = await getOptionalSession(env(), new Request("https://0509.io/app"));
    expect(session?.session.id).toBe("session-1");
    expect(session?.user.email).toBe("owner@example.com");
  });

  it("redirects protected routes without a Better Auth session", async () => {
    vi.doMock("~/lib/better-auth.server", () => ({
      getBetterAuthSession: vi.fn().mockResolvedValue(null),
    }));

    const { requireSession } = await import("~/lib/auth.server");
    await expect(requireSession(env(), new Request("https://0509.io/app/billing"))).rejects.toMatchObject({
      status: 302,
    });
  });
});

describe("Better Auth magic links", () => {
  it("does not send login links for unknown users", async () => {
    await expect(
      sendBetterAuthMagicLink(
        env({ DB: dbWithUser(null) }),
        new Request("https://0509.io/auth/login"),
        {
          email: "unknown@example.com",
          mode: "login",
          redirectTo: "/app",
        },
      ),
    ).rejects.toBeInstanceOf(BetterAuthUnknownUserError);
  });

  it("stores Better Auth magic-link tokens in a short-lived HTTP-only confirmation cookie", async () => {
    const request = new Request("https://0509.io/auth/better/magic-link", {
      headers: {
        cookie: "f9_better_magic_state=request-state",
      },
    });
    const cookie = await betterAuthMagicLinkConfirmationCookie(
      env({ DB: dbWithMagicLinkEmail("owner@example.com") }),
      request,
      "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp&newUserCallbackURL=https%3A%2F%2F0509.io%2Fapp%2Fonboard&email=tampered%40example.com&state=request-state",
    );

    expect(cookie).toContain("f9_better_magic=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).not.toContain("secret-token");

    const payload = await readBetterAuthMagicLinkConfirmation(
      env(),
      new Request("https://0509.io/auth/better/magic-link", {
        headers: { cookie },
      }),
    );
    expect(payload).toMatchObject({
      browserBound: true,
      callbackURL: "https://0509.io/app",
      email: "owner@example.com",
      newUserCallbackURL: "https://0509.io/app/onboard",
      token: "secret-token",
    });
  });

  it("rejects forged magic-link confirmation cookies", async () => {
    const forged = btoa(
      JSON.stringify({
        browserBound: true,
        callbackURL: "https://0509.io/app",
        email: "owner@example.com",
        token: "secret-token",
      }),
    );

    await expect(
      readBetterAuthMagicLinkConfirmation(
        env(),
        new Request("https://0509.io/auth/better/magic-link", {
          headers: { cookie: `f9_better_magic=${forged}` },
        }),
      ),
    ).resolves.toBeNull();
  });

  it("rejects magic-link callbacks that point outside the app origin", async () => {
    const request = new Request("https://0509.io/auth/better/magic-link");

    await expect(
      betterAuthMagicLinkConfirmationCookie(
        env({ DB: dbWithMagicLinkEmail("owner@example.com") }),
        request,
        "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2Fevil.example%2Fapp&email=owner%40example.com",
      ),
    ).rejects.toThrow(BetterAuthMagicLinkCallbackError);
  });

  it("moves magic-link tokens into a cookie before rendering the confirmation page without request-state cookies", async () => {
    const { loader } = await import("~/routes/auth.better.magic-link");
    const testEnv = env({ DB: dbWithMagicLinkEmail("owner@example.com") });
    const tokenUrl =
      "https://0509.io/auth/better/magic-link?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp";
    const redirectResponse = (await Promise.resolve(
      loader({
        context: context(testEnv),
        params: {},
        pattern: "/auth/better/magic-link",
        request: new Request(tokenUrl),
        url: tokenUrl,
      } as never),
    ).catch((error) => error)) as Response;

    if (!(redirectResponse instanceof Response)) {
      throw redirectResponse;
    }

    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers.get("Location")).toBe("/auth/better/magic-link?mode=login");
    const cookie = redirectResponse.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("f9_better_magic=");
    expect(cookie).not.toContain("secret-token");

    const cleanResponse = await loader({
      context: context(testEnv),
      params: {},
      pattern: "/auth/better/magic-link",
      request: new Request("https://0509.io/auth/better/magic-link?mode=login", {
        headers: { cookie },
      }),
      url: "https://0509.io/auth/better/magic-link?mode=login",
    } as never);
    await expect(cleanResponse.json()).resolves.toEqual({
      email: "",
      fallbackStep: "email",
      mode: "login",
      requiresEmailConfirmation: true,
    });
  });

  it("verifies a browser-bound confirmation cookie from a same-origin post", async () => {
    const verifyBetterAuthMagicLink = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: new Headers({ "Set-Cookie": "better-auth.session_token=session-1; HttpOnly; Secure" }),
        status: 204,
      }),
    );
    vi.doMock("~/lib/better-auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/better-auth.server")>(
        "~/lib/better-auth.server",
      );
      return {
        ...actual,
        verifyBetterAuthMagicLink,
      };
    });

    const testEnv = env({ DB: dbWithMagicLinkEmail("owner@example.com") });
    const cookie = await betterAuthMagicLinkConfirmationCookie(
      testEnv,
      new Request("https://0509.io/auth/better/magic-link", {
        headers: { cookie: "f9_better_magic_state=request-state" },
      }),
      "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp&email=owner%40example.com&state=request-state",
    );
    const { action } = await import("~/routes/auth.better.magic-link");
    const response = await action({
      context: context(testEnv),
      params: {},
      pattern: "/auth/better/magic-link",
      request: new Request("https://0509.io/auth/better/magic-link?mode=login", {
        headers: {
          cookie,
          origin: "https://0509.io",
        },
        method: "POST",
      }),
      url: "https://0509.io/auth/better/magic-link?mode=login",
    } as never);

    const setCookies =
      (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [
        response.headers.get("Set-Cookie") ?? "",
      ];
    const combinedSetCookie = setCookies.join("\n");
    expect(response.status).toBe(204);
    expect(verifyBetterAuthMagicLink).toHaveBeenCalledWith(
      testEnv,
      expect.any(Request),
      expect.objectContaining({
        callbackURL: "https://0509.io/app",
        email: "owner@example.com",
        token: "secret-token",
      }),
    );
    expect(combinedSetCookie).toContain("better-auth.session_token=session-1");
    expect(combinedSetCookie).toContain("f9_better_magic=;");
  });

  it("requires an inbox code before redeeming a nonce-less magic link", async () => {
    const verifyBetterAuthMagicLink = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.doMock("~/lib/better-auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/better-auth.server")>(
        "~/lib/better-auth.server",
      );
      return {
        ...actual,
        verifyBetterAuthMagicLink,
      };
    });

    const emailSend = vi.fn().mockResolvedValue({ messageId: "msg-1" });
    const testEnv = env({
      DB: dbWithMagicLinkEmail("owner@example.com"),
      EMAIL: { send: emailSend },
    });
    const cookie = await betterAuthMagicLinkConfirmationCookie(
      testEnv,
      new Request("https://0509.io/auth/better/magic-link"),
      "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    );
    const { action } = await import("~/routes/auth.better.magic-link");

    await expect(
      action({
        context: context(testEnv),
        params: {},
        pattern: "/auth/better/magic-link",
        request: new Request("https://0509.io/auth/better/magic-link?mode=login", {
          body: new URLSearchParams({ email: "attacker@example.com" }),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie,
            origin: "https://0509.io",
          },
          method: "POST",
        }),
        url: "https://0509.io/auth/better/magic-link?mode=login",
      } as never),
    ).rejects.toMatchObject({ status: 302 });
    expect(verifyBetterAuthMagicLink).not.toHaveBeenCalled();

    const challengeResponse = await action({
      context: context(testEnv),
      params: {},
      pattern: "/auth/better/magic-link",
      request: new Request("https://0509.io/auth/better/magic-link?mode=login", {
        body: new URLSearchParams({ email: "owner@example.com" }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie,
          origin: "https://0509.io",
        },
        method: "POST",
      }),
      url: "https://0509.io/auth/better/magic-link?mode=login",
    } as never);

    expect(challengeResponse.status).toBe(302);
    expect(challengeResponse.headers.get("Location")).toBe(
      "/auth/better/magic-link?mode=login&challenge=sent",
    );
    expect(emailSend).toHaveBeenCalledOnce();
    const challengeEmail = emailSend.mock.calls[0]?.[0] as { text?: string };
    const code = challengeEmail.text?.match(/\b[A-Z2-9]{8}\b/)?.[0];
    expect(code).toBeTruthy();
    expect(challengeEmail.text).not.toContain("secret-token");
    const challengeCookie = challengeResponse.headers.get("Set-Cookie") ?? "";
    expect(challengeCookie).toContain("f9_better_magic=");

    await expect(
      action({
        context: context(testEnv),
        params: {},
        pattern: "/auth/better/magic-link",
        request: new Request("https://0509.io/auth/better/magic-link?mode=login", {
          body: new URLSearchParams({ code: "WRONG123" }),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie: challengeCookie,
            origin: "https://0509.io",
          },
          method: "POST",
        }),
        url: "https://0509.io/auth/better/magic-link?mode=login",
      } as never),
    ).rejects.toMatchObject({ status: 302 });
    expect(verifyBetterAuthMagicLink).not.toHaveBeenCalled();

    const response = await action({
      context: context(testEnv),
      params: {},
      pattern: "/auth/better/magic-link",
      request: new Request("https://0509.io/auth/better/magic-link?mode=login", {
        body: new URLSearchParams({ code: code ?? "" }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: challengeCookie,
          origin: "https://0509.io",
        },
        method: "POST",
      }),
      url: "https://0509.io/auth/better/magic-link?mode=login",
    } as never);

    expect(response.status).toBe(204);
    expect(verifyBetterAuthMagicLink).toHaveBeenCalledOnce();
  });

  it("renders branded auth email without exposing the raw link in the HTML body text", () => {
    const email = buildBetterAuthMagicLinkEmail({
      mode: "signup",
      url: "https://0509.io/auth/better/magic-link?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });

    expect(email.subject).toBe("Activate your 0509 workspace");
    expect(email.html).toContain("0509 Account Activation");
    expect(email.html).toContain(">Activate account</a>");
    expect(email.html).not.toContain(">https://0509.io/auth/better/magic-link");
    expect(email.text).toContain("Activate account: https://0509.io/auth/better/magic-link");
  });

  it("renders one-time fallback codes without including the magic-link token", () => {
    const email = buildBetterAuthMagicLinkChallengeEmail({
      code: "ABCD2345",
      mode: "login",
    });

    expect(email.subject).toBe("Your 0509 sign-in code");
    expect(email.html).toContain("ABCD2345");
    expect(email.text).toContain("ABCD2345");
    expect(email.html).not.toContain("secret-token");
    expect(email.text).not.toContain("secret-token");
  });
});

describe("Better Auth auth page errors", () => {
  it("shows generic retry messages for unrecognized Better Auth callback error codes", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));

    const { loader: loginLoader } = await import("~/routes/auth.login");
    const { loader: signupLoader } = await import("~/routes/auth.signup");

    await expect(
      loginLoader({
        context: context(env()),
        params: {},
        pattern: "/auth/login",
        request: new Request("https://0509.io/auth/login?error=INVALID_TOKEN"),
        url: "https://0509.io/auth/login?error=INVALID_TOKEN",
      } as never),
    ).resolves.toMatchObject({
      error: "That sign-in request could not be completed. Request a fresh link and try again.",
    });

    await expect(
      signupLoader({
        context: context(env()),
        params: {},
        pattern: "/auth/signup",
        request: new Request("https://0509.io/auth/signup?error=TOKEN_EXPIRED"),
        url: "https://0509.io/auth/signup?error=TOKEN_EXPIRED",
      } as never),
    ).resolves.toMatchObject({
      error: "That setup request could not be completed. Request a fresh link and try again.",
    });
  });
});

describe("Better Auth routes", () => {
  it("delegates /api/auth/* requests to the Better Auth handler", async () => {
    const handler = vi.fn().mockResolvedValue(new Response("handled"));
    vi.doMock("~/lib/better-auth.server", () => ({
      getBetterAuth: vi.fn().mockReturnValue({ handler }),
    }));

    const { loader } = await import("~/routes/api.auth.$");
    const response = await loader({
      context: context(env()),
      params: {},
      pattern: "/api/auth/*",
      request: new Request("https://0509.io/api/auth/get-session"),
      url: "https://0509.io/api/auth/get-session",
    } as never);

    expect(await response.text()).toBe("handled");
    expect(handler).toHaveBeenCalledWith(expect.any(Request));
  });

  it("does not expose native Better Auth magic-link or OAuth token endpoints publicly", async () => {
    const handler = vi.fn().mockResolvedValue(new Response("handled"));
    vi.doMock("~/lib/better-auth.server", () => ({
      getBetterAuth: vi.fn().mockReturnValue({ handler }),
    }));

    const { action, loader } = await import("~/routes/api.auth.$");
    const verifyResponse = await loader({
      context: context(env()),
      params: {},
      pattern: "/api/auth/*",
      request: new Request("https://0509.io/api/auth/magic-link/verify?token=secret-token"),
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token",
    } as never);
    const signInResponse = await action({
      context: context(env()),
      params: {},
      pattern: "/api/auth/*",
      request: new Request("https://0509.io/api/auth/sign-in/magic-link", { method: "POST" }),
      url: "https://0509.io/api/auth/sign-in/magic-link",
    } as never);
    const socialSignInResponse = await action({
      context: context(env()),
      params: {},
      pattern: "/api/auth/*",
      request: new Request("https://0509.io/api/auth/sign-in/social", { method: "POST" }),
      url: "https://0509.io/api/auth/sign-in/social",
    } as never);
    const accessTokenResponse = await action({
      context: context(env()),
      params: {},
      pattern: "/api/auth/*",
      request: new Request("https://0509.io/api/auth/get-access-token", { method: "POST" }),
      url: "https://0509.io/api/auth/get-access-token",
    } as never);
    const refreshTokenResponse = await action({
      context: context(env()),
      params: {},
      pattern: "/api/auth/*",
      request: new Request("https://0509.io/api/auth/refresh-token", { method: "POST" }),
      url: "https://0509.io/api/auth/refresh-token",
    } as never);

    expect(verifyResponse.status).toBe(404);
    expect(signInResponse.status).toBe(404);
    expect(socialSignInResponse.status).toBe(404);
    expect(accessTokenResponse.status).toBe(404);
    expect(refreshTokenResponse.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("starts only configured Better Auth OAuth providers from same-origin posts", async () => {
    const startBetterAuthSocialSignIn = vi.fn().mockResolvedValue({
      headers: new Headers({ "Set-Cookie": "better-auth.state=state-1; HttpOnly; Secure" }),
      url: "https://accounts.google.com/o/oauth2/v2/auth",
    });
    vi.doMock("~/lib/better-auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/better-auth.server")>(
        "~/lib/better-auth.server",
      );
      return {
        ...actual,
        startBetterAuthSocialSignIn,
      };
    });

    const { action } = await import("~/routes/auth.better.oauth");
    const request = new Request("https://0509.io/auth/better/oauth", {
      body: new URLSearchParams({
        mode: "login",
        provider: "google",
        redirectTo: "/app",
      }),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://0509.io",
      },
      method: "POST",
    });

    const configuredEnv = env({
      BETTER_AUTH_GOOGLE_CLIENT_ID: "google-client",
      BETTER_AUTH_GOOGLE_CLIENT_SECRET: "google-secret",
      BETTER_AUTH_OAUTH_BRANDED_PROVIDERS: "google",
    });
    let redirectResponse: Response | null = null;
    try {
      await action({
        context: context(configuredEnv),
        params: {},
        pattern: "/auth/better/oauth",
        request,
        url: "https://0509.io/auth/better/oauth",
      } as never);
    } catch (error) {
      redirectResponse = error as Response;
    }

    expect(redirectResponse?.status).toBe(302);
    expect(redirectResponse?.headers.get("Location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(redirectResponse?.headers.get("Set-Cookie")).toContain("better-auth.state=state-1");
    expect(startBetterAuthSocialSignIn).toHaveBeenCalledWith(
      configuredEnv,
      expect.any(Request),
      expect.objectContaining({ provider: "google", redirectTo: "/app" }),
    );
  });

  it("rejects unconfigured Better Auth OAuth providers before starting OAuth", async () => {
    const { action } = await import("~/routes/auth.better.oauth");
    const request = new Request("https://0509.io/auth/better/oauth", {
      body: new URLSearchParams({
        mode: "login",
        provider: "microsoft",
        redirectTo: "/app",
      }),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://0509.io",
      },
      method: "POST",
    });

    await expect(
      action({
        context: context(env()),
        params: {},
        pattern: "/auth/better/oauth",
        request,
        url: "https://0509.io/auth/better/oauth",
      } as never),
    ).rejects.toMatchObject({
      status: 302,
    });
  });

  it("returns the normal sent redirect for unknown login emails", async () => {
    vi.doMock("~/lib/better-auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/better-auth.server")>(
        "~/lib/better-auth.server",
      );
      return {
        ...actual,
        sendBetterAuthMagicLink: vi
          .fn()
          .mockRejectedValue(new actual.BetterAuthUnknownUserError()),
      };
    });

    const { action } = await import("~/routes/auth.login");
    const request = new Request("https://0509.io/auth/login", {
      body: new URLSearchParams({
        email: "unknown@example.com",
        redirectTo: "/app",
      }),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://0509.io",
      },
      method: "POST",
    });

    let redirectResponse: Response | null = null;
    try {
      await action({
        context: context(env()),
        params: {},
        pattern: "/auth/login",
        request,
        url: "https://0509.io/auth/login",
      } as never);
    } catch (error) {
      redirectResponse = error as Response;
    }

    expect(redirectResponse?.status).toBe(302);
    expect(redirectResponse?.headers.get("Location")).toBe(
      "/auth/login?sent=1&email=unknown%40example.com&redirectTo=%2Fapp",
    );
    const setCookie = redirectResponse?.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("f9_better_magic_state=");
    expect(setCookie).not.toContain("f9_better_magic=");
    expect(setCookie).not.toContain("unknown@example.com");
  });

  it("clears Better Auth session cookies when provider sign-out fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.doMock("~/lib/better-auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/better-auth.server")>(
        "~/lib/better-auth.server",
      );
      return {
        ...actual,
        signOutBetterAuth: vi.fn().mockRejectedValue(new Error("d1 unavailable")),
      };
    });

    const { action } = await import("~/routes/auth.logout");
    const request = new Request("https://0509.io/auth/logout", {
      headers: {
        cookie: "better-auth.session_token=session-123; __Secure-better-auth.session_token=session-123",
        origin: "https://0509.io",
      },
      method: "POST",
    });

    let redirectResponse: Response | null = null;
    try {
      await action({
        context: context(env()),
        params: {},
        pattern: "/auth/logout",
        request,
        url: "https://0509.io/auth/logout",
      } as never);
    } catch (error) {
      redirectResponse = error as Response;
    }

    const setCookies =
      (redirectResponse?.headers as (Headers & { getSetCookie?: () => string[] }) | undefined)
        ?.getSetCookie?.() ?? [redirectResponse?.headers.get("Set-Cookie") ?? ""];
    const combinedSetCookie = setCookies.join("\n");
    expect(redirectResponse?.status).toBe(302);
    expect(redirectResponse?.headers.get("Location")).toBe("/");
    expect(combinedSetCookie).toContain("better-auth.session_token=;");
    expect(combinedSetCookie).toContain("__Secure-better-auth.session_token=;");
    expect(combinedSetCookie).toContain("Max-Age=0");
  });

  it("routes unauthenticated valid team invites through signup", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      peekWorkspaceInvite: vi.fn().mockResolvedValue({
        invitedEmail: "teammate@example.com",
        ownerName: "Owner",
      }),
    }));

    const { loader } = await import("~/routes/team.accept");
    let redirectResponse: Response | null = null;
    try {
      await loader({
        context: context(env()),
        params: {},
        pattern: "/team/accept",
        request: new Request("https://0509.io/team/accept?token=invite-token"),
        url: "https://0509.io/team/accept?token=invite-token",
      } as never);
    } catch (error) {
      redirectResponse = error as Response;
    }

    expect(redirectResponse?.status).toBe(302);
    expect(redirectResponse?.headers.get("Location")).toBe(
      "/auth/signup?email=teammate%40example.com&redirectTo=%2Fteam%2Faccept%3Ftoken%3Dinvite-token",
    );
  });
});
