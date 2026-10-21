import { beforeEach, describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => vi.fn<(request: Request) => Promise<Response>>());

vi.mock("../../app/lib/auth.server", () => ({
  createAuthForRequest: async () => ({ handler }),
}));

import { loader } from "../../app/routes/api.auth.$";

const EVIL = "https://evil.test/";

function run(path: string) {
  return loader({ request: new Request(`https://0509.io${path}`) } as Parameters<typeof loader>[0]);
}

function forbidden(code: string): Response {
  return Response.json({ message: "Invalid callbackURL", code }, { status: 403 });
}

describe("api.auth loader on a tampered sign-in link", () => {
  beforeEach(() => handler.mockReset());

  it("turns a 403 INVALID_CALLBACK_URL on verify into a redirect to the sign-in page", async () => {
    handler.mockResolvedValue(forbidden("INVALID_CALLBACK_URL"));
    const response = await run(`/api/auth/magic-link/verify?token=t&callbackURL=${encodeURIComponent(EVIL)}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login?error=INVALID_TOKEN");
  });

  it("never echoes the rejected url", async () => {
    handler.mockResolvedValue(forbidden("INVALID_CALLBACK_URL"));
    const response = await run(
      `/api/auth/magic-link/verify?token=t&callbackURL=${encodeURIComponent(EVIL)}&errorCallbackURL=${encodeURIComponent(EVIL)}`,
    );
    expect(response.headers.get("location")).not.toContain("evil");
    expect(await response.text()).not.toContain("evil");
  });

  it("covers a tampered errorCallbackURL the same way", async () => {
    handler.mockResolvedValue(forbidden("INVALID_ERROR_CALLBACK_URL"));
    const response = await run("/api/auth/magic-link/verify?token=t&errorCallbackURL=https%3A%2F%2Fevil.test%2F");
    expect(response.headers.get("location")).toBe("/login?error=INVALID_TOKEN");
  });

  it("leaves every other answer from the handler alone", async () => {
    const other = forbidden("INVALID_ORIGIN");
    handler.mockResolvedValue(other);
    expect(await run("/api/auth/magic-link/verify?token=t")).toBe(other);

    const elsewhere = forbidden("INVALID_CALLBACK_URL");
    handler.mockResolvedValue(elsewhere);
    expect(await run("/api/auth/passkey/verify")).toBe(elsewhere);

    const ok = new Response(null, { status: 302, headers: { location: "/app" } });
    handler.mockResolvedValue(ok);
    expect(await run("/api/auth/magic-link/verify?token=t")).toBe(ok);
  });

  it("keeps a body that is not json as the handler sent it", async () => {
    const plain = new Response("nope", { status: 403 });
    handler.mockResolvedValue(plain);
    expect(await run("/api/auth/magic-link/verify?token=t")).toBe(plain);
  });
});
