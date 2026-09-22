import { describe, expect, it, vi } from "vitest";

const getSession = vi.fn(async ({ headers }: { headers: Headers }) => {
  if (headers.get("cookie")?.includes("valid-session")) return { session: { id: "s" } };
  return null;
});

vi.mock("cloudflare:workers", () => ({ env: {} }));

vi.mock("../app/lib/auth.server", () => ({
  createAuth: () => ({ api: { getSession } }),
}));

import { readSignedIn } from "../app/lib/read-signed-in.server";

describe("readSignedIn", () => {
  it("does not ask auth for an anonymous request", async () => {
    getSession.mockClear();
    const request = new Request("https://0509.io/missing");
    await expect(readSignedIn(request)).resolves.toBe(false);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("does not ask auth for an api request even with a session cookie", async () => {
    getSession.mockClear();
    const request = new Request("https://0509.io/api/health", {
      headers: { cookie: "better-auth.session_token=valid-session" },
    });
    await expect(readSignedIn(request)).resolves.toBe(false);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns true when the session cookie checks out", async () => {
    getSession.mockClear();
    const request = new Request("https://0509.io/missing", {
      headers: { cookie: "better-auth.session_token=valid-session" },
    });
    await expect(readSignedIn(request)).resolves.toBe(true);
    expect(getSession).toHaveBeenCalledOnce();
  });

  it("returns false when the cookie does not match a session", async () => {
    getSession.mockClear();
    const request = new Request("https://0509.io/missing", {
      headers: { cookie: "better-auth.session_token=nope" },
    });
    await expect(readSignedIn(request)).resolves.toBe(false);
  });

  it("returns false when the session read throws", async () => {
    getSession.mockRejectedValueOnce(new Error("d1 down"));
    const request = new Request("https://0509.io/missing", {
      headers: { cookie: "better-auth.session_token=valid-session" },
    });
    await expect(readSignedIn(request)).resolves.toBe(false);
  });
});
