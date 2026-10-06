import { describe, expect, it, vi } from "vitest";

// `cloudflare:workers` is a Workers-runtime module. The node project aliases
// it to tests/workers-env-empty-stub.ts. The gate asks better-auth for a
// session, so only the auth client is mocked below.

import { requireSession, signOutToLogin } from "../app/lib/require-session.server";

const signOut = vi.hoisted(() =>
  vi.fn(async (_env: unknown, _request: Request) => {
    const headers = new Headers();
    headers.append("set-cookie", "better-auth.session_token=; Max-Age=0");
    return headers;
  }),
);

vi.mock("../app/lib/auth.server", () => ({
  createAuth: (_env: unknown) => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) =>
        headers.get("cookie")?.includes("session") ? { user: { email: "a@0509.io" } } : null,
    },
  }),
  signOut,
}));

const env = {} as never;

describe("requireSession", () => {
  it("redirects to /login when there is no session", async () => {
    const request = new Request("https://0509.io/app");
    await expect(requireSession(request, env)).rejects.toMatchObject({
      status: 302,
      headers: expect.anything(),
    });
  });

  it("returns the session when the cookie is present", async () => {
    const request = new Request("https://0509.io/app", {
      headers: { cookie: "better-auth.session=x" },
    });
    await expect(requireSession(request, env)).resolves.toMatchObject({
      user: { email: "a@0509.io" },
    });
  });

  it("never renders a half-authenticated page: the no-session branch throws", async () => {
    const request = new Request("https://0509.io/app/alerts");
    const outcome = await requireSession(request, env).then(
      () => "returned",
      (thrown) => (thrown instanceof Response ? `redirect ${thrown.status}` : "other"),
    );
    expect(outcome).toBe("redirect 302");
  });
});

describe("signOutToLogin", () => {
  it("clears the session through signOut and redirects to /login", async () => {
    signOut.mockClear();
    const request = new Request("https://0509.io/app/alerts", {
      headers: { cookie: "better-auth.session_token=x" },
    });
    const thrown = await signOutToLogin(request).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toBe("better-auth.session_token=; Max-Age=0");
    expect(signOut).toHaveBeenCalledWith({}, request);
  });
});
