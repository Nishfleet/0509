import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { requireOnboarded } from "../app/lib/require-onboarded.server";
import { middleware } from "../app/routes/app-layout";

vi.mock("../app/lib/require-session.server", () => ({
  requireSession: async () => ({ user: { id: "user-1" } }),
}));

const landing = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("../app/lib/workspace.server", () => ({
  ONBOARDING_COMPETITORS: "/onboarding/competitors",
  workspaceLandingForRequest: async () => landing.value,
}));

describe("requireOnboarded", () => {
  it.each(["/onboarding", "/onboarding/identity?subject=acme.example", "/onboarding/competitors"])(
    "redirects an unfinished workspace to its resume point %s",
    async (resumePoint) => {
      landing.value = resumePoint;
      let thrown: unknown;
      try {
        await requireOnboarded({ request: new Request("https://0509.io/app/alerts") });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Response);
      const response = thrown as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(resumePoint);
    },
  );

  it("resolves when the workspace has no resume point", async () => {
    landing.value = null;
    await expect(
      requireOnboarded({ request: new Request("https://0509.io/app/alerts") }),
    ).resolves.toBeUndefined();
  });
});

describe("app layout middleware", () => {
  it("is requireOnboarded, so every /app route is gated", () => {
    expect(middleware).toEqual([requireOnboarded]);
  });
});
