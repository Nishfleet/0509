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
      brandWebsite: "",
    });
  });

  it("seeds top-3 suggestions from the optional Your-website field into a signed handoff on the checklist redirect (issue #2414)", async () => {
    const env = { BETTER_AUTH_SECRET: "test-secret" };
    const sendBetterAuthMagicLink = vi.fn();
    const seedAutoCompetitors = vi.fn().mockResolvedValue([
      { advertiser: "Rothy's", advertiserPageId: "page-1", registrableDomain: "rothys.com", overlapScore: 9, provenance: "p", why: "w", source: "meta_ad_library", countries: ["United States"], matchedKeywords: [] },
      { advertiser: "Vivaia", advertiserPageId: null, registrableDomain: "vivaia.com", overlapScore: 8, provenance: "p", why: "w", source: "meta_ad_library", countries: [], matchedKeywords: [] },
      { advertiser: "Allbirds", advertiserPageId: null, registrableDomain: "allbirds.com", overlapScore: 7, provenance: "p", why: "w", source: "meta_ad_library", countries: [], matchedKeywords: [] },
      { advertiser: "Fourth", advertiserPageId: null, registrableDomain: "fourth.com", overlapScore: 6, provenance: "p", why: "w", source: "meta_ad_library", countries: [], matchedKeywords: [] },
    ]);
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
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
    vi.doMock("~/lib/auto-competitor-seed.server", () => ({ seedAutoCompetitors }));

    const { action } = await import("~/routes/auth.signup");
    const request = new Request("https://0509.io/auth/signup", {
      method: "POST",
      body: new URLSearchParams({
        email: "owner@example.com",
        brandWebsite: "mybrand.com",
        redirectTo: "/app#setup-checklist",
      }),
    });

    let response: Response | null = null;
    try {
      await action({ context: context(env), request } as never);
      throw new Error("Expected sent redirect");
    } catch (error) {
      response = error as Response;
    }

    expect(response?.status).toBe(302);
    // The seed probe ran as the anonymous-preview sentinel against the brand's
    // registrable domain — the same cache-only path /search uses.
    expect(seedAutoCompetitors).toHaveBeenCalledTimes(1);
    expect(seedAutoCompetitors).toHaveBeenCalledWith(env, expect.objectContaining({
      domain: "mybrand.com",
      userId: "anonymous-search-preview",
    }));

    // The magic link carries the signed #2174 handoff; no `pick` param means
    // every seeded row renders pre-confirmed in the setup checklist.
    const magicRedirectTo = sendBetterAuthMagicLink.mock.calls[0]?.[2]?.redirectTo as string;
    expect(magicRedirectTo).toMatch(/^\/app\?handoff=[^#]+#setup-checklist$/);
    const token = new URL(magicRedirectTo, "https://0509.io").searchParams.get("handoff");
    const { verifyCompetitorHandoff } = await import("~/lib/competitor-handoff.server");
    const verified = await verifyCompetitorHandoff(env as never, token ?? "");
    expect(verified).toMatchObject({ ok: true });
    if (verified.ok) {
      expect(verified.payload.domain).toBe("mybrand.com");
      // Top 3 only — the fourth seeded candidate never reaches the checklist.
      expect(verified.payload.candidates.map((c) => c.advertiser)).toEqual([
        "Rothy's",
        "Vivaia",
        "Allbirds",
      ]);
    }

    // The sent state round-trips the raw field value, and the 30-minute
    // cookie rides the redirect so the brand site survives the email hop.
    const location = new URL(response?.headers.get("Location") ?? "", "https://0509.io");
    expect(location.searchParams.get("brandWebsite")).toBe("mybrand.com");
    expect(location.searchParams.get("redirectTo")).toBe(magicRedirectTo);
    expect(response?.headers.get("Set-Cookie")).toContain("f9_signup_brand_website=mybrand.com");
  });

  it("keeps the default checklist redirect when the seed probe finds nothing — signup is never blocked (issue #2414)", async () => {
    const sendBetterAuthMagicLink = vi.fn();
    const seedAutoCompetitors = vi.fn().mockResolvedValue([]);
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
    vi.doMock("~/lib/auto-competitor-seed.server", () => ({ seedAutoCompetitors }));

    const { action } = await import("~/routes/auth.signup");
    const request = new Request("https://0509.io/auth/signup", {
      method: "POST",
      body: new URLSearchParams({
        email: "owner@example.com",
        brandWebsite: "obscure-brand.example",
        redirectTo: "/app#setup-checklist",
      }),
    });

    let response: Response | null = null;
    try {
      await action({ context: context(), request } as never);
      throw new Error("Expected sent redirect");
    } catch (error) {
      response = error as Response;
    }

    expect(response?.status).toBe(302);
    // No candidates → no handoff token → the plain checklist destination.
    expect(sendBetterAuthMagicLink).toHaveBeenCalledWith({}, request, expect.objectContaining({
      redirectTo: "/app#setup-checklist",
    }));
    // The brand site still rides the cookie — it lands in workspace branding
    // on the first checklist POST even with zero suggestions.
    expect(response?.headers.get("Set-Cookie")).toContain(
      "f9_signup_brand_website=obscure-brand.example",
    );
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
