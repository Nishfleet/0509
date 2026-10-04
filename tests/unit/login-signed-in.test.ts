import { beforeEach, describe, expect, it, vi } from "vitest";

const hasSession = vi.hoisted(() => vi.fn());

vi.mock("cloudflare:workers", () => ({ env: { TURNSTILE_SITE_KEY: "1x00000000000000000000BB" } }));
vi.mock("../../app/lib/auth.server", () => ({ createAuth: () => ({}), createAuthForRequest: () => ({}) }));
vi.mock("../../app/lib/require-session.server", () => ({ hasSession }));

import { loader } from "../../app/routes/login";

function run(path: string) {
  return loader({ request: new Request(`https://0509.io${path}`) } as Parameters<typeof loader>[0]);
}

async function redirectedTo(path: string): Promise<string | null> {
  try {
    await run(path);
    return null;
  } catch (thrown) {
    return thrown instanceof Response ? thrown.headers.get("location") : null;
  }
}

describe("Login for a signed-in customer", () => {
  beforeEach(() => hasSession.mockReset());

  it("sends them to the app", async () => {
    hasSession.mockResolvedValue(true);
    expect(await redirectedTo("/login")).toBe("/app");
  });

  it("keeps a safe next target", async () => {
    hasSession.mockResolvedValue(true);
    expect(await redirectedTo("/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dx")).toBe("/oauth/authorize?client_id=x");
  });

  it("shows the form to a signed-out visitor", async () => {
    hasSession.mockResolvedValue(false);
    expect(await redirectedTo("/login")).toBeNull();
  });

  it("keeps the dead-link message for a signed-in visitor", async () => {
    hasSession.mockResolvedValue(true);
    expect(await redirectedTo("/login?error=EXPIRED_TOKEN")).toBeNull();
  });

  it("keeps the delete progress page", async () => {
    hasSession.mockResolvedValue(true);
    expect(await redirectedTo("/login?deleted=wf-1")).toBeNull();
  });
});
