import { describe, expect, it, vi } from "vitest";

const { betterAuth } = vi.hoisted(() => {
  const betterAuth = vi.fn((_options: unknown) => ({ api: {} }));
  return { betterAuth };
});

vi.mock("better-auth", () => ({
  betterAuth: (options: unknown) => betterAuth(options),
}));

vi.mock("better-auth/plugins", () => ({ magicLink: () => ({}) }));
vi.mock("@better-auth/api-key", () => ({ apiKey: () => ({}) }));
vi.mock("@better-auth/passkey", () => ({ passkey: () => ({}) }));
vi.mock("../app/lib/workspace.server", () => ({
  ensureWorkspaceForSignIn: async () => undefined,
}));

import { createAuth, hasSessionCookie } from "../app/lib/auth.server";

describe("hasSessionCookie", () => {
  it("matches the cookie the auth module issues, including the secure prefix", () => {
    createAuth({
      DB: {} as never,
      EMAIL: { send: async () => undefined },
      SIGN_IN_EMAIL_LIMIT: { limit: async () => ({ success: true }) },
      SIGN_IN_IP_LIMIT: { limit: async () => ({ success: true }) },
    });
    expect(betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({ advanced: expect.objectContaining({ cookiePrefix: "better-auth" }) }),
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
});
