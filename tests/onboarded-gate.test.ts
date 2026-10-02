import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { onboardedContext, requireOnboarded } from "../app/lib/require-onboarded.server";
import routes from "../app/routes";
import AppLayout, { middleware } from "../app/routes/app-layout";
import AppSettingsLayout, * as appSettingsLayout from "../app/routes/app-settings-layout";

vi.mock("../app/lib/data/workspace.server", () => ({
  readWorkspaceIdForOwner: async () => "ws-1",
}));

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
        await requireOnboarded({
          request: new Request("https://0509.io/app/alerts"),
          context: new RouterContextProvider(),
        });
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
    const context = new RouterContextProvider();
    await expect(
      requireOnboarded({ request: new Request("https://0509.io/app/alerts"), context }),
    ).resolves.toBeUndefined();
    expect(context.get(onboardedContext)).toEqual({ session: { user: { id: "user-1" } }, workspaceId: "ws-1" });
  });
});

const SETTINGS_PATHS = [
  "app/settings",
  "app/settings/agents",
  "app/settings/billing",
  "app/settings/brief-pause",
  "app/settings/export",
];

const childPathsOf = (layoutFile: string) =>
  routes
    .filter((entry) => entry.file === layoutFile)
    .flatMap((entry) => entry.children ?? [])
    .map((child) => child.path);

describe("app layout middleware", () => {
  it("gates the /app routes under app-layout with requireOnboarded", () => {
    expect(middleware).toEqual([requireOnboarded]);
    expect(childPathsOf("routes/app-layout.tsx")).toEqual([
      "app",
      "app/competitors",
      "app/competitors/:entityId",
      "app/upgrade",
      "app/tester",
      "app/alerts",
      "app/brief/:digestId?",
    ]);
  });

  it("leaves the /app/settings routes ungated, so account delete is always reachable", () => {
    expect(childPathsOf("routes/app-settings-layout.tsx")).toEqual(SETTINGS_PATHS);
    expect("middleware" in appSettingsLayout).toBe(false);
    expect(AppSettingsLayout().type).toBe(AppLayout().type);
  });
});
