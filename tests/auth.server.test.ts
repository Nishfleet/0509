import { afterEach, describe, expect, it, vi } from "vitest";

import { getCachedOptionalSession, getOptionalSession, requireSession } from "~/lib/auth.server";
import { upsertStytchAuthenticatedUser } from "~/lib/data.server";
import {
  authRequestPkceCookie,
  authRequestStateCookie,
  createStytchAuthRequest,
  createStytchPkcePair,
  isSameOriginAuthFormPost,
  isSameBrowserAuthRequest,
  isStytchConfigured,
  isStytchOAuthConfigured,
  readStytchPkceVerifier,
  sendDiscoveryEmail,
  stytchConfirmationCookie,
  stytchOAuthDiscoveryStartUrl,
  stytchWorkspaceCreationReason,
  verifyStytchConfirmationNonce,
  verifyStytchConfirmationSecret,
  type StytchAuthRequest,
} from "~/lib/stytch-b2b.server";
import { action as loginAction } from "~/routes/auth.login";
import { action as logoutAction, loader as logoutLoader } from "~/routes/auth.logout";
import { action as signupAction } from "~/routes/auth.signup";
import { action as callbackAction, loader as callbackLoader } from "~/routes/auth.stytch.callback";
import { loader as confirmLoader } from "~/routes/auth.stytch.confirm";
import { action as oauthAction } from "~/routes/auth.stytch.oauth";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stytchActionTestEnv(db: unknown) {
  return {
    APP_ORIGIN: "https://0509.io",
    AUTH_PROVIDER: "stytch",
    DB: db as D1Database,
    STYTCH_API_BASE_URL: "https://api.stytch.test",
    STYTCH_PROJECT_ID: "project-test",
    STYTCH_SECRET: "secret-test",
  };
}

function authFormPost(url: string, values: Record<string, string>) {
  return new Request(url, {
    method: "POST",
    body: new URLSearchParams(values),
    headers: { origin: "https://0509.io" },
  });
}

