import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  BetterAuthUnknownUserError,
  betterAuthMagicLinkConfirmationUrl,
  buildBetterAuthMagicLinkEmail,
  enabledBetterAuthOAuthProviders,
  isBetterAuthConfigured,
  isBetterAuthOAuthProviderConfigured,
  isSameOriginAuthFormPost,
  readBetterAuthMagicLinkConfirmationContext,
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

function context(testEnv: AppEnv) {
  return {
    cloudflare: {
      country: null,
      ctx: {} as ExecutionContext,
      env: testEnv,
    },
  };
}

function setCookieValues(headers: Headers) {
  const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (values?.length) {
    return values;
  }
  const value = headers.get("Set-Cookie");
  return value ? [value] : [];
}

function cookieHeader(setCookies: string[], name: string) {
  const cookie = setCookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) {
    throw new Error(`Missing Set-Cookie for ${name}`);
  }
  return cookie.split(";")[0] ?? cookie;
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

  it("sends a non-redeeming app confirmation URL backed by Better Auth's generated token", async () => {
    let capturedMagicLinkOptions:
      | {
          sendMagicLink: (input: {
            email: string;
            metadata?: Record<string, unknown>;
            token: string;
            url: string;
          }) => Promise<void>;
        }
      | null = null;
    const signInMagicLink = vi.fn(async ({ body }) => {
      await capturedMagicLinkOptions?.sendMagicLink({
        email: body.email,
        metadata: body.metadata,
        token: "secret-token",
        url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp&newUserCallbackURL=https%3A%2F%2F0509.io%2Fapp%2Fonboard",
      });
      return { status: true };
    });
    vi.doMock("better-auth", () => ({
      betterAuth: vi.fn().mockReturnValue({
        api: { signInMagicLink },
        handler: vi.fn(),
      }),
    }));
    vi.doMock("better-auth/plugins", () => ({
      magicLink: vi.fn((options) => {
        capturedMagicLinkOptions = options;
        return { id: "magic-link" };
      }),
      passkey: vi.fn(() => ({ id: "passkey" })),
    }));

    const testEnv = env({ DB: dbWithUser("user-1") });
    const { sendBetterAuthMagicLink: sendMagicLink } = await import("~/lib/better-auth.server");
    const requestStateCookie = await sendMagicLink(
      testEnv,
      new Request("https://www.0509.io/auth/signup", {
        headers: { origin: "https://www.0509.io" },
      }),
      {
        email: "owner@example.com",
        mode: "signup",
        redirectTo: "/app/onboard",
      },
    );

    const send = testEnv.EMAIL!.send as ReturnType<typeof vi.fn>;
    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          callbackURL: "https://0509.io/app/onboard",
          email: "owner@example.com",
          metadata: { mode: "signup", requestState: expect.any(String) },
          newUserCallbackURL: "https://0509.io/app/onboard",
        }),
      }),
    );
    expect(requestStateCookie).toContain("f9_better_magic_state=");
    expect(requestStateCookie).toContain("Domain=0509.io");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining(
          'href="https://0509.io/auth/better/magic-link?token=secret-token',
        ),
        text: expect.stringContaining(
          "Activate account: https://0509.io/auth/better/magic-link?token=secret-token",
        ),
      }),
    );
    expect(send.mock.calls[0]?.[0]?.html).not.toContain("owner@example.com");
    expect(send.mock.calls[0]?.[0]?.html).not.toContain("/api/auth/magic-link/verify");
  });

  it("builds a token-bound confirmation URL that requires the same-browser state cookie", async () => {
    const confirmationUrl = await betterAuthMagicLinkConfirmationUrl(env(), {
      email: "owner@example.com",
      mode: "signup",
      requestState: "state-1",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp&newUserCallbackURL=https%3A%2F%2F0509.io%2Fapp%2Fonboard",
    });
    const parsed = new URL(confirmationUrl);

    expect(parsed.pathname).toBe("/auth/better/magic-link");
    expect(parsed.searchParams.get("token")).toBe("secret-token");
    expect(parsed.searchParams.get("callbackURL")).toBe("https://0509.io/app");
    expect(parsed.searchParams.get("newUserCallbackURL")).toBe("https://0509.io/app/onboard");
    expect(parsed.searchParams.get("state")).toBe("state-1");
    expect(parsed.searchParams.get("context")).toMatch(/^v1\./);
    expect(confirmationUrl).not.toContain("owner@example.com");
    expect(confirmationUrl).not.toContain("owner%40example.com");

    await expect(
      readBetterAuthMagicLinkConfirmationContext(
        env(),
        new Request(confirmationUrl, {
          headers: { cookie: "f9_better_magic_state=state-1" },
        }),
      ),
    ).resolves.toMatchObject({
      browserBound: true,
      email: "owner@example.com",
      mode: "signup",
    });
    await expect(
      readBetterAuthMagicLinkConfirmationContext(env(), new Request(confirmationUrl)),
    ).resolves.toBeNull();

    const tamperedTokenUrl = new URL(confirmationUrl);
    tamperedTokenUrl.searchParams.set("token", "different-token");
    await expect(
      readBetterAuthMagicLinkConfirmationContext(
        env(),
        new Request(tamperedTokenUrl, {
          headers: { cookie: "f9_better_magic_state=state-1" },
        }),
      ),
    ).resolves.toBeNull();
  });

  it("stages the token in an HttpOnly ticket before rendering a clean confirmation page", async () => {
    const verifyBetterAuthMagicLink = vi.fn();
    vi.doMock("~/lib/better-auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/better-auth.server")>(
        "~/lib/better-auth.server",
      );
      return {
        ...actual,
        verifyBetterAuthMagicLink,
      };
    });

    const { loader } = await import("~/routes/auth.better.magic-link");
    const tokenUrl = await betterAuthMagicLinkConfirmationUrl(env(), {
      email: "owner@example.com",
      mode: "login",
      requestState: "state-1",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const redirectResponse = (await Promise.resolve(
      loader({
        context: context(env()),
        params: {},
        pattern: "/auth/better/magic-link",
        request: new Request(tokenUrl, {
          headers: { cookie: "f9_better_magic_state=state-1" },
        }),
        url: tokenUrl,
      } as never),
    ).catch((error) => error)) as Response;

    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers.get("Location")).toBe("/auth/better/magic-link?mode=login");
    const setCookies = setCookieValues(redirectResponse.headers);
    const combinedSetCookie = setCookies.join("\n");
    expect(combinedSetCookie).toContain("f9_better_magic=");
    expect(combinedSetCookie).toContain("HttpOnly");
    expect(combinedSetCookie).toContain("Max-Age=900");
    expect(combinedSetCookie).not.toContain("secret-token");

    const ticketCookie = cookieHeader(setCookies, "f9_better_magic");
    const response = await loader({
      context: context(env()),
      params: {},
      pattern: "/auth/better/magic-link",
      request: new Request("https://0509.io/auth/better/magic-link?mode=login", {
        headers: { cookie: ticketCookie },
      }),
      url: "https://0509.io/auth/better/magic-link?mode=login",
    } as never);

    await expect(response.json()).resolves.toEqual({
      email: "owner@example.com",
      mode: "login",
    });
    expect(verifyBetterAuthMagicLink).not.toHaveBeenCalled();
  });

  it("rejects copied magic links that do not have the browser-bound request cookie", async () => {
    const verifyBetterAuthMagicLink = vi.fn();
    vi.doMock("~/lib/better-auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/better-auth.server")>(
        "~/lib/better-auth.server",
      );
      return {
        ...actual,
        verifyBetterAuthMagicLink,
      };
    });

    const { action, loader } = await import("~/routes/auth.better.magic-link");
    const tokenUrl = await betterAuthMagicLinkConfirmationUrl(env(), {
      email: "owner@example.com",
      mode: "login",
      requestState: "state-1",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const redirectResponse = (await Promise.resolve(
      loader({
        context: context(env()),
        params: {},
        pattern: "/auth/better/magic-link",
        request: new Request(tokenUrl),
        url: tokenUrl,
      } as never),
    ).catch((error) => error)) as Response;
    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers.get("Location")).toBe("/auth/login?error=callback_failed");

    await expect(
      action({
        context: context(env()),
        params: {},
        pattern: "/auth/better/magic-link",
        request: new Request("https://0509.io/auth/better/magic-link?mode=login", {
          body: new URLSearchParams(),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://0509.io",
          },
          method: "POST",
        }),
        url: "https://0509.io/auth/better/magic-link?mode=login",
      } as never),
    ).rejects.toMatchObject({ status: 302 });
    expect(verifyBetterAuthMagicLink).not.toHaveBeenCalled();
  });

  it("redeems through Better Auth only after a same-origin clean confirmation post", async () => {
    const betterAuthResponse = new Response(null, { status: 204 });
    Object.defineProperty(betterAuthResponse.headers, "getSetCookie", {
      value: () => [
        "better-auth.session_token=session-1; HttpOnly; Secure",
        "better-auth.session_data=session-data; HttpOnly; Secure",
      ],
    });
    const verifyBetterAuthMagicLink = vi.fn().mockResolvedValue(betterAuthResponse);
    vi.doMock("~/lib/better-auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/better-auth.server")>(
        "~/lib/better-auth.server",
      );
      return {
        ...actual,
        verifyBetterAuthMagicLink,
      };
    });

    const { action, loader } = await import("~/routes/auth.better.magic-link");
    const tokenUrl = await betterAuthMagicLinkConfirmationUrl(env(), {
      email: "owner@example.com",
      mode: "signup",
      requestState: "state-1",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp&newUserCallbackURL=https%3A%2F%2F0509.io%2Fapp%2Fonboard",
    });
    const redirectResponse = (await Promise.resolve(
      loader({
        context: context(env()),
        params: {},
        pattern: "/auth/better/magic-link",
        request: new Request(tokenUrl, {
          headers: { cookie: "f9_better_magic_state=state-1" },
        }),
        url: tokenUrl,
      } as never),
    ).catch((error) => error)) as Response;
    const ticketCookie = cookieHeader(setCookieValues(redirectResponse.headers), "f9_better_magic");

    const response = await action({
      context: context(env()),
      params: {},
      pattern: "/auth/better/magic-link",
      request: new Request("https://0509.io/auth/better/magic-link?mode=signup", {
        body: new URLSearchParams(),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: ticketCookie,
          origin: "https://0509.io",
        },
        method: "POST",
      }),
      url: "https://0509.io/auth/better/magic-link?mode=signup",
    } as never);

    const setCookies = setCookieValues(response.headers);
    const combinedSetCookie = setCookies.join("\n");
    expect(response.status).toBe(204);
    expect(verifyBetterAuthMagicLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Request),
      {
        callbackURL: "https://0509.io/app",
        email: "owner@example.com",
        expiresAt: expect.any(Number),
        mode: "signup",
        browserBound: true,
        newUserCallbackURL: "https://0509.io/app/onboard",
        token: "secret-token",
      },
    );
    expect(combinedSetCookie).toContain("better-auth.session_token=session-1");
    expect(combinedSetCookie).toContain("better-auth.session_data=session-data");
    expect(combinedSetCookie).toContain("f9_better_magic=;");
    expect(combinedSetCookie).toContain("f9_better_magic_state=;");
  });

  it("renders branded auth email without exposing the raw link in the HTML body text", () => {
    const email = buildBetterAuthMagicLinkEmail({
      mode: "signup",
      url: "https://0509.io/auth/better/magic-link?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp&context=context-1",
    });

    expect(email.subject).toBe("Activate your 0509 workspace");
    expect(email.html).toContain("0509 Account Activation");
    expect(email.html).toContain(">Activate account</a>");
    expect(email.html).not.toContain(">https://0509.io/auth/better/magic-link");
    expect(email.text).toContain("Activate account: https://0509.io/auth/better/magic-link");
  });
});

describe("Better Auth auth page errors", () => {
  it("shows retry messages for Better Auth magic-link callback error codes", async () => {
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
      error: "That sign-in link could not be verified. Request a fresh link and try again.",
    });

    await expect(
      signupLoader({
        context: context(env()),
        params: {},
        pattern: "/auth/signup",
        request: new Request("https://0509.io/auth/signup?error=INVALID_TOKEN"),
        url: "https://0509.io/auth/signup?error=INVALID_TOKEN",
      } as never),
    ).resolves.toMatchObject({
      error: "That setup link could not be verified. Request a fresh link and try again.",
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

  it("keeps native Better Auth magic-link and token endpoints private", async () => {
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
    expect(setCookie).toContain("Domain=0509.io");
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
