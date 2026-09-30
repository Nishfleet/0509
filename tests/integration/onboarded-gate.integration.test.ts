import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { insertSelfEntity } from "../../app/lib/data/entity.server";
import { markWatchingStarted, startOnboardingRun } from "../../app/lib/data/onboarding_run.server";
import { firstWorkspaceId } from "../../app/lib/workspace.server";

vi.mock("../../app/lib/require-session.server", () => ({
  requireSession: async (request: Request) => ({
    user: { id: request.headers.get("x-test-user"), email: request.headers.get("x-test-email") },
  }),
}));

import { requireOnboarded } from "../../app/lib/require-onboarded.server";

async function seedUser(id: string, email: string) {
  const now = "2026-09-28T00:00:00.000Z";
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(id, email, email, now, now)
    .run();
}

function gateRequest(userId: string): Request {
  return new Request("https://0509.io/app/alerts", {
    headers: { cookie: "better-auth.session_token=x", "x-test-user": userId, "x-test-email": `${userId.replace("user-", "")}@example.com` },
  });
}

async function redirectedTo(request: Request): Promise<string | null> {
  const thrown = await requireOnboarded({ request }).then(
    () => null,
    (error) => error,
  );
  if (thrown === null) return null;
  expect(thrown).toBeInstanceOf(Response);
  const response = thrown as Response;
  expect(response.status).toBe(302);
  return response.headers.get("Location");
}

describe("requireOnboarded against real D1", () => {
  it("redirects a fresh workspace to /onboarding", async () => {
    await seedUser("user-gate-1", "gate-1@example.com");
    expect(await redirectedTo(gateRequest("user-gate-1"))).toBe("/onboarding");
  });

  it("walks the resume ladder and resolves once watching has started", async () => {
    await seedUser("user-gate-2", "gate-2@example.com");
    const request = gateRequest("user-gate-2");
    expect(await redirectedTo(request)).toBe("/onboarding");

    const workspaceId = firstWorkspaceId("user-gate-2");
    await startOnboardingRun({
      workspaceId,
      userId: "user-gate-2",
      inputRaw: "https://gate.example",
      startedAt: "2026-09-28T00:00:00.000Z",
    });
    expect(await redirectedTo(request)).toBe(
      `/onboarding/identity?subject=${encodeURIComponent("https://gate.example")}`,
    );

    await insertSelfEntity({
      id: "entity-gate-2",
      workspaceId,
      domain: "gate.example",
      name: "Gate",
      identityJson: "{}",
      now: "2026-09-28T00:00:30.000Z",
    });
    expect(await redirectedTo(request)).toBe("/onboarding/competitors");

    await markWatchingStarted(workspaceId, "2026-09-28T00:01:00.000Z");
    await expect(requireOnboarded({ request })).resolves.toBeUndefined();
  });
});
