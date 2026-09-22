import { describe, expect, it, vi } from "vitest";

// `cloudflare:workers` is a Workers-runtime module and does not resolve under
// the node project. The gate's logic does not depend on the binding — it asks
// better-auth for a session — so the binding is stubbed and the auth client
// mocked below.
vi.mock("cloudflare:workers", () => ({ env: {} }));

import { requireSession } from "../app/lib/require-session.server";

vi.mock("../app/lib/auth.server", () => ({
  readSession: async (request: Request) =>
    request.headers.get("cookie")?.includes("session") ? { user: { email: "a@0509.io" } } : null,
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
