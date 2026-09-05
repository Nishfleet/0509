import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  BETTER_AUTH_EMAIL_SEND_TIMEOUT_MS,
  BetterAuthUnknownUserError,
  appendBetterAuthSetCookieHeaders,
  betterAuthMagicLinkConfirmationUrl,
  buildBetterAuthMagicLinkEmail,
  enabledBetterAuthOAuthProviders,
  hasBetterAuthPasskeysForEmail,
  isBetterAuthConfigured,
  isBetterAuthOAuthProviderConfigured,
  isSameOriginAuthFormPost,
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

function dbWithE2ETestMode(enabled: boolean) {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(enabled ? { enabled: 1 } : null),
      }),
    }),
  } as unknown as D1Database;
}

interface TestMagicLinkTicketRow {
  consumed_at: string | null;
  created_at: string;
  expires_at: string;
  id: string;
  mode: "login" | "signup";
  payload: string;
}

function dbWithMagicLinkTickets(userId: string | null = "user-1") {
  const tickets = new Map<string, TestMagicLinkTicketRow>();
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...bindings: unknown[]) => ({
      first: vi.fn(async () => {
        if (sql.includes("FROM user")) {
          return userId ? { id: userId } : null;
        }
        if (sql.includes("FROM better_auth_magic_link_ticket")) {
          return tickets.get(String(bindings[0])) ?? null;
        }
        return null;
      }),
      run: vi.fn(async () => {
        if (sql.includes("INSERT INTO better_auth_magic_link_ticket")) {
          const [id, mode, payload, createdAt, expiresAt] = bindings;
          tickets.set(String(id), {
            consumed_at: null,
            created_at: String(createdAt),
            expires_at: String(expiresAt),
            id: String(id),
            mode: mode === "signup" ? "signup" : "login",
            payload: String(payload),
          });
          return { meta: { changes: 1 } };
        }
        if (sql.includes("UPDATE better_auth_magic_link_ticket")) {
          const [consumedAt, id, now] = bindings;
          const row = tickets.get(String(id));
          if (!row || row.consumed_at || row.expires_at <= String(now)) {
            return { meta: { changes: 0 } };
          }
          row.consumed_at = String(consumedAt);
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      }),
    })),
  }));

  return {
    db: { prepare } as unknown as D1Database,
    tickets,
  };
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
  const cookie = setCookies.find((value) => value.startsWith(`${name}=`) && !value.startsWith(`${name}=;`));
  if (!cookie) {
    throw new Error(`Missing Set-Cookie for ${name}`);
  }
  return cookie.split(";")[0] ?? cookie;
}

function ticketIdFromUrl(url: string) {
  return new URL(url, "https://0509.io").searchParams.get("ticket") ?? "";
}

function magicLinkConfirmUrl(mode: "login" | "signup", ticketId?: string | null) {
  const params = new URLSearchParams({ mode });
  if (ticketId) {
    params.set("ticket", ticketId);
  }
  return `https://0509.io/auth/better/magic-link?${params.toString()}`;
}

function magicLinkConfirmDataUrl(mode: "login" | "signup") {
  return `https://0509.io/auth/better/magic-link.data?${new URLSearchParams({ mode }).toString()}`;
}

function mockBetterAuthVerifyResponse(location = "https://0509.io/app") {
  const betterAuthResponse = new Response(null, {
    headers: { Location: location },
    status: 302,
  });
  Object.defineProperty(betterAuthResponse.headers, "getSetCookie", {
    value: () => [
      "__Secure-better-auth.session_token=session-token; HttpOnly; Secure; Path=/; SameSite=Lax",
      "__Secure-better-auth.session_data=session-data; HttpOnly; Secure; Path=/; SameSite=Lax",
    ],
  });
  return betterAuthResponse;
}

async function mockBetterAuthMagicLinkServer(
  overrides: {
    getBetterAuthSession?: (
      env: AppEnv,
      request: Request,
    ) => Promise<import("~/lib/types").AppSession | null>;
    verifyBetterAuthMagicLink?: (
      env: AppEnv,
      request: Request,
      input: import("~/lib/better-auth.server").BetterAuthMagicLinkConfirmation,
    ) => Promise<Response>;
  } = {},
) {
  const betterAuth = await import("~/lib/better-auth.server");
  const verifyBetterAuthMagicLink = overrides.verifyBetterAuthMagicLink
    ? vi.spyOn(betterAuth, "verifyBetterAuthMagicLink").mockImplementation(overrides.verifyBetterAuthMagicLink)
    : vi.spyOn(betterAuth, "verifyBetterAuthMagicLink").mockResolvedValue(mockBetterAuthVerifyResponse());
  const getBetterAuthSession = overrides.getBetterAuthSession
    ? vi.spyOn(betterAuth, "getBetterAuthSession").mockImplementation(overrides.getBetterAuthSession)
    : vi.spyOn(betterAuth, "getBetterAuthSession").mockResolvedValue(null);
  return { getBetterAuthSession, verifyBetterAuthMagicLink };
}

async function stageTicketFromEmailLink(
  loader: Awaited<typeof import("~/routes/auth.better.magic-link")>["loader"],
  testEnv: AppEnv,
  ticketUrl: string,
  mode: "login" | "signup" = "login",
) {
  const redirectResponse = (await Promise.resolve(
    loader({
      context: context(testEnv),
      params: {},
      pattern: "/auth/better/magic-link",
      request: new Request(ticketUrl),
      url: ticketUrl,
    } as never),
  ).catch((error) => error)) as Response;
  const ticketCookie = cookieHeader(setCookieValues(redirectResponse.headers), "f9_better_magic");
  return { redirectResponse, ticketCookie, confirmUrl: magicLinkConfirmUrl(mode) };
}

