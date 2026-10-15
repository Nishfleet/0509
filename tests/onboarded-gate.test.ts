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

const seen = vi.hoisted(() => ({ touched: [] as string[], fail: false }));

vi.mock("cloudflare:workers", () => ({ waitUntil: (work: Promise<unknown>) => void work }));

vi.mock("../app/lib/data/workspace.server", () => ({
  touchWorkspaceSeen: (workspaceId: string) => {
    seen.touched.push(workspaceId);
    return seen.fail ? Promise.reject(new Error("d1 down")) : Promise.resolve();
  },
}));

const landing = vi.hoisted(() => ({ missing: false, value: null as string | null }));

vi.mock("../app/lib/workspace.server", () => ({
  ONBOARDING_COMPETITORS: "/onboarding/competitors",
  workspaceLandingForRequest: async () =>
    landing.missing ? { workspaceId: null, landing: null } : { workspaceId: "ws-1", landing: landing.value },
}));

describe("requireOnboarded", () => {
  it.each(["/onboarding", "/onboarding/identity?subject=acme.example", "/onboarding/competitors", "/onboarding/plan"])(
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

  it("records the visit after the gate passes, and a failed write never blocks the page", async () => {
    landing.missing = false;
    landing.value = null;
    seen.touched.length = 0;
    seen.fail = true;
    await expect(
      requireOnboarded({ request: new Request("https://0509.io/app/alerts"), context: new RouterContextProvider() }),
    ).resolves.toBeUndefined();
    seen.fail = false;
    expect(seen.touched).toEqual(["ws-1"]);
  });

  it("does not record a visit for an unfinished workspace", async () => {
    landing.missing = false;
    landing.value = "/onboarding";
    seen.touched.length = 0;
    await requireOnboarded({
      request: new Request("https://0509.io/app/alerts"),
      context: new RouterContextProvider(),
    }).catch(() => undefined);
    expect(seen.touched).toEqual([]);
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
      "app/changes/feedback",
      "app/brief-preview",
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
    expect(childPathsOf("routes/app-session-layout.tsx")).toEqual([
      "app/share.png",
      "app/logos/:entityId",
      "app/admin/retention",
    ]);
    expect(appSessionLayout.middleware).toEqual([sessionMocks.requireSessionMiddleware]);
    expect(appSessionLayout.middleware).not.toContain(requireOnboarded);
  });
});
