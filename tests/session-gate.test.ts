import { describe, expect, it, vi } from "vitest";

// `cloudflare:workers` is a Workers-runtime module and does not resolve under
// the node project. The gate's logic does not depend on the binding — it asks
// better-auth for a session — so the binding is stubbed and the auth client
// mocked below.
vi.mock("cloudflare:workers", () => ({ env: {} }));

import { requireSession } from "../app/lib/require-session.server";

vi.mock("../app/lib/auth.server", () => ({
  createAuth: (_env: unknown) => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) =>
        headers.get("cookie")?.includes("session") ? { user: { email: "a@0509.io" } } : null,
    },
  }),
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

describe("binding access", () => {
  it("no route reaches for context.cloudflare.env", async () => {
    // The RR7 shape. This app provides no getLoadContext, so reaching for it
    // throws at request time and every auth route 500s — which is exactly what
    // shipped in #3919. Bindings come from `cloudflare:workers`.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dirs = ["app/routes", "app/lib"];
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of fs.readdirSync(dir)) {
        const full = path.join(dir, file);
        if (!fs.statSync(full).isFile()) continue;
        const body = fs.readFileSync(full, "utf8");
        // ignore the comment that explains the rule
        const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        if (code.includes("context.cloudflare")) offenders.push(full);
      }
    }
    expect(offenders).toEqual([]);
  });
});
