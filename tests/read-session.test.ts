import { describe, expect, it, vi } from "vitest";

const { betterAuth, passkey } = vi.hoisted(() => {
  const betterAuth = vi.fn((_options: unknown) => ({ api: {} }));
  const passkey = vi.fn((_options?: unknown) => ({}));
  return { betterAuth, passkey };
});

vi.mock("better-auth", () => ({
  betterAuth: (options: unknown) => betterAuth(options),
}));

vi.mock("better-auth/plugins", () => ({ magicLink: () => ({}) }));
vi.mock("@better-auth/api-key", () => ({ apiKey: () => ({}) }));
vi.mock("@better-auth/passkey", () => ({
  passkey: (options?: unknown) => passkey(options),
}));
vi.mock("../app/lib/workspace.server", () => ({
  ensureWorkspaceForSignIn: async () => undefined,
}));

import { createAuth, hasSessionCookie } from "../app/lib/auth.server";

describe("hasSessionCookie", () => {
  it("matches the cookie the auth module issues, including the secure prefix", () => {
    createAuth({
      DB: {} as never,
      EMAIL: { send: async () => undefined },
    });
    expect(betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({ advanced: { cookiePrefix: "better-auth" } }),
    );
    expect(hasSessionCookie(new Request("https://0509.io/missing"))).toBe(false);
    expect(
      hasSessionCookie(
        new Request("https://0509.io/missing", {
          headers: { cookie: "better-auth.session_token=abc" },
        }),
      ),
    ).toBe(true);
    expect(
      hasSessionCookie(
        new Request("https://0509.io/missing", {
          headers: { cookie: "theme=dark; __Secure-better-auth.session_token=abc" },
        }),
      ),
    ).toBe(true);
    expect(
      hasSessionCookie(
        new Request("https://0509.io/missing", {
          headers: { cookie: "better-auth.session_data=abc" },
        }),
      ),
    ).toBe(false);
    expect(
      hasSessionCookie(
        new Request("https://0509.io/missing", {
          headers: { cookie: "not-the-session_token=abc" },
        }),
      ),
    ).toBe(false);
  });

  it("uses the production origin when BETTER_AUTH_URL is set, and only preview hosts when it is not", () => {
    createAuth({
      DB: {} as never,
      EMAIL: { send: async () => undefined },
      BETTER_AUTH_URL: "https://0509.io",
    });
    expect(betterAuth).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseURL: "https://0509.io" }),
    );
    expect(passkey).toHaveBeenLastCalledWith({ rpID: "0509.io" });

    createAuth({
      DB: {} as never,
      EMAIL: { send: async () => undefined },
    });
    expect(betterAuth).toHaveBeenLastCalledWith(
      expect.objectContaining({
        baseURL: {
          allowedHosts: ["*-0509.nishant345.workers.dev"],
          protocol: "https",
        },
      }),
    );
    expect(passkey).toHaveBeenLastCalledWith({ rpID: "nishant345.workers.dev" });
    const preview = betterAuth.mock.calls.at(-1)?.[0] as { baseURL: { fallback?: string } };
    expect(preview.baseURL.fallback).toBeUndefined();
  });
});