describe("Stytch auth boundary", () => {
  it("does not create a session without the D1 app database", async () => {
    await expect(getOptionalSession({}, new Request("https://0509.io/app"))).resolves.toBeNull();
  });

  it("does not call Stytch without a session cookie", async () => {
    await expect(
      getOptionalSession({ DB: {} as D1Database }, new Request("https://0509.io/app")),
    ).resolves.toBeNull();
  });

  it("reads Stytch sessions from the local cache without calling Stytch", async () => {
    const fetchSpy = vi.fn();
    const calls: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            calls.push({ sql, bindings });
            return {
              async all() {
                return {
                  results: sql.includes("FROM stytch_session")
                    ? [
                        {
                          sessionId: "member-session-1",
                          sessionUserId: "user-1",
                          expiresAt: "2099-01-01T00:00:00.000Z",
                          id: "user-1",
                          email: "asha@agency.com",
                          name: "Asha",
                          image: null,
                          onboardedAt: "2026-06-01T00:00:00.000Z",
                        },
                      ]
                    : [],
                };
              },
            };
          },
        };
      },
    };
    vi.stubGlobal("fetch", fetchSpy);

    const session = await getCachedOptionalSession(
      { DB: db as unknown as D1Database },
      new Request("https://0509.io/app", {
        headers: { cookie: "f9_stytch_session=session-123" },
      }),
    );

    expect(session?.user.email).toBe("asha@agency.com");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls.map((call) => call.sql).join("\n")).not.toMatch(/\b(INSERT|UPDATE)\b/i);
  });

  it("revalidates optional Stytch sessions before returning private account state", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async all() {
                return {
                  results: sql.includes("FROM stytch_session")
                    ? [
                        {
                          sessionId: "member-session-1",
                          sessionUserId: "user-1",
                          expiresAt: "2099-01-01T00:00:00.000Z",
                          id: "user-1",
                          email: "asha@agency.com",
                          name: "Asha",
                          image: null,
                          onboardedAt: "2026-06-01T00:00:00.000Z",
                        },
                      ]
                    : [],
                };
              },
            };
          },
        };
      },
    };
    const fetchSpy = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          member_session: {
            member_session_id: "member-session-1",
            expires_at: "2099-01-01T00:00:00.000Z",
          },
          member: {
            organization_id: "org-1",
            member_id: "member-1",
            email_address: "asha@agency.com",
          },
          organization: {
            organization_id: "org-1",
            organization_name: "Agency",
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const session = await getOptionalSession(
      {
        DB: db as unknown as D1Database,
        STYTCH_API_BASE_URL: "https://api.stytch.test",
        STYTCH_PROJECT_ID: "project-test",
        STYTCH_SECRET: "secret-test",
      },
      new Request("https://0509.io/search", {
        headers: { cookie: "f9_stytch_session=session-123" },
      }),
    );

    expect(session?.user.email).toBe("asha@agency.com");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("revalidates cached Stytch sessions before protected route access", async () => {
    const calls: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            calls.push({ sql, bindings });
            return {
              async all() {
                return {
                  results: sql.includes("FROM stytch_session")
                    ? [
                        {
                          sessionId: "member-session-1",
                          sessionUserId: "user-1",
                          expiresAt: "2099-01-01T00:00:00.000Z",
                          id: "user-1",
                          email: "asha@agency.com",
                          name: "Asha",
                          image: null,
                          onboardedAt: "2026-06-01T00:00:00.000Z",
                        },
                      ]
                    : [],
                };
              },
            };
          },
        };
      },
    };
    const fetchSpy = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          member_session: {
            member_session_id: "member-session-1",
            expires_at: "2099-01-01T00:00:00.000Z",
          },
          member: {
            organization_id: "org-1",
            member_id: "member-1",
            email_address: "asha@agency.com",
          },
          organization: {
            organization_id: "org-1",
            organization_name: "Agency",
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const session = await requireSession(
      {
        DB: db as unknown as D1Database,
        STYTCH_API_BASE_URL: "https://api.stytch.test",
        STYTCH_PROJECT_ID: "project-test",
        STYTCH_SECRET: "secret-test",
      },
      new Request("https://0509.io/app", {
        headers: { cookie: "f9_stytch_session=session-123" },
      }),
    );

    expect(session.user.email).toBe("asha@agency.com");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(body).toEqual({ session_token: "session-123" });
    expect(calls.map((call) => call.sql).join("\n")).not.toMatch(/\b(INSERT|UPDATE)\b/i);
  });

  it("preserves cached Stytch sessions on transient provider failures", async () => {
    const calls: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            calls.push({ sql, bindings });
            return {
              async all() {
                return {
                  results: sql.includes("FROM stytch_session")
                    ? [
                        {
                          sessionId: "member-session-1",
                          sessionUserId: "user-1",
                          expiresAt: "2099-01-01T00:00:00.000Z",
                          id: "user-1",
                          email: "asha@agency.com",
                          name: "Asha",
                          image: null,
                          onboardedAt: "2026-06-01T00:00:00.000Z",
                        },
                      ]
                    : [],
                };
              },
              async run() {
                return {};
              },
            };
          },
        };
      },
    };
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({ error_message: "temporary unavailable" }), {
        headers: { "Content-Type": "application/json" },
        status: 503,
      });
    });

    try {
      await requireSession(
        {
          DB: db as unknown as D1Database,
          STYTCH_API_BASE_URL: "https://api.stytch.test",
          STYTCH_PROJECT_ID: "project-test",
          STYTCH_SECRET: "secret-test",
        },
        new Request("https://0509.io/app", {
          headers: { cookie: "f9_stytch_session=session-123" },
        }),
      );
      throw new Error("Expected stale provider response to redirect.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
    }

    expect(calls.map((call) => call.sql).join("\n")).not.toMatch(/\bDELETE\b/i);
  });

  it("binds automatic callback completion to the browser that requested the link", () => {
    const request = new Request("https://0509.io/auth/login");
    const cookie = authRequestStateCookie(request, "state-123");
    const pkceCookie = authRequestPkceCookie(request, "state-123", "verifier-123");
    expect(cookie).toContain("f9_stytch_state=state-123");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(pkceCookie).toContain("f9_stytch_pkce=state-123.verifier-123");
    expect(pkceCookie).toContain("HttpOnly");
    expect(readStytchPkceVerifier(
      new Request("https://0509.io/auth/stytch/callback", {
        headers: { cookie: "f9_stytch_pkce=state-123.verifier-123" },
      }),
      "state-123",
    )).toBe("verifier-123");

    expect(
      isSameBrowserAuthRequest(
        new Request("https://0509.io/auth/stytch/callback", {
          headers: { cookie: "f9_stytch_state=state-123" },
        }),
        "state-123",
      ),
    ).toBe(true);
    expect(isSameBrowserAuthRequest(new Request("https://0509.io/auth/stytch/callback"), "state-123")).toBe(false);
  });

  it("only creates Stytch auth requests from same-origin form posts", () => {
    expect(
      isSameOriginAuthFormPost(
        { APP_ORIGIN: "https://0509.io" },
        new Request("https://0509.io/auth/login", {
          method: "POST",
          headers: { origin: "https://0509.io" },
        }),
      ),
    ).toBe(true);
    expect(
      isSameOriginAuthFormPost(
        { APP_ORIGIN: "https://0509.io" },
        new Request("https://preview.0509.dev/auth/login", {
          method: "POST",
          headers: { referer: "https://preview.0509.dev/auth/login" },
        }),
      ),
    ).toBe(true);
    expect(
      isSameOriginAuthFormPost(
        { APP_ORIGIN: "https://0509.io" },
        new Request("https://0509.io/auth/login", {
          method: "POST",
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toBe(false);
    expect(isSameOriginAuthFormPost({ APP_ORIGIN: "https://0509.io" }, new Request("https://0509.io/auth/login"))).toBe(
      false,
    );
  });

  it("removes expired auth exchange rows before creating a new request", async () => {
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind() {
            return {
              async run() {
                return {};
              },
            };
          },
        };
      },
    };

    await createStytchAuthRequest(
      { DB: db as unknown as D1Database },
      {
        email: "asha@agency.com",
        mode: "login",
        redirectTo: "/app",
      },
    );

    expect(statements[0]).toContain("DELETE FROM stytch_auth_request WHERE expires_at <= ?");
    expect(statements[1]).toContain("INSERT INTO stytch_auth_request");
  });

  it("keeps app redirect targets out of Stytch magic link URLs", async () => {
    const sentBodies: Array<{ discovery_redirect_url?: unknown }> = [];
    vi.stubGlobal("fetch", async (_url: string | URL | Request, init?: RequestInit) => {
      sentBodies.push(JSON.parse(String(init?.body ?? "{}")) as { discovery_redirect_url?: unknown });
      return new Response(JSON.stringify({ request_id: "request-1" }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    await sendDiscoveryEmail(
      {
        APP_ORIGIN: "https://0509.io",
        STYTCH_API_BASE_URL: "https://api.stytch.test",
        STYTCH_PROJECT_ID: "project-test",
        STYTCH_SECRET: "secret-test",
      },
      new Request("https://0509.io/auth/login"),
      {
        email: "asha@agency.com",
        mode: "login",
        state: "state-123",
      },
    );

    const redirectUrl = new URL(String(sentBodies[0]?.discovery_redirect_url ?? ""));
    expect(redirectUrl.pathname).toBe("/auth/stytch/callback");
    expect(redirectUrl.search).toBe("");
  });

  it("can add PKCE to Stytch magic links without exposing the verifier", async () => {
    const sentBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (_url: string | URL | Request, init?: RequestInit) => {
      sentBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({ request_id: "request-1" }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const pkce = await createStytchPkcePair();
    await sendDiscoveryEmail(
      {
        APP_ORIGIN: "https://0509.io",
        STYTCH_API_BASE_URL: "https://api.stytch.test",
        STYTCH_PROJECT_ID: "project-test",
        STYTCH_SECRET: "secret-test",
      },
      new Request("https://0509.io/auth/login"),
      {
        email: "asha@agency.com",
        mode: "login",
        pkceCodeChallenge: pkce.challenge,
        state: "state-123",
      },
    );

    const redirectUrl = new URL(String(sentBodies[0]?.discovery_redirect_url ?? ""));
    expect(redirectUrl.search).toBe("");
    expect(sentBodies[0]?.pkce_code_challenge).toBe(pkce.challenge);
    expect(JSON.stringify(sentBodies[0])).not.toContain(pkce.verifier);
  });

  it("keeps email magic links on the cross-browser confirmation path", async () => {
    const sentBodies: Array<Record<string, unknown>> = [];
    const db = {
      prepare() {
        return {
          bind() {
            return {
              async run() {
                return {};
              },
            };
          },
        };
      },
    };
    vi.stubGlobal("fetch", async (_url: string | URL | Request, init?: RequestInit) => {
      sentBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({ request_id: "request-1" }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      await loginAction({
        context: {
          cloudflare: {
            env: stytchActionTestEnv(db),
          },
        },
        params: {},
        request: authFormPost("https://0509.io/auth/login", {
          email: "asha@agency.com",
          redirectTo: "/app",
        }),
      } as never);
      throw new Error("Expected login action to redirect after sending a magic link.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toContain("/auth/login?sent=1");
      expect(response.headers.get("Set-Cookie")).toContain("f9_stytch_state=");
      expect(response.headers.get("Set-Cookie")).not.toContain("f9_stytch_pkce=");
    }

    const redirectUrl = new URL(String(sentBodies[0]?.discovery_redirect_url ?? ""));
    expect(redirectUrl.searchParams.has("pkce")).toBe(false);
    expect(sentBodies[0]?.pkce_code_challenge).toBeUndefined();
  });

  it("builds server-owned Stytch OAuth discovery starts for Google and Microsoft", () => {
    const url = new URL(
      stytchOAuthDiscoveryStartUrl(
        {
          APP_ORIGIN: "https://0509.io",
          STYTCH_API_BASE_URL: "https://api.stytch.test",
          STYTCH_PROJECT_ID: "project-test",
          STYTCH_PUBLIC_TOKEN: "public-token-test",
          STYTCH_SECRET: "secret-test",
        },
        {
          loginHint: "asha@agency.com",
          mode: "login",
          pkceCodeChallenge: "challenge-123",
          provider: "google",
          state: "state-123",
        },
      ),
    );

    expect(url.origin).toBe("https://api.stytch.test");
    expect(url.pathname).toBe("/v1/b2b/public/oauth/google/discovery/start");
    expect(url.searchParams.get("public_token")).toBe("public-token-test");
    expect(url.searchParams.get("pkce_code_challenge")).toBe("challenge-123");
    expect(url.searchParams.get("provider_login_hint")).toBe("asha@agency.com");

    const redirectUrl = new URL(String(url.searchParams.get("discovery_redirect_url")));
    expect(redirectUrl.origin).toBe("https://0509.io");
    expect(redirectUrl.pathname).toBe("/auth/stytch/callback");
    expect(redirectUrl.search).toBe("");
  });

  it("keeps Stytch OAuth disabled until provider configs are verified", () => {
    const baseEnv = {
      APP_ORIGIN: "https://0509.io",
      STYTCH_PROJECT_ID: "project-test",
      STYTCH_PUBLIC_TOKEN: "public-token-test",
      STYTCH_SECRET: "secret-test",
    };

    expect(isStytchOAuthConfigured(baseEnv)).toBe(false);
    expect(
      isStytchOAuthConfigured({
        ...baseEnv,
        STYTCH_OAUTH_PROVIDERS_ENABLED: "true",
      }),
    ).toBe(true);
  });

  it("starts Stytch OAuth from a same-origin server action with HTTP-only verifier cookies", async () => {
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind() {
            return {
              async run() {
                return {};
              },
            };
          },
        };
      },
    };

    try {
      await oauthAction({
        context: {
          cloudflare: {
            env: {
              ...stytchActionTestEnv(db),
              STYTCH_OAUTH_PROVIDERS_ENABLED: "true",
              STYTCH_PUBLIC_TOKEN: "public-token-test",
            },
          },
        },
        params: {},
        request: new Request("https://preview.0509.dev/auth/stytch/oauth", {
          method: "POST",
          body: new URLSearchParams({
            email: "asha@agency.com",
            mode: "login",
            provider: "microsoft",
            redirectTo: "/app",
          }),
          headers: { origin: "https://preview.0509.dev" },
        }),
      } as never);
      throw new Error("Expected OAuth action to redirect to Stytch.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("Location") ?? "");
      expect(location.pathname).toBe("/v1/b2b/public/oauth/microsoft/discovery/start");
      expect(location.searchParams.get("public_token")).toBe("public-token-test");
      expect(location.searchParams.has("pkce_code_challenge")).toBe(true);
      const redirectUrl = new URL(String(location.searchParams.get("discovery_redirect_url")));
      expect(redirectUrl.origin).toBe("https://preview.0509.dev");
      expect(redirectUrl.pathname).toBe("/auth/stytch/callback");
      expect(redirectUrl.search).toBe("");
      expect(response.headers.get("Set-Cookie")).toContain("f9_stytch_state=");
      expect(response.headers.get("Set-Cookie")).toContain("f9_stytch_pkce=");
      expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    }
    expect(statements.some((sql) => sql.includes("INSERT INTO stytch_auth_request"))).toBe(true);
  });

  it("requires an explicit HTTPS app origin before sending Stytch magic links", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const env = {
      STYTCH_API_BASE_URL: "https://api.stytch.test",
      STYTCH_PROJECT_ID: "project-test",
      STYTCH_SECRET: "secret-test",
    };

    expect(isStytchConfigured(env)).toBe(false);
    await expect(
      sendDiscoveryEmail(
        env,
        new Request("https://0509.io/auth/login", {
          headers: {
            forwarded: "proto=https;host=attacker.example",
            "x-forwarded-host": "attacker.example",
          },
        }),
        {
          email: "asha@agency.com",
          mode: "login",
          state: "state-123",
        },
      ),
    ).rejects.toThrow("APP_ORIGIN must be configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("names each allowed Stytch workspace creation path", () => {
    expect(
      stytchWorkspaceCreationReason({
        mode: "login",
        organizationName: null,
        redirectTo: "/app",
      }),
    ).toBeNull();
    expect(
      stytchWorkspaceCreationReason({
        mode: "signup",
        organizationName: "Agency",
        redirectTo: "/app/onboard",
      }),
    ).toBe("signup");
    expect(
      stytchWorkspaceCreationReason({
        mode: "login",
        organizationName: null,
        redirectTo: "/team/accept?token=invite-1",
      }),
    ).toBe("team_invite");
    expect(
      stytchWorkspaceCreationReason(
        {
          mode: "login",
          organizationName: null,
          redirectTo: "/app",
        },
        { hasExistingLocalUser: true },
      ),
    ).toBe("local_user_migration");
  });

  it("rejects cross-site callback form posts before authenticating magic links", async () => {
    const request = new Request("https://0509.io/auth/stytch/callback", {
      method: "POST",
      body: new URLSearchParams({
        mode: "login",
        state: "state-123",
        token: "token-123",
      }),
      headers: { origin: "https://attacker.example" },
    });

    try {
      await callbackAction({
        context: {
          cloudflare: {
            env: { APP_ORIGIN: "https://0509.io" },
          },
        },
        params: {},
        request,
      } as never);
      throw new Error("Expected callback action to reject the request.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(403);
    }
  });

  it("fails closed when a PKCE callback arrives without the same-browser verifier", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first<T>() {
                expect(sql).toContain("FROM stytch_auth_request");
                return {
                  state: "state-1",
                  auth_method: "oauth",
                  email: "asha@agency.com",
                  mode: "login",
                  name: null,
                  organization_name: null,
                  redirect_to: "/app",
                  intermediate_session_token: null,
                  confirmation_secret: null,
                  confirmation_nonce: null,
                  expires_at: "2099-01-01T00:00:00.000Z",
                } as T;
              },
            };
          },
        };
      },
    };

    try {
      await callbackLoader({
        context: {
          cloudflare: {
            env: stytchActionTestEnv(db),
          },
        },
        params: {},
        request: new Request(
          "https://0509.io/auth/stytch/callback?stytch_token_type=discovery_oauth&token=token-1",
          {
            headers: { cookie: "f9_stytch_state=state-1" },
          },
        ),
      } as never);
      throw new Error("Expected PKCE callback to fail closed.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
      expect((error as Response).headers.get("Location")).toBe("/auth/login?error=callback_failed");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects magic-link callbacks for pending OAuth requests before storing tokens", async () => {
    const fetchSpy = vi.fn();
    const updates: string[] = [];
    vi.stubGlobal("fetch", fetchSpy);
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first<T>() {
                expect(sql).toContain("FROM stytch_auth_request");
                return {
                  state: "state-1",
                  auth_method: "oauth",
                  email: "",
                  mode: "login",
                  name: null,
                  organization_name: null,
                  redirect_to: "/app",
                  intermediate_session_token: null,
                  confirmation_secret: null,
                  confirmation_nonce: null,
                  expires_at: "2099-01-01T00:00:00.000Z",
                } as T;
              },
              async run() {
                updates.push(sql);
                return {};
              },
            };
          },
        };
      },
    };

    try {
      await callbackLoader({
        context: {
          cloudflare: {
            env: stytchActionTestEnv(db),
          },
        },
        params: {},
        request: new Request(
          "https://0509.io/auth/stytch/callback?discovery_magic_links_token=token-1",
          {
            headers: { cookie: "f9_stytch_state=state-1" },
          },
        ),
      } as never);
      throw new Error("Expected mismatched callback method to fail closed.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
      expect((error as Response).headers.get("Location")).toBe("/auth/login?error=callback_failed");
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("rejects cross-browser magic-link GETs before authenticating tokens", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      await callbackLoader({
        context: {
          cloudflare: {
            env: stytchActionTestEnv({}),
          },
        },
        params: {},
        request: new Request(
          "https://0509.io/auth/stytch/callback?discovery_magic_links_token=token-1",
        ),
      } as never);
      throw new Error("Expected cross-browser callback to fail closed.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/auth/login?error=callback_failed");
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not authenticate same-browser magic-link GETs before confirmation", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first<T>() {
                return {
                  state: "state-1",
                  auth_method: "magic_link",
                  email: "asha@agency.com",
                  mode: "login",
                  name: null,
                  organization_name: null,
                  redirect_to: "/app",
                  intermediate_session_token: null,
                  confirmation_secret: null,
                  confirmation_nonce: null,
                  expires_at: "2099-01-01T00:00:00.000Z",
                } as T;
              },
              async run() {
                return {};
              },
            };
          },
        };
      },
    };

    try {
      await callbackLoader({
        context: {
          cloudflare: {
            env: stytchActionTestEnv(db),
          },
        },
        params: {},
        request: new Request(
          "https://0509.io/auth/stytch/callback?discovery_magic_links_token=token-1",
          {
            headers: { cookie: "f9_stytch_state=state-1" },
          },
        ),
      } as never);
      throw new Error("Expected same-browser callback to redirect to confirmation.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).headers.get("Location")).toBe("/auth/stytch/confirm?state=state-1");
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("turns Stytch login email send failures into retryable auth errors", async () => {
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind() {
            return {
              async run() {
                return {};
              },
            };
          },
        };
      },
    };
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({ error_message: "Stytch is unavailable" }), {
        headers: { "Content-Type": "application/json" },
        status: 503,
      });
    });

    try {
      await loginAction({
        context: {
          cloudflare: {
            env: stytchActionTestEnv(db),
          },
        },
        params: {},
        request: authFormPost("https://0509.io/auth/login", {
          email: "asha@agency.com",
          redirectTo: "/app",
        }),
      } as never);
      throw new Error("Expected login action to redirect with send failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
      expect((error as Response).headers.get("Location")).toBe("/auth/login?error=send_failed");
      expect((error as Response).headers.get("Set-Cookie")).toBeNull();
    }

    expect(statements.some((sql) => sql.includes("INSERT INTO stytch_auth_request"))).toBe(true);
    expect(statements.some((sql) => sql.includes("SET consumed_at = ?"))).toBe(true);
  });

  it("turns Stytch signup email send failures into retryable auth errors", async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return {
              async run() {
                return {};
              },
            };
          },
        };
      },
    };
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({ error_message: "Stytch is unavailable" }), {
        headers: { "Content-Type": "application/json" },
        status: 503,
      });
    });

    try {
      await signupAction({
        context: {
          cloudflare: {
            env: stytchActionTestEnv(db),
          },
        },
        params: {},
        request: authFormPost("https://0509.io/auth/signup", {
          email: "asha@agency.com",
          name: "Asha",
          organizationName: "Agency",
          redirectTo: "/app/onboard",
        }),
      } as never);
      throw new Error("Expected signup action to redirect with send failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
      expect((error as Response).headers.get("Location")).toBe("/auth/signup?error=send_failed");
      expect((error as Response).headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("turns expired cross-browser confirmation loads into retryable auth errors", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first<T>() {
                expect(sql).toContain("FROM stytch_auth_request");
                return {
                  state: "state-1",
                  auth_method: "magic_link",
                  email: "asha@agency.com",
                  mode: "login",
                  name: null,
                  organization_name: null,
                  redirect_to: "/app",
                  intermediate_session_token: "expired-intermediate-session",
                  confirmation_secret: "confirm-secret",
                  confirmation_nonce: null,
                  expires_at: "2099-01-01T00:00:00.000Z",
                } as T;
              },
            };
          },
        };
      },
    };
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({ error_message: "intermediate session expired" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      });
    });

    try {
      await confirmLoader({
        context: {
          cloudflare: {
            env: stytchActionTestEnv(db),
          },
        },
        params: {},
        request: new Request("https://0509.io/auth/stytch/confirm?state=state-1", {
          headers: { cookie: "f9_stytch_confirm=confirm-secret" },
        }),
      } as never);
      throw new Error("Expected confirm loader to redirect with callback failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
      expect((error as Response).headers.get("Location")).toBe("/auth/login?error=callback_failed");
    }
  });

  it("requires the rotated confirmation nonce before cross-browser completion", () => {
    const authRequest = {
      confirmationSecret: "secret-1",
      confirmationNonce: "nonce-1",
    } as StytchAuthRequest;

    expect(
      verifyStytchConfirmationSecret(
        new Request("https://0509.io/auth/stytch/confirm", {
          headers: { cookie: "f9_stytch_confirm=secret-1" },
        }),
        authRequest,
      ),
    ).toBe(true);
    expect(verifyStytchConfirmationSecret(new Request("https://0509.io/auth/stytch/confirm"), authRequest)).toBe(false);
    expect(verifyStytchConfirmationNonce(authRequest, "nonce-1")).toBe(true);
    expect(verifyStytchConfirmationNonce(authRequest, "wrong")).toBe(false);
    expect(verifyStytchConfirmationNonce({ confirmationNonce: null } as StytchAuthRequest, "nonce-1")).toBe(false);
    expect(stytchConfirmationCookie(new Request("https://0509.io"), "secret-1")).toContain(
      "f9_stytch_confirm=secret-1",
    );
  });

  it("does not revoke sessions from a GET logout request", async () => {
    try {
      await logoutLoader();
      throw new Error("Expected logout loader to redirect.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
      expect((error as Response).headers.get("Location")).toBe("/");
      expect((error as Response).headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("does not clear the Stytch session from a cross-site logout POST", async () => {
    const request = new Request("https://0509.io/auth/logout", {
      method: "POST",
      headers: {
        cookie: "f9_stytch_session=session-123",
        origin: "https://attacker.example",
      },
    });

    try {
      await logoutAction({
        context: {
          cloudflare: {
            env: { APP_ORIGIN: "https://0509.io" },
          },
        },
        params: {},
        request,
      } as never);
      throw new Error("Expected logout action to reject the request.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(403);
      expect((error as Response).headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("rejects a Stytch email collision with another local account", async () => {
    const calls: Array<{ sql: string; bindings: unknown[] }> = [];
    const identityUser = {
      id: "user-existing",
      name: "Asha",
      email: "old@agency.com",
      image: null,
      onboardedAt: "2026-06-01T00:00:00.000Z",
    };
    const differentEmailOwner = {
      id: "user-other",
      name: "Other",
      email: "new@agency.com",
      image: null,
      onboardedAt: null,
    };
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            calls.push({ sql, bindings });
            return {
              async all<T>() {
                if (sql.includes("FROM stytch_identity")) {
                  return { results: [identityUser] as T[] };
                }
                if (sql.includes("FROM user") && sql.includes("WHERE email")) {
                  return { results: [differentEmailOwner] as T[] };
                }
                return { results: [] as T[] };
              },
              async run() {
                return {};
              },
            };
          },
        };
      },
    };

    await expect(
      upsertStytchAuthenticatedUser(
        { DB: db as unknown as D1Database },
        {
          email: "new@agency.com",
          name: "Asha New",
          stytchMemberId: "member-1",
          stytchOrganizationId: "org-1",
          stytchOrganizationName: "Agency",
          stytchOrganizationSlug: "agency",
        },
      ),
    ).rejects.toThrow("already linked to another local account");

    expect(calls.some((call) => call.sql.includes("UPDATE user"))).toBe(false);
  });

  it("rejects a second Stytch organization for an email already linked locally", async () => {
    const existingEmailOwner = {
      id: "user-existing",
      name: "Asha",
      email: "asha@agency.com",
      image: null,
      onboardedAt: null,
    };
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async all<T>() {
                if (sql.includes("FROM stytch_identity") && sql.includes("JOIN user")) {
                  return { results: [] as T[] };
                }
                if (sql.includes("FROM user") && sql.includes("WHERE email")) {
                  return { results: [existingEmailOwner] as T[] };
                }
                if (sql.includes("FROM stytch_identity") && sql.includes("WHERE user_id")) {
                  return {
                    results: [
                      {
                        stytchOrganizationId: "org-old",
                        stytchMemberId: "member-old",
                      },
                    ] as T[],
                  };
                }
                return { results: [] as T[] };
              },
              async run() {
                return {};
              },
            };
          },
        };
      },
    };

    await expect(
      upsertStytchAuthenticatedUser(
        { DB: db as unknown as D1Database },
        {
          email: "asha@agency.com",
          name: "Asha",
          stytchMemberId: "member-new",
          stytchOrganizationId: "org-new",
          stytchOrganizationName: "New org",
          stytchOrganizationSlug: "new-org",
        },
      ),
    ).rejects.toThrow("already linked to another Stytch organization");
  });

  it("updates the identity mapping when a member is recreated in the same Stytch organization", async () => {
    const calls: Array<{ sql: string; bindings: unknown[] }> = [];
    const existingEmailOwner = {
      id: "user-existing",
      name: "Asha",
      email: "asha@agency.com",
      image: null,
      onboardedAt: null,
    };
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            calls.push({ sql, bindings });
            return {
              async all<T>() {
                if (sql.includes("FROM stytch_identity") && sql.includes("JOIN user")) {
                  return { results: [] as T[] };
                }
                if (sql.includes("FROM user") && sql.includes("WHERE email")) {
                  return { results: [existingEmailOwner] as T[] };
                }
                if (sql.includes("FROM stytch_identity") && sql.includes("WHERE user_id")) {
                  return {
                    results: [
                      {
                        stytchOrganizationId: "org-1",
                        stytchMemberId: "member-old",
                      },
                    ] as T[],
                  };
                }
                return { results: [] as T[] };
              },
              async run() {
                return {};
              },
            };
          },
        };
      },
    };

    const user = await upsertStytchAuthenticatedUser(
      { DB: db as unknown as D1Database },
      {
        email: "asha@agency.com",
        name: "Asha",
        stytchMemberId: "member-new",
        stytchOrganizationId: "org-1",
        stytchOrganizationName: "Agency",
        stytchOrganizationSlug: "agency",
      },
    );

    const identityUpdate = calls.find((call) =>
      call.sql.includes("UPDATE stytch_identity") && call.sql.includes("SET stytch_member_id = ?"),
    );
    const identityUpsert = calls.find((call) => call.sql.includes("INSERT INTO stytch_identity"));
    expect(user.id).toBe("user-existing");
    expect(identityUpdate?.bindings[0]).toBe("member-new");
    expect(identityUpdate?.bindings[4]).toBe("user-existing");
    expect(identityUpsert?.bindings[0]).toBe("user-existing");
    expect(identityUpsert?.bindings[2]).toBe("member-new");
  });
});
