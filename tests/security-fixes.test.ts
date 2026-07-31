import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { safeRedirectPath } from "~/lib/safe-redirect";

const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/better-auth.server");
});

describe("safeRedirectPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeRedirectPath("/app/watchlists?tab=all", "/app")).toBe("/app/watchlists?tab=all");
    expect(safeRedirectPath("/search", "/app")).toBe("/search");
  });

  it("rejects absolute, scheme-relative, and backslash-escaped targets", () => {
    expect(safeRedirectPath("https://evil.example/phish", "/app")).toBe("/app");
    expect(safeRedirectPath("http://evil.example", "/app")).toBe("/app");
    expect(safeRedirectPath("//evil.example", "/app")).toBe("/app");
    expect(safeRedirectPath("/\\evil.example", "/app")).toBe("/app");
    expect(safeRedirectPath("javascript:alert(1)", "/app")).toBe("/app");
    expect(safeRedirectPath("", "/app")).toBe("/app");
    expect(safeRedirectPath(null, "/app")).toBe("/app");
  });

  it("is used for email-verification callbackURL sanitization", async () => {
    const sendVerificationEmail = vi.fn().mockResolvedValue({});
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: () => true,
      getBetterAuth: () => ({
        api: { sendVerificationEmail },
      }),
    }));

    const { requestEmailVerification } = await import("~/lib/email-verification.server");
    await requestEmailVerification({ DB: {} } as never, new Request("https://0509.io/"), {
      email: "a@example.com",
      callbackURL: "//evil.example",
    });

    expect(sendVerificationEmail.mock.calls[0]?.[0]?.body?.callbackURL).toBe("/app");
  });
});

describe("auth open-redirect protection", () => {
  it("never redirects an authenticated user off-origin from the login loader", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));

    const { loader } = await import("~/routes/auth.login");

    try {
      await loader({
        context: {},
        request: new Request("https://0509.io/auth/login?redirectTo=https%3A%2F%2Fevil.example%2Fphish"),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).headers.get("Location")).toBe("/app");
    }
  }, 10_000);

  it("passes only sanitized redirect targets to the signup form", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));

    const { loader } = await import("~/routes/auth.signup");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/auth/signup?redirectTo=//evil.example"),
      params: {},
    } as never);

    expect(result).toEqual({ redirectTo: "/app#setup-checklist", prefillEmail: "", linkSent: false });
  });
});

describe("creative-text SSRF protection", () => {
  function mockFetch(handler: (url: string) => Response | Promise<Response>) {
    const calls: string[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith(DNS_JSON_ENDPOINT)) {
        const parsed = new URL(url);
        const type = parsed.searchParams.get("type") === "AAAA" ? "AAAA" : "A";
        const addresses = type === "A" ? ["93.184.216.34"] : [];
        return new Response(
          JSON.stringify({
            Answer: addresses.map((address) => ({ data: address, type: type === "A" ? 1 : 28 })),
          }),
          { status: 200, headers: { "content-type": "application/dns-json" } },
        );
      }
      return handler(url);
    });
    return { spy, calls };
  }

  const ad = {
    advertiser: "Brand",
    body: null,
    previewHeadline: null,
    previewSubhead: null,
    cta: null,
  } as never;

  it("refuses to fetch snapshot URLs that resolve to private address space", async () => {
    const { calls } = mockFetch(() => new Response("<html></html>", { status: 200 }));

    const { captureCreativeText } = await import("~/lib/creative-text.server");
    const result = await captureCreativeText({} as never, "http://169.254.169.254/latest/meta-data", ad);

    expect(result).toMatchObject({
      text: null,
      metadata: { unreadableReasonCode: "creative_snapshot_fetch_failed" },
    });
    expect(calls.filter((url) => url.includes("169.254.169.254"))).toHaveLength(0);
  });

  it("never fetches private image candidates mined from snapshot HTML", async () => {
    const html = `
      <html>
        <head><meta property="og:image" content="http://10.0.0.8/internal.png" /></head>
        <body></body>
      </html>
    `;
    const { calls } = mockFetch((url) =>
      url.includes("snapshot.example")
        ? new Response(html, { status: 200 })
        : new Response("nope", { status: 200 }),
    );

    const { captureCreativeText } = await import("~/lib/creative-text.server");
    const result = await captureCreativeText(
      { AI: { run: vi.fn() } } as never,
      "https://snapshot.example/ad/123",
      ad,
    );

    expect(result).toMatchObject({
      text: null,
      metadata: { unreadableReasonCode: "creative_image_invalid_or_oversized" },
    });
    expect(calls.filter((url) => url.includes("10.0.0.8"))).toHaveLength(0);
  });

  it("stops following redirects that hop to private address space", async () => {
    const { calls } = mockFetch((url) => {
      if (url.includes("snapshot.example")) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://192.168.1.10/admin" },
        });
      }
      return new Response("<html></html>", { status: 200 });
    });

    const { captureCreativeText } = await import("~/lib/creative-text.server");
    const result = await captureCreativeText({} as never, "https://snapshot.example/ad/123", ad);

    expect(result).toMatchObject({
      text: null,
      metadata: { unreadableReasonCode: "creative_snapshot_fetch_failed" },
    });
    expect(calls.filter((url) => url.includes("192.168.1.10"))).toHaveLength(0);
  });
});