async function postMagicLinkConfirmation(
  action: Awaited<typeof import("~/routes/auth.better.magic-link")>["action"],
  testEnv: AppEnv,
  ticketCookie: string,
  mode: "login" | "signup" = "login",
  requestUrl = magicLinkConfirmUrl(mode),
) {
  return (await Promise.resolve(
    action({
      context: context(testEnv),
      params: {},
      pattern: "/auth/better/magic-link",
      request: new Request(requestUrl, {
        body: new URLSearchParams(),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: ticketCookie,
          origin: "https://0509.io",
        },
        method: "POST",
      }),
      url: requestUrl,
    } as never),
  ).catch((error) => error)) as Response;
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
  it("requires the Better Auth provider, origin, secret, and D1 binding", () => {
    expect(isBetterAuthConfigured(env())).toBe(true);
    expect(isBetterAuthConfigured(env({ AUTH_PROVIDER: "legacy" }))).toBe(false);
    expect(isBetterAuthConfigured(env({ APP_ORIGIN: undefined, BETTER_AUTH_URL: undefined }))).toBe(false);
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

  it("redirects an absent or invalid session instead of treating it as an outage", async () => {
    vi.doMock("~/lib/better-auth.server", () => ({
      getBetterAuthSession: vi.fn().mockResolvedValue(null),
    }));

    const { requireSession } = await import("~/lib/auth.server");
    await expect(
      requireSession(
        env(),
        new Request("https://0509.io/app/billing", {
          headers: { cookie: "better-auth.session_token=invalid" },
        }),
      ),
    ).rejects.toMatchObject({ status: 302 });
  });

  it("returns a customer-safe 503 when Better Auth is unavailable", async () => {
    const getBetterAuthSession = vi.fn().mockRejectedValue(new Error("D1 connection leaked"));
    vi.doMock("~/lib/better-auth.server", () => ({
      getBetterAuthSession,
    }));

    const { requireSession } = await import("~/lib/auth.server");
    let response: Response | null = null;
    try {
      await requireSession(
        env(),
        new Request("https://0509.io/app", {
          headers: { cookie: "__Secure-better-auth.session_token=invalid" },
        }),
      );
    } catch (error) {
      response = error as Response;
    }

    expect(getBetterAuthSession).toHaveBeenCalledTimes(1);
    expect(response?.status).toBe(503);
    expect(response?.statusText).toBe("Authentication temporarily unavailable");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("retry-after")).toBe("5");
    const body = await response?.text();
    expect(body).toContain("Authentication is temporarily unavailable");
    expect(body).not.toContain("D1 connection leaked");
  });

  it("caches an auth outage per Request without turning it into a redirect", async () => {
    const getBetterAuthSession = vi.fn().mockRejectedValue(new Error("backend down"));
    vi.doMock("~/lib/better-auth.server", () => ({
      getBetterAuthSession,
    }));

    const { getCachedOptionalSession, getOptionalSession, requireSession } = await import("~/lib/auth.server");
    const request = new Request("https://0509.io/app", {
      headers: { cookie: "__Secure-better-auth.session_token=invalid" },
    });

    await expect(getCachedOptionalSession(env(), request)).rejects.toThrow(
      "Authentication is temporarily unavailable",
    );
    await expect(getOptionalSession(env(), request)).resolves.toBeNull();
    let response: Response | null = null;
    try {
      await requireSession(env(), request);
    } catch (error) {
      response = error as Response;
    }

    expect(getBetterAuthSession).toHaveBeenCalledTimes(1);
    expect(response?.status).toBe(503);
  });

  it("runs the session lookup once per Request across parallel loaders", async () => {
    const getBetterAuthSession = vi.fn().mockResolvedValue({
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
    });
    vi.doMock("~/lib/better-auth.server", () => ({
      getBetterAuthSession,
    }));

    const { getCachedOptionalSession } = await import("~/lib/auth.server");
    const request = new Request("https://0509.io/app");
    const [first, second] = await Promise.all([
      getCachedOptionalSession(env(), request),
      getCachedOptionalSession(env(), request),
    ]);
    const third = await getCachedOptionalSession(env(), request);

    expect(getBetterAuthSession).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);

    await getCachedOptionalSession(env(), new Request("https://0509.io/app"));
    expect(getBetterAuthSession).toHaveBeenCalledTimes(2);
  });

  it("resolves the workspace once per Request and re-resolves for a different user id", async () => {
    const resolveWorkspace = vi.fn().mockResolvedValue({
      workspaceUserId: "owner-1",
      isMember: true,
      ownerName: "Owner",
    });
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace,
    }));

    const { getCachedWorkspaceForRequest } = await import("~/lib/auth.server");
    const request = new Request("https://0509.io/app");
    const [first, second] = await Promise.all([
      getCachedWorkspaceForRequest(env(), request, "user-1"),
      getCachedWorkspaceForRequest(env(), request, "user-1"),
    ]);

    expect(resolveWorkspace).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    await getCachedWorkspaceForRequest(env(), request, "user-2");
    expect(resolveWorkspace).toHaveBeenCalledTimes(2);
    expect(resolveWorkspace).toHaveBeenLastCalledWith(expect.anything(), "user-2");
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

    const ticketDb = dbWithMagicLinkTickets("user-1");
    const testEnv = env({ DB: ticketDb.db });
    const { sendBetterAuthMagicLink: sendMagicLink } = await import("~/lib/better-auth.server");
    await sendMagicLink(
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
          metadata: { mode: "signup" },
          newUserCallbackURL: "https://0509.io/app/onboard",
        }),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
				from: { email: "alerts@0509.io", name: "Five to Nine" },
        html: expect.stringContaining(
          'href="https://0509.io/auth/better/magic-link?ticket=',
        ),
        text: expect.stringContaining(
          "Activate account: https://0509.io/auth/better/magic-link?ticket=",
        ),
      }),
    );
    expect(ticketDb.tickets.size).toBe(1);
    const [ticket] = ticketDb.tickets.values();
    expect(ticket?.mode).toBe("signup");
    expect(ticket?.payload).not.toContain("secret-token");
    expect(send.mock.calls[0]?.[0]?.html).not.toContain("owner@example.com");
    expect(send.mock.calls[0]?.[0]?.html).not.toContain("secret-token");
    expect(send.mock.calls[0]?.[0]?.html).not.toContain("/api/auth/magic-link/verify");
  });

  it("wraps magic-link email sends in the shared timeout", async () => {
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
        url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
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
    const promiseWithTimeout = vi.fn(
      async (_operation: Promise<unknown>, _timeoutMs: number, message?: string) => {
        throw new Error(message);
      },
    );
    vi.doMock("~/lib/fetch-timeout.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/fetch-timeout.server")>(
        "~/lib/fetch-timeout.server",
      );
      return {
        ...actual,
        promiseWithTimeout,
      };
    });

    const ticketDb = dbWithMagicLinkTickets("user-1");
    const testEnv = env({ DB: ticketDb.db });
    const { sendBetterAuthMagicLink: sendMagicLink } = await import("~/lib/better-auth.server");
    await expect(
      sendMagicLink(testEnv, new Request("https://0509.io/auth/login"), {
        email: "owner@example.com",
        mode: "login",
        redirectTo: "/app",
      }),
    ).rejects.toThrow("Better Auth magic-link email timed out.");
    expect(promiseWithTimeout).toHaveBeenCalledWith(
      expect.any(Promise),
      BETTER_AUTH_EMAIL_SEND_TIMEOUT_MS,
      "Better Auth magic-link email timed out.",
    );
  });

  it("builds a one-time app ticket URL without exposing the Better Auth token", async () => {
    const ticketDb = dbWithMagicLinkTickets();
    const confirmationUrl = await betterAuthMagicLinkConfirmationUrl(env({ DB: ticketDb.db }), {
      email: "owner@example.com",
      mode: "signup",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp&newUserCallbackURL=https%3A%2F%2F0509.io%2Fapp%2Fonboard",
    });
    const parsed = new URL(confirmationUrl);

    expect(parsed.pathname).toBe("/auth/better/magic-link");
    const rawTicket = parsed.searchParams.get("ticket") ?? "";
    expect(rawTicket).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(parsed.searchParams.has("token")).toBe(false);
    expect(parsed.searchParams.has("callbackURL")).toBe(false);
    expect(parsed.searchParams.has("newUserCallbackURL")).toBe(false);
    expect(parsed.searchParams.has("state")).toBe(false);
    expect(parsed.searchParams.has("context")).toBe(false);
    expect(confirmationUrl).not.toContain("owner@example.com");
    expect(confirmationUrl).not.toContain("owner%40example.com");
    expect(confirmationUrl).not.toContain("secret-token");
    const [ticket] = ticketDb.tickets.values();
    expect(ticket?.payload).not.toContain("secret-token");
    expect(ticketDb.tickets.has(rawTicket)).toBe(false);
  });

  it("stages ticket email links on GET without redeeming them", async () => {
    const { verifyBetterAuthMagicLink } = await mockBetterAuthMagicLinkServer();

    const { loader } = await import("~/routes/auth.better.magic-link");
    const ticketDb = dbWithMagicLinkTickets();
    const testEnv = env({ DB: ticketDb.db });
    const ticketUrl = await betterAuthMagicLinkConfirmationUrl(testEnv, {
      email: "owner@example.com",
      mode: "login",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });

    const { redirectResponse } = await stageTicketFromEmailLink(loader, testEnv, ticketUrl);

    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers.get("Location")).toBe("/auth/better/magic-link?mode=login");
    expect(verifyBetterAuthMagicLink).not.toHaveBeenCalled();
    const [ticket] = ticketDb.tickets.values();
    expect(ticket?.consumed_at).toBeNull();
    const stagingCookies = setCookieValues(redirectResponse.headers);
    const stagingCookie =
      stagingCookies.find(
        (value) =>
          value.startsWith("f9_better_magic=") &&
          value.includes("Path=/auth") &&
          !value.includes("Max-Age=0"),
      ) ?? "";
    const legacyClearCookie =
      stagingCookies.find(
        (value) => value.startsWith("f9_better_magic=;") && value.includes("Path=/auth/better/magic-link"),
      ) ?? "";
    const domainPrimaryClearCookie =
      stagingCookies.find(
        (value) =>
          value.startsWith("f9_better_magic=;") &&
          value.includes("Path=/auth") &&
          value.includes("Domain=0509.io"),
      ) ?? "";
    const domainLegacyClearCookie =
      stagingCookies.find(
        (value) =>
          value.startsWith("f9_better_magic=;") &&
          value.includes("Path=/auth/better/magic-link") &&
          value.includes("Domain=0509.io"),
      ) ?? "";
    expect(stagingCookie).toContain("f9_better_magic=");
    expect(stagingCookie).toContain("HttpOnly");
    expect(stagingCookie).toContain("SameSite=Lax");
    expect(stagingCookie).toContain("Path=/auth");
    expect(stagingCookie).not.toContain("Path=/auth/better/magic-link");
    expect(stagingCookie).toContain("Secure");
    expect(legacyClearCookie).toContain("Max-Age=0");
    expect(domainPrimaryClearCookie).toContain("Max-Age=0");
    expect(domainLegacyClearCookie).toContain("Max-Age=0");
    expect(stagingCookies.indexOf(domainPrimaryClearCookie)).toBeLessThan(stagingCookies.indexOf(stagingCookie));
    expect(redirectResponse.headers.get("Location")).not.toContain("ticket=");
  });

  it("signs in after a same-origin confirmation POST", async () => {
    const { verifyBetterAuthMagicLink } = await mockBetterAuthMagicLinkServer();

    const { action, loader } = await import("~/routes/auth.better.magic-link");
    const ticketDb = dbWithMagicLinkTickets();
    const testEnv = env({ DB: ticketDb.db });
    const ticketUrl = await betterAuthMagicLinkConfirmationUrl(testEnv, {
      email: "owner@example.com",
      mode: "login",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const { ticketCookie } = await stageTicketFromEmailLink(loader, testEnv, ticketUrl);
    const response = await postMagicLinkConfirmation(action, testEnv, ticketCookie);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://0509.io/app");
    const combinedSetCookie = setCookieValues(response.headers).join("\n");
    expect(combinedSetCookie).toContain("__Secure-better-auth.session_token=session-token");
    expect(combinedSetCookie).toContain("f9_better_magic=;");
    expect(verifyBetterAuthMagicLink).toHaveBeenCalledTimes(1);
    const [ticket] = ticketDb.tickets.values();
    expect(ticket?.consumed_at).toEqual(expect.any(String));
  });

  it("signs in after React Router posts the confirmation form to the data route", async () => {
    const { verifyBetterAuthMagicLink } = await mockBetterAuthMagicLinkServer();

    const { action, loader } = await import("~/routes/auth.better.magic-link");
    const ticketDb = dbWithMagicLinkTickets();
    const testEnv = env({ DB: ticketDb.db });
    const ticketUrl = await betterAuthMagicLinkConfirmationUrl(testEnv, {
      email: "owner@example.com",
      mode: "login",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const { redirectResponse, ticketCookie } = await stageTicketFromEmailLink(loader, testEnv, ticketUrl);
    const stagingCookie = setCookieValues(redirectResponse.headers).join("\n");

    expect(stagingCookie).toContain("Path=/auth");
    const response = await postMagicLinkConfirmation(
      action,
      testEnv,
      ticketCookie,
      "login",
      magicLinkConfirmDataUrl("login"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://0509.io/app");
    const combinedSetCookie = setCookieValues(response.headers).join("\n");
    expect(combinedSetCookie).toContain("__Secure-better-auth.session_token=session-token");
    expect(combinedSetCookie).toContain("f9_better_magic=;");
    expect(verifyBetterAuthMagicLink).toHaveBeenCalledTimes(1);
    const [ticket] = ticketDb.tickets.values();
    expect(ticket?.consumed_at).toEqual(expect.any(String));
  });

  it("ignores stale duplicate magic-link cookies before the staged ticket cookie", async () => {
    const { verifyBetterAuthMagicLink } = await mockBetterAuthMagicLinkServer();

    const { action, loader } = await import("~/routes/auth.better.magic-link");
    const ticketDb = dbWithMagicLinkTickets();
    const testEnv = env({ DB: ticketDb.db });
    const ticketUrl = await betterAuthMagicLinkConfirmationUrl(testEnv, {
      email: "owner@example.com",
      mode: "login",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const { ticketCookie } = await stageTicketFromEmailLink(loader, testEnv, ticketUrl);
    const response = await postMagicLinkConfirmation(
      action,
      testEnv,
      `f9_better_magic=stale-invalid-cookie; ${ticketCookie}`,
      "login",
      magicLinkConfirmDataUrl("login"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://0509.io/app");
    expect(verifyBetterAuthMagicLink).toHaveBeenCalledTimes(1);
    const [ticket] = ticketDb.tickets.values();
    expect(ticket?.consumed_at).toEqual(expect.any(String));
  });

  it("ignores stale well-formed ticket cookies before the staged ticket cookie", async () => {
    const { verifyBetterAuthMagicLink } = await mockBetterAuthMagicLinkServer();

    const { action, loader } = await import("~/routes/auth.better.magic-link");
    const staleTicketDb = dbWithMagicLinkTickets();
    const staleTicketEnv = env({ DB: staleTicketDb.db });
    const staleTicketUrl = await betterAuthMagicLinkConfirmationUrl(staleTicketEnv, {
      email: "owner@example.com",
      mode: "login",
      url: "https://0509.io/api/auth/magic-link/verify?token=stale-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const { ticketCookie: staleTicketCookie } = await stageTicketFromEmailLink(
      loader,
      staleTicketEnv,
      staleTicketUrl,
    );
    const ticketDb = dbWithMagicLinkTickets();
    const testEnv = env({ DB: ticketDb.db });
    const ticketUrl = await betterAuthMagicLinkConfirmationUrl(testEnv, {
      email: "owner@example.com",
      mode: "login",
      url: "https://0509.io/api/auth/magic-link/verify?token=fresh-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const { ticketCookie } = await stageTicketFromEmailLink(loader, testEnv, ticketUrl);
    const combinedCookies = `${staleTicketCookie}; ${ticketCookie}`;
    const cleanResponse = await loader({
      context: context(testEnv),
      params: {},
      pattern: "/auth/better/magic-link",
      request: new Request("https://0509.io/auth/better/magic-link?mode=login", {
        headers: { cookie: combinedCookies },
      }),
      url: "https://0509.io/auth/better/magic-link?mode=login",
    } as never);

    expect(cleanResponse.status).toBe(200);
    await expect(cleanResponse.json()).resolves.toEqual({
      error: "",
      mode: "login",
    });

    const response = await postMagicLinkConfirmation(
      action,
      testEnv,
      combinedCookies,
      "login",
      magicLinkConfirmDataUrl("login"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://0509.io/app");
    expect(verifyBetterAuthMagicLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Request),
      expect.objectContaining({
        token: "fresh-token",
      }),
    );
    const [ticket] = ticketDb.tickets.values();
    expect(ticket?.consumed_at).toEqual(expect.any(String));
  });

  it("prefers and consumes staged ticket cookies when legacy cookies are also present", async () => {
    const { verifyBetterAuthMagicLink } = await mockBetterAuthMagicLinkServer();

    const { action, loader } = await import("~/routes/auth.better.magic-link");
    const ticketDb = dbWithMagicLinkTickets();
    const testEnv = env({ DB: ticketDb.db });
    const legacyUrl =
      "https://0509.io/auth/better/magic-link?token=legacy-token&callbackURL=https%3A%2F%2F0509.io%2Fapp&state=state-1";
    const legacyRedirect = (await Promise.resolve(
      loader({
        context: context(testEnv),
        params: {},
        pattern: "/auth/better/magic-link",
        request: new Request(legacyUrl, {
          headers: { cookie: "f9_better_magic_state=state-1" },
        }),
        url: legacyUrl,
      } as never),
    ).catch((error) => error)) as Response;
    const legacyCookie = cookieHeader(setCookieValues(legacyRedirect.headers), "f9_better_magic");
    const ticketUrl = await betterAuthMagicLinkConfirmationUrl(testEnv, {
      email: "owner@example.com",
      mode: "login",
      url: "https://0509.io/api/auth/magic-link/verify?token=ticket-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const { ticketCookie } = await stageTicketFromEmailLink(loader, testEnv, ticketUrl);
    const response = await postMagicLinkConfirmation(
      action,
      testEnv,
      `${legacyCookie}; ${ticketCookie}`,
      "login",
      magicLinkConfirmDataUrl("login"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://0509.io/app");
    expect(verifyBetterAuthMagicLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Request),
      expect.objectContaining({
        token: "ticket-token",
      }),
    );
    const [ticket] = ticketDb.tickets.values();
    expect(ticket?.consumed_at).toEqual(expect.any(String));
  });

  it("survives repeated ticket GET requests like email security scanners", async () => {
    const { verifyBetterAuthMagicLink } = await mockBetterAuthMagicLinkServer();

    const { loader } = await import("~/routes/auth.better.magic-link");
    const ticketDb = dbWithMagicLinkTickets();
    const testEnv = env({ DB: ticketDb.db });
    const ticketUrl = await betterAuthMagicLinkConfirmationUrl(testEnv, {
      email: "owner@example.com",
      mode: "login",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const first = await stageTicketFromEmailLink(loader, testEnv, ticketUrl);
    const second = (await Promise.resolve(
      loader({
        context: context(testEnv),
        params: {},
        pattern: "/auth/better/magic-link",
        request: new Request(ticketUrl, {
          headers: { cookie: first.ticketCookie },
        }),
        url: ticketUrl,
      } as never),
    ).catch((error) => error)) as Response;

    expect(second.status).toBe(302);
    expect(second.headers.get("Location")).toBe("/auth/better/magic-link?mode=login");
    const secondSetCookies = setCookieValues(second.headers);
    expect(
      secondSetCookies.some(
        (value) =>
          value.startsWith("f9_better_magic=") &&
          value.includes("Path=/auth") &&
          !value.includes("Max-Age=0"),
      ),
    ).toBe(true);
    expect(
      secondSetCookies.some(
        (value) => value.startsWith("f9_better_magic=;") && value.includes("Path=/auth/better/magic-link"),
      ),
    ).toBe(true);
    expect(verifyBetterAuthMagicLink).not.toHaveBeenCalled();
    const [ticket] = ticketDb.tickets.values();
    expect(ticket?.consumed_at).toBeNull();
  });

  it("reopens the app when the email link is opened again after sign-in", async () => {
    const { verifyBetterAuthMagicLink } = await mockBetterAuthMagicLinkServer();

    const { loader } = await import("~/routes/auth.better.magic-link");
    const ticketDb = dbWithMagicLinkTickets();
    const testEnv = env({ DB: ticketDb.db });
    const ticketUrl = await betterAuthMagicLinkConfirmationUrl(testEnv, {
      email: "owner@example.com",
      mode: "login",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const sessionCookie =
      "__Secure-better-auth.session_token=session-token; __Secure-better-auth.session_data=session-data";
    const secondRedirect = (await Promise.resolve(
      loader({
        context: context(testEnv),
        params: {},
        pattern: "/auth/better/magic-link",
        request: new Request(ticketUrl, {
          headers: { cookie: sessionCookie },
        }),
        url: ticketUrl,
      } as never),
    ).catch((error) => error)) as Response;

    expect(secondRedirect.status).toBe(302);
    expect(secondRedirect.headers.get("Location")).toBe("https://0509.io/app");
    expect(verifyBetterAuthMagicLink).not.toHaveBeenCalled();
  });

  it("preserves in-flight legacy token links during ticket rollout", async () => {
    const { verifyBetterAuthMagicLink } = await mockBetterAuthMagicLinkServer();

    const { action, loader } = await import("~/routes/auth.better.magic-link");
    const legacyUrl =
      "https://0509.io/auth/better/magic-link?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp&state=state-1";
    const redirectResponse = (await Promise.resolve(
      loader({
        context: context(env()),
        params: {},
        pattern: "/auth/better/magic-link",
        request: new Request(legacyUrl, {
          headers: { cookie: "f9_better_magic_state=state-1" },
        }),
        url: legacyUrl,
      } as never),
    ).catch((error) => error)) as Response;

    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers.get("Location")).toBe("/auth/better/magic-link?mode=login");
    const ticketCookie = cookieHeader(setCookieValues(redirectResponse.headers), "f9_better_magic");
    const cleanResponse = await loader({
      context: context(env()),
      params: {},
      pattern: "/auth/better/magic-link",
      request: new Request("https://0509.io/auth/better/magic-link?mode=login", {
        headers: { cookie: ticketCookie },
      }),
      url: "https://0509.io/auth/better/magic-link?mode=login",
    } as never);
    await expect(cleanResponse.json()).resolves.toEqual({
      error: "",
      mode: "login",
    });

    const response = (await Promise.resolve(
      action({
        context: context(env()),
        params: {},
        pattern: "/auth/better/magic-link",
        request: new Request("https://0509.io/auth/better/magic-link?mode=login", {
          body: new URLSearchParams(),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie: ticketCookie,
            origin: "https://0509.io",
          },
          method: "POST",
        }),
        url: "https://0509.io/auth/better/magic-link?mode=login",
      } as never),
    ).catch((error) => error)) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://0509.io/app");
    expect(verifyBetterAuthMagicLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Request),
      expect.objectContaining({
        callbackURL: "https://0509.io/app",
        token: "secret-token",
      }),
    );
  });

  it("loads a valid legacy confirmation when a stale ticket cookie is also present", async () => {
    await mockBetterAuthMagicLinkServer();

    const { loader } = await import("~/routes/auth.better.magic-link");
    const staleTicketDb = dbWithMagicLinkTickets();
    const staleTicketEnv = env({ DB: staleTicketDb.db });
    const staleTicketUrl = await betterAuthMagicLinkConfirmationUrl(staleTicketEnv, {
      email: "owner@example.com",
      mode: "login",
      url: "https://0509.io/api/auth/magic-link/verify?token=ticket-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const { ticketCookie: staleTicketCookie } = await stageTicketFromEmailLink(
      loader,
      staleTicketEnv,
      staleTicketUrl,
    );
    const legacyEnv = env({ DB: dbWithMagicLinkTickets().db });
    const legacyUrl =
      "https://0509.io/auth/better/magic-link?token=legacy-token&callbackURL=https%3A%2F%2F0509.io%2Fapp&state=state-1";
    const legacyRedirect = (await Promise.resolve(
      loader({
        context: context(legacyEnv),
        params: {},
        pattern: "/auth/better/magic-link",
        request: new Request(legacyUrl, {
          headers: { cookie: "f9_better_magic_state=state-1" },
        }),
        url: legacyUrl,
      } as never),
    ).catch((error) => error)) as Response;
    const legacyCookie = cookieHeader(setCookieValues(legacyRedirect.headers), "f9_better_magic");

    const cleanResponse = await loader({
      context: context(legacyEnv),
      params: {},
      pattern: "/auth/better/magic-link",
      request: new Request("https://0509.io/auth/better/magic-link?mode=login", {
        headers: { cookie: `${staleTicketCookie}; ${legacyCookie}` },
      }),
      url: "https://0509.io/auth/better/magic-link?mode=login",
    } as never);

    expect(cleanResponse.status).toBe(200);
    await expect(cleanResponse.json()).resolves.toEqual({
      error: "",
      mode: "login",
    });
  });

  it("rejects confirmation posts without the staged legacy ticket", async () => {
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

    const { action } = await import("~/routes/auth.better.magic-link");

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

  it("redeems signup tickets after confirmation POST", async () => {
    const { verifyBetterAuthMagicLink } = await mockBetterAuthMagicLinkServer({
      verifyBetterAuthMagicLink: async () =>
        mockBetterAuthVerifyResponse("https://0509.io/app/onboard"),
    });

    const { action, loader } = await import("~/routes/auth.better.magic-link");
    const ticketDb = dbWithMagicLinkTickets();
    const testEnv = env({ DB: ticketDb.db });
    const ticketUrl = await betterAuthMagicLinkConfirmationUrl(testEnv, {
      email: "owner@example.com",
      mode: "signup",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp&newUserCallbackURL=https%3A%2F%2F0509.io%2Fapp%2Fonboard",
    });
    const { ticketCookie } = await stageTicketFromEmailLink(loader, testEnv, ticketUrl, "signup");
    const response = await postMagicLinkConfirmation(action, testEnv, ticketCookie, "signup");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://0509.io/app/onboard");
    expect(verifyBetterAuthMagicLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Request),
      expect.objectContaining({
        callbackURL: "https://0509.io/app",
        newUserCallbackURL: "https://0509.io/app/onboard",
        token: "secret-token",
      }),
    );
    const [ticket] = ticketDb.tickets.values();
    expect(ticket?.consumed_at).toEqual(expect.any(String));
  });

  it("round-trips session cookies from magic-link confirmation into session lookup", async () => {
    const getBetterAuthSessionImpl = vi.fn(async (_env, request: Request) => {
      const cookie = request.headers.get("cookie") ?? "";
      if (!cookie.includes("__Secure-better-auth.session_token=session-token")) {
        return null;
      }

      return {
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
      };
    });
    const { getBetterAuthSession } = await mockBetterAuthMagicLinkServer({
      getBetterAuthSession: getBetterAuthSessionImpl,
    });

    const { action, loader } = await import("~/routes/auth.better.magic-link");
    const ticketDb = dbWithMagicLinkTickets();
    const testEnv = env({ DB: ticketDb.db });
    const ticketUrl = await betterAuthMagicLinkConfirmationUrl(testEnv, {
      email: "owner@example.com",
      mode: "login",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const { ticketCookie } = await stageTicketFromEmailLink(loader, testEnv, ticketUrl);
    const redirectResponse = await postMagicLinkConfirmation(action, testEnv, ticketCookie);

    const cookieHeaderValue = setCookieValues(redirectResponse.headers)
      .map((value) => value.split(";")[0] ?? value)
      .join("; ");
    const { getOptionalSession } = await import("~/lib/auth.server");
    const session = await getOptionalSession(
      testEnv,
      new Request("https://0509.io/app", {
        headers: { cookie: cookieHeaderValue },
      }),
    );

    expect(redirectResponse.status).toBe(302);
    expect(session?.user.email).toBe("owner@example.com");
    expect(getBetterAuthSession).toHaveBeenCalled();
  });

  it("rejects confirmation POST without a staged ticket", async () => {
    const { verifyBetterAuthMagicLink } = await mockBetterAuthMagicLinkServer();

    const { action } = await import("~/routes/auth.better.magic-link");

    const response = await postMagicLinkConfirmation(action, env(), "", "login");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/auth/login?error=callback_failed");
    expect(verifyBetterAuthMagicLink).not.toHaveBeenCalled();
  });

  it("maps Better Auth verify error redirects to callback_failed", async () => {
    await mockBetterAuthMagicLinkServer({
      verifyBetterAuthMagicLink: async () =>
        new Response(null, {
          headers: {
            Location: "https://0509.io/auth/login?error=INVALID_TOKEN",
          },
          status: 302,
        }),
    });

    const { action, loader } = await import("~/routes/auth.better.magic-link");
    const ticketDb = dbWithMagicLinkTickets();
    const testEnv = env({ DB: ticketDb.db });
    const ticketUrl = await betterAuthMagicLinkConfirmationUrl(testEnv, {
      email: "owner@example.com",
      mode: "login",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const { ticketCookie } = await stageTicketFromEmailLink(loader, testEnv, ticketUrl);
    const failedResponse = await postMagicLinkConfirmation(action, testEnv, ticketCookie);

    expect(failedResponse.status).toBe(302);
    expect(failedResponse.headers.get("Location")).toBe("/auth/login?error=callback_failed");
    const [ticket] = ticketDb.tickets.values();
    expect(ticket?.consumed_at).toBeNull();
  });

  it("forwards every cookie from a comma-joined Set-Cookie fallback", () => {
    const source = new Headers();
    source.set(
      "Set-Cookie",
      "better-auth.session_token=session-1; HttpOnly; Path=/, better-auth.session_data=session-data; HttpOnly; Path=/",
    );
    const target = new Headers();
    appendBetterAuthSetCookieHeaders(target, source);
    const cookies = setCookieValues(target);
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("better-auth.session_token=session-1");
    expect(cookies[1]).toContain("better-auth.session_data=session-data");
  });

  it("preserves an unconsumed ticket when Better Auth verification throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await mockBetterAuthMagicLinkServer({
      verifyBetterAuthMagicLink: async () => {
        throw new Error("temporary D1 error");
      },
    });

    const { action, loader } = await import("~/routes/auth.better.magic-link");
    const ticketDb = dbWithMagicLinkTickets();
    const testEnv = env({ DB: ticketDb.db });
    const ticketUrl = await betterAuthMagicLinkConfirmationUrl(testEnv, {
      email: "owner@example.com",
      mode: "login",
      url: "https://0509.io/api/auth/magic-link/verify?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp",
    });
    const { ticketCookie } = await stageTicketFromEmailLink(loader, testEnv, ticketUrl);
    const failedResponse = await postMagicLinkConfirmation(action, testEnv, ticketCookie);

    expect(failedResponse.status).toBe(302);
    expect(failedResponse.headers.get("Location")).toBe("/auth/login?error=callback_failed");
    const [ticket] = ticketDb.tickets.values();
    expect(ticket?.consumed_at).toBeNull();
  });

  it("renders branded auth email without exposing the raw link in the HTML body text", () => {
    const email = buildBetterAuthMagicLinkEmail({
      mode: "signup",
      url: "https://0509.io/auth/better/magic-link?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp&context=context-1",
    });

		expect(email.subject).toBe("Activate your Five to Nine workspace");
		expect(email.html).toContain("Five to Nine account activation");
    expect(email.html).toContain(">Activate account</a>");
    expect(email.html).not.toContain(">https://0509.io/auth/better/magic-link");
    expect(email.text).toContain("Activate account: https://0509.io/auth/better/magic-link");
  });

	it("uses a mode-aware eyebrow and subject for sign-in emails", () => {
		const email = buildBetterAuthMagicLinkEmail({
			mode: "login",
			url: "https://0509.io/auth/better/magic-link?token=secret-token&callbackURL=https%3A%2F%2F0509.io%2Fapp&context=context-1",
		});

		expect(email.subject).toBe("Sign in to Five to Nine");
		expect(email.html).toContain("Five to Nine sign in");
		// Regression: the eyebrow used to say "Account Activation" on sign-in emails.
		expect(email.html).not.toContain("account activation");
		expect(email.html).not.toContain("Account Activation");
		expect(email.html).not.toContain("Activate account");
		expect(email.html).toContain(">Sign in</a>");
	});
});

describe("Better Auth passkey login gating", () => {
  it("only exposes passkey login when the known email has registered passkeys", async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (sql.includes("FROM passkey")) {
            return { id: "passkey-1" };
          }
          return null;
        }),
      })),
    }));
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));

    const testEnv = env({ DB: { prepare } as unknown as D1Database });
    const { hasBetterAuthPasskeysForEmail } = await import("~/lib/better-auth.server");
    expect(await hasBetterAuthPasskeysForEmail(testEnv, "owner@example.com")).toBe(true);
    expect(await hasBetterAuthPasskeysForEmail(testEnv, "")).toBe(false);

    const { loader } = await import("~/routes/auth.login");
    await expect(
      loader({
        context: context(testEnv),
        params: {},
        pattern: "/auth/login",
        request: new Request("https://0509.io/auth/login?email=owner%40example.com"),
        url: "https://0509.io/auth/login?email=owner%40example.com",
      } as never),
    ).resolves.toMatchObject({
      passkeysEnabled: true,
      prefillEmail: "owner@example.com",
    });

    await expect(
      loader({
        context: context(testEnv),
        params: {},
        pattern: "/auth/login",
        request: new Request("https://0509.io/auth/login"),
        url: "https://0509.io/auth/login",
      } as never),
    ).resolves.toMatchObject({
      prefillEmail: "",
    });
    await expect(
      loader({
        context: context(testEnv),
        params: {},
        pattern: "/auth/login",
        request: new Request("https://0509.io/auth/login"),
        url: "https://0509.io/auth/login",
      } as never),
    ).resolves.not.toHaveProperty("passkeysEnabled");
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
      error: "We couldn't verify that sign-in link — it may have expired. Request a fresh one below.",
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
      error: "We couldn't verify that setup link — it may have expired. Request a fresh one below.",
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
        getBetterAuthSession: vi.fn().mockResolvedValue(null),
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
    expect(redirectResponse?.headers.get("Set-Cookie")).toBeNull();

    const { loader } = await import("~/routes/auth.login");
    const page = await loader({
      context: context(
        env({
          DB: {
            prepare: vi.fn().mockReturnValue({
              bind: vi.fn().mockReturnValue({
                first: vi.fn().mockResolvedValue(null),
              }),
            }),
          } as unknown as D1Database,
        }),
      ),
      params: {},
      pattern: "/auth/login",
      request: new Request(
        "https://0509.io/auth/login?sent=1&email=unknown%40example.com&redirectTo=%2Fapp",
      ),
      url: "https://0509.io/auth/login?sent=1&email=unknown%40example.com&redirectTo=%2Fapp",
    } as never);
    expect(page.message).toContain("If an account exists");
    expect(page.message).not.toContain("Check your email");
  });

  it("redacts raw provider errors when login email sending fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.doMock("~/lib/better-auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/better-auth.server")>(
        "~/lib/better-auth.server",
      );
      return {
        ...actual,
        sendBetterAuthMagicLink: vi
          .fn()
          .mockRejectedValue(new Error("provider leaked owner@example.com")),
      };
    });

    const { action } = await import("~/routes/auth.login");
    let redirectResponse: Response | null = null;
    try {
      await action({
        context: context(env()),
        params: {},
        pattern: "/auth/login",
        request: new Request("https://0509.io/auth/login", {
          body: new URLSearchParams({ email: "owner@example.com", redirectTo: "/app" }),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://0509.io",
          },
          method: "POST",
        }),
        url: "https://0509.io/auth/login",
      } as never);
    } catch (error) {
      redirectResponse = error as Response;
    }

    expect(redirectResponse?.status).toBe(302);
    expect(redirectResponse?.headers.get("Location")).toBe(
      "/auth/login?error=send_failed&redirectTo=%2Fapp&email=owner%40example.com",
    );
    expect(warn).toHaveBeenCalledWith("failed to send Better Auth login email", {
      errorName: "Error",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("owner@example.com");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("provider leaked");
  });

  it("redacts raw provider errors when signup email sending fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.doMock("~/lib/better-auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/better-auth.server")>(
        "~/lib/better-auth.server",
      );
      return {
        ...actual,
        sendBetterAuthMagicLink: vi
          .fn()
          .mockRejectedValue(new Error("provider leaked owner@example.com")),
      };
    });

    const { action } = await import("~/routes/auth.signup");
    const result = await action({
      context: context(env()),
      params: {},
      pattern: "/auth/signup",
      request: new Request("https://0509.io/auth/signup", {
        body: new URLSearchParams({
          email: "owner@example.com",
          name: "Owner",
          redirectTo: "/app/onboard",
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://0509.io",
        },
        method: "POST",
      }),
      url: "https://0509.io/auth/signup",
    } as never);

    expect(result).toEqual({
      ok: false,
      error: "We couldn't send the setup link. Try again in a minute.",
      email: "owner@example.com",
      name: "Owner",
      redirectTo: "/app/onboard",
    });
    expect(warn).toHaveBeenCalledWith("failed to send Better Auth signup email", {
      errorName: "Error",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("owner@example.com");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("provider leaked");
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

  it("clears the local E2E fixture session cookie on test-mode logout", async () => {
    vi.doMock("~/lib/better-auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/better-auth.server")>(
        "~/lib/better-auth.server",
      );
      return {
        ...actual,
        signOutBetterAuth: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
      };
    });

    const { action } = await import("~/routes/auth.logout");
    const request = new Request("http://127.0.0.1:4179/auth/logout", {
      headers: {
        cookie: "f9_e2e_fixture=e2e-starter",
        origin: "http://127.0.0.1:4179",
      },
      method: "POST",
    });

    let redirectResponse: Response | null = null;
    try {
      await action({
        context: context(env({ E2E_TEST_MODE: "1" })),
        params: {},
        pattern: "/auth/logout",
        request,
        url: "http://127.0.0.1:4179/auth/logout",
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
    expect(combinedSetCookie).toContain("f9_e2e_fixture=;");
    expect(combinedSetCookie).toContain("Path=/");
    expect(combinedSetCookie).toContain("Max-Age=0");
  });

  it("clears the local E2E fixture session cookie on database-sentinel logout", async () => {
    vi.doMock("~/lib/better-auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/better-auth.server")>(
        "~/lib/better-auth.server",
      );
      return {
        ...actual,
        signOutBetterAuth: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
      };
    });

    const { action } = await import("~/routes/auth.logout");
    const request = new Request("http://127.0.0.1:4179/auth/logout", {
      headers: {
        cookie: "f9_e2e_fixture=e2e-starter",
        origin: "http://127.0.0.1:4179",
      },
      method: "POST",
    });

    let redirectResponse: Response | null = null;
    try {
      await action({
        context: context(env({ DB: dbWithE2ETestMode(true), E2E_TEST_MODE: "0" })),
        params: {},
        pattern: "/auth/logout",
        request,
        url: "http://127.0.0.1:4179/auth/logout",
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
    expect(combinedSetCookie).toContain("f9_e2e_fixture=;");
    expect(combinedSetCookie).toContain("Path=/");
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
