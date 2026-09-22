import { describe, expect, it, vi } from "vitest";

const getSession = vi.fn(async () => ({ session: { id: "s" }, user: { email: "a@0509.io" } }));

vi.mock("cloudflare:workers", () => ({ env: {} }));

vi.mock("better-auth", () => ({
  betterAuth: () => ({ api: { getSession } }),
}));

vi.mock("better-auth/plugins", () => ({ magicLink: () => ({}) }));
vi.mock("@better-auth/api-key", () => ({ apiKey: () => ({}) }));
vi.mock("@better-auth/passkey", () => ({ passkey: () => ({}) }));

import { readSession } from "../app/lib/auth.server";
import { requireSession } from "../app/lib/require-session.server";

describe("readSession", () => {
  it("asks auth once per request, including the signed-in gate", async () => {
    getSession.mockClear();
    const request = new Request("https://0509.io/app", {
      headers: { cookie: "better-auth.session_token=present" },
    });
    await readSession(request);
    await expect(requireSession(request)).resolves.toMatchObject({
      user: { email: "a@0509.io" },
    });
    expect(getSession).toHaveBeenCalledOnce();
  });

  it("shares a miss across the gate on the same request", async () => {
    getSession.mockClear();
    getSession.mockResolvedValueOnce(null);
    const request = new Request("https://0509.io/app");
    await readSession(request);
    await expect(requireSession(request)).rejects.toMatchObject({ status: 302 });
    expect(getSession).toHaveBeenCalledOnce();
  });
});
