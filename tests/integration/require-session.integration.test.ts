import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());

vi.mock("../../app/lib/auth.server", () => ({ createAuth: () => ({ api: { getSession } }) }));

import { requireFreshSession, requireSession } from "../../app/lib/require-session.server";

const request = new Request("https://0509.io/app/upgrade", { headers: { cookie: "better-auth.session_token=x" } });

describe("requireSession and requireFreshSession", () => {
  beforeEach(() => {
    getSession.mockReset();
    getSession.mockResolvedValue({ user: { id: "user-1", email: "a@0509.io" } });
  });

  it("lets a plain page read use the cookie cache", async () => {
    await requireSession(request);
    expect(getSession).toHaveBeenCalledWith(expect.objectContaining({ query: { disableCookieCache: false } }));
  });

  it("makes money and access routes ask the database", async () => {
    await requireFreshSession(request);
    expect(getSession).toHaveBeenCalledWith(expect.objectContaining({ query: { disableCookieCache: true } }));
  });

  it("sends a missing session to the login page", async () => {
    getSession.mockResolvedValue(null);
    await expect(requireFreshSession(request, "/app/upgrade")).rejects.toMatchObject({ status: 302 });
  });
});
