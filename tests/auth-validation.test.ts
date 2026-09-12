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

  it("folds an inline competitor into the default redirect — redirect only, magic link included", async () => {
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
        competitor: "nykaa.com",
        redirectTo: "/app#setup-checklist",
      }),
    });

    let location = "";
    try {
      await action({ context: context(), request } as never);
      throw new Error("Expected sent redirect");
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(302);
      location = response.headers.get("Location") ?? "";
    }
    // The redirect URL carries the competitor so the sent state (and its
    // resend form) round-trips it, exactly like ?competitor= deep links.
    expect(location).toContain("competitor=nykaa.com");
    expect(location).toContain("redirectTo=%2Fapp%3Fwebsite%3Dnykaa.com%23setup-checklist");
    // The magic link already sends the new user to the prefilled checklist.
    expect(sendBetterAuthMagicLink).toHaveBeenCalledWith({}, request, expect.objectContaining({
      redirectTo: "/app?website=nykaa.com#setup-checklist",
    }));
  });

  it("an explicit non-default redirectTo wins over a filled inline competitor", async () => {
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
        competitor: "nykaa.com",
        redirectTo: "/app/onboard?website=nykaa.com",
      }),
    });

    try {
      await action({ context: context(), request } as never);
      throw new Error("Expected sent redirect");
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(302);
      // An explicit redirect target wins — the competitor is round-tripped
      // onto the sent state but never rewrites the caller's redirect.
      expect(response.headers.get("Location")).toContain(
        "redirectTo=%2Fapp%2Fonboard%3Fwebsite%3Dnykaa.com",
      );
      expect(sendBetterAuthMagicLink).toHaveBeenCalledWith({}, request, expect.objectContaining({
        redirectTo: "/app/onboard?website=nykaa.com",
      }));
    }
  });

  it("leaves an empty competitor out of the redirect entirely", async () => {
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
        competitor: "   ",
        redirectTo: "/app#setup-checklist",
      }),
    });

    try {
      await action({ context: context(), request } as never);
      throw new Error("Expected sent redirect");
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toContain(
        "redirectTo=%2Fapp%23setup-checklist",
      );
      expect(response.headers.get("Location")).not.toContain("competitor=");
    }
    expect(sendBetterAuthMagicLink).toHaveBeenCalledWith({}, request, expect.objectContaining({
      redirectTo: "/app#setup-checklist",
    }));
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
      competitor: "",
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
