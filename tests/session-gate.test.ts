import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

// `cloudflare:workers` is a Workers-runtime module. The node project aliases
// it to tests/workers-env-empty-stub.ts. The gate asks better-auth for a
// session, so only the auth client is mocked below.

import {
  requireSession,
  requireSessionMiddleware,
  sessionContext,
  signOutToLogin,
} from "../app/lib/require-session.server";

const signOut = vi.hoisted(() =>
  vi.fn(async (_env: unknown, _request: Request) => {
    const headers = new Headers();
    headers.append("set-cookie", "better-auth.session_token=; Max-Age=0");
    return headers;
  }),
);

const getSession = vi.hoisted(() =>
  vi.fn(async ({ headers }: { headers: Headers; query?: { disableCookieCache: boolean } }) =>
    headers.get("cookie")?.includes("session") ? { user: { email: "a@0509.io" } } : null,
  ),
);

vi.mock("../app/lib/auth.server", () => ({
  createAuth: (_env: unknown) => ({
    api: {
      getSession,
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
      (thrown: unknown) => (thrown instanceof Response ? `redirect ${thrown.status}` : "other"),
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

describe("requireSessionMiddleware", () => {
  const cookie = { headers: { cookie: "better-auth.session=x" } };

  it("redirects an anonymous request to /login", async () => {
    const context = new RouterContextProvider();
    const thrown = await requireSessionMiddleware({
      request: new Request("https://0509.io/app/settings"),
      context,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toBe("/login");
  });

  it("lets GET use the cookie cache and stores the session", async () => {
    getSession.mockClear();
    const context = new RouterContextProvider();
    await requireSessionMiddleware({
      request: new Request("https://0509.io/app/settings", cookie),
      context,
    });
    expect(context.get(sessionContext)).toMatchObject({ user: { email: "a@0509.io" } });
    expect(getSession).toHaveBeenCalledWith(expect.objectContaining({ query: { disableCookieCache: false } }));
  });

  it("turns the cookie cache off for POST", async () => {
    getSession.mockClear();
    const context = new RouterContextProvider();
    await requireSessionMiddleware({
      request: new Request("https://0509.io/app/settings", { method: "POST", ...cookie }),
      context,
    });
    expect(getSession).toHaveBeenCalledWith(expect.objectContaining({ query: { disableCookieCache: true } }));
  });
});
