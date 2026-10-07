import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({
  requireSessionMiddleware: () => Promise.resolve(),
}));

import { onboardedContext, requireOnboarded } from "../app/lib/require-onboarded.server";
import routes from "../app/routes";
import AppLayout, { middleware } from "../app/routes/app-layout";
import AppSettingsLayout, * as appSettingsLayout from "../app/routes/app-settings-layout";
import * as appSessionLayout from "../app/routes/app-session-layout";

vi.mock("../app/lib/require-session.server", () => ({
  requireSession: async () => ({ user: { id: "user-1" } }),
  requireFreshSession: async () => ({ user: { id: "user-1" } }),
  sessionForRequest: async () => ({ user: { id: "user-1" } }),
  requireSessionMiddleware: sessionMocks.requireSessionMiddleware,
  signOutToLogin: async () => {
    throw new Response(null, { status: 302, headers: { Location: "/login" } });
  },
}));

const landing = vi.hoisted(() => ({ missing: false, value: null as string | null }));

vi.mock("../app/lib/workspace.server", () => ({
  ONBOARDING_COMPETITORS: "/onboarding/competitors",
  workspaceLandingForRequest: async () =>
    landing.missing ? { workspaceId: null, landing: null } : { workspaceId: "ws-1", landing: landing.value },
}));

describe("requireOnboarded", () => {
  it.each(["/onboarding", "/onboarding/identity?subject=acme.example", "/onboarding/competitors"])(
    "redirects an unfinished workspace to its resume point %s",
    async (resumePoint) => {
      landing.missing = false;
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
    landing.missing = false;
    landing.value = null;
    const context = new RouterContextProvider();
    await expect(
      requireOnboarded({ request: new Request("https://0509.io/app/alerts"), context }),
    ).resolves.toBeUndefined();
    expect(context.get(onboardedContext)).toEqual({ session: { user: { id: "user-1" } }, workspaceId: "ws-1" });
  });

  it("signs the user out to /login when there is no workspace", async () => {
    landing.missing = true;
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
    expect(response.headers.get("Location")).toBe("/login");
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

  it("gates the /app/settings routes with session-only middleware, so account delete stays reachable", () => {
    expect(childPathsOf("routes/app-settings-layout.tsx")).toEqual(SETTINGS_PATHS);
    expect(appSettingsLayout.middleware).toEqual([sessionMocks.requireSessionMiddleware]);
    expect(appSettingsLayout.middleware).not.toContain(requireOnboarded);
    expect(AppSettingsLayout().type).toBe(AppLayout().type);
  });

  it("gates share.png and logos with session-only middleware, not the onboarding gate", () => {
    expect(childPathsOf("routes/app-session-layout.tsx")).toEqual(["app/share.png", "app/logos/:entityId"]);
    expect(appSessionLayout.middleware).toEqual([sessionMocks.requireSessionMiddleware]);
    expect(appSessionLayout.middleware).not.toContain(requireOnboarded);
  });
});
