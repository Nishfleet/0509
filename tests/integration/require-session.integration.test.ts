import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());

vi.mock("../../app/lib/auth.server", () => ({
  createAuth: () => ({ api: { getSession } }),
  hasSessionCookie: (req: Request) => Promise.resolve((req.headers.get("cookie") ?? "").includes("session_token")),
}));

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

  it("says the session ended only when a session cookie was sent", async () => {
    getSession.mockResolvedValue(null);
    const stale: unknown = await requireSession(request).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect((stale as Response).headers.get("location")).toBe("/login?ended=1");
    const bare: unknown = await requireSession(new Request("https://0509.io/app")).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect((bare as Response).headers.get("location")).toBe("/login");
  });

  it("keeps a dead-link error when an old emailed link lands on /app", async () => {
    getSession.mockResolvedValue(null);
    const location = async (path: string, cookie?: string): Promise<string | null> => {
      const thrown: unknown = await requireSession(
        new Request(`https://0509.io${path}`, cookie === undefined ? undefined : { headers: { cookie } }),
      ).then(
        () => null,
        (caught: unknown) => caught,
      );
      return (thrown as Response).headers.get("location");
    };
    expect(await location("/app?error=INVALID_TOKEN")).toBe("/login?error=INVALID_TOKEN");
    expect(await location("/app?error=EXPIRED_TOKEN")).toBe("/login?error=EXPIRED_TOKEN");
    expect(await location("/app?error=INVALID_TOKEN", "better-auth.session_token=x")).toBe(
      "/login?error=INVALID_TOKEN&ended=1",
    );
    expect(await location("/app?error=%3Cb%3Ex%3C%2Fb%3E")).toBe("/login");
  });
});
