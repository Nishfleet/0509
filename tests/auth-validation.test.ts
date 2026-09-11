import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function context(env = {}) {
  return { cloudflare: { env } };
}

describe("auth form server validation", () => {
  it("starts a signup from email alone — no name required", async () => {
    const sendBetterAuthMagicLink = vi.fn();
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: vi.fn(() => true),
      isSameOriginAuthFormPost: vi.fn(() => true),
      sendBetterAuthMagicLink,
    }));
    vi.doMock("~/lib/funnel-measurement.server", () => ({
      emitFunnelSignupStartFromAllowlistedSource: vi.fn(),
    }));
    vi.doMock("~/lib/signup-source", () => ({
      rememberAllowlistedSignupSource: vi.fn(() => null),
      signupSourceCookieHeader: vi.fn(() => ""),
      signupSourceFromRequest: vi.fn(() => null),
    }));

    const { action } = await import("~/routes/auth.signup");
    const request = new Request("https://0509.io/auth/signup", {
      method: "POST",
      body: new URLSearchParams({
        email: "owner@example.com",
        redirectTo: "/search?website=nykaa.com",
      }),
    });

    // The signup action completes the email-send path and redirects to the
    // link-sent state even with no name at all.
    await expect(
      action({ context: context(), request } as never),
    ).rejects.toMatchObject({ status: 302 });
    expect(sendBetterAuthMagicLink).toHaveBeenCalledTimes(1);
    expect(sendBetterAuthMagicLink).toHaveBeenCalledWith({}, request, {
      email: "owner@example.com",
      mode: "signup",
      name: "",
      redirectTo: "/search?website=nykaa.com",
    });
  });

  it("preserves signup values after the email provider fails", async () => {
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: vi.fn(() => true),
      isSameOriginAuthFormPost: vi.fn(() => true),
      sendBetterAuthMagicLink: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    }));

    const { action } = await import("~/routes/auth.signup");
    const request = new Request("https://0509.io/auth/signup", {
      method: "POST",
      body: new URLSearchParams({
        name: "Nish",
        email: "owner@example.com",
        redirectTo: "/app/onboard?website=nykaa.com",
      }),
    });

    await expect(action({ context: context(), request } as never)).resolves.toEqual({
      ok: false,
      error: "We couldn't send the setup link. Try again in a minute.",
      email: "owner@example.com",
      name: "Nish",
      redirectTo: "/app/onboard?website=nykaa.com",
    });
  });

  it("rejects malformed login email before calling Better Auth", async () => {
    const sendBetterAuthMagicLink = vi.fn();
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/better-auth.server", () => ({
      BetterAuthUnknownUserError: class extends Error {},
      isBetterAuthConfigured: vi.fn(() => true),
      isSameOriginAuthFormPost: vi.fn(() => true),
      sendBetterAuthMagicLink,
    }));

    const { action } = await import("~/routes/auth.login");
    const request = new Request("https://0509.io/auth/login", {
      method: "POST",
      body: new URLSearchParams({ email: "not-an-email", redirectTo: "/app" }),
    });

    try {
      await action({ context: context(), request } as never);
      throw new Error("Expected login validation redirect");
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toContain("error=email_invalid");
    }
    expect(sendBetterAuthMagicLink).not.toHaveBeenCalled();
  });
});
