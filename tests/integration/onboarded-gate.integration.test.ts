import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { insertSelfEntity } from "../../app/lib/data/entity.server";
import { markWatchingStarted, startOnboardingRun } from "../../app/lib/data/onboarding_run.server";

vi.mock("../../app/lib/require-session.server", () => ({
  requireSession: async () => ({ user: { id: "user-gate-1" } }),
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

describe("requireOnboarded against real D1", () => {
  it("redirects an unfinished workspace to its resume point", async () => {
    await seedUser("user-gate-1", "gate-1@example.com");
    const request = new Request("https://0509.io/app/alerts", {
      headers: { cookie: "better-auth.session_token=x" },
    });
    const thrown = await requireOnboarded({ request }).then(
      () => null,
      (error) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/onboarding");
  });

  it("resolves once watching has started", async () => {
    const request = new Request("https://0509.io/app/alerts", {
      headers: { cookie: "better-auth.session_token=x" },
    });
    const thrown = await requireOnboarded({ request }).then(
      () => null,
      (error) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe("/onboarding");

    const workspaceId = "ws_user-gate-1";
    await startOnboardingRun({
      workspaceId,
      userId: "user-gate-1",
      inputRaw: "https://gate.example",
      startedAt: "2026-09-28T00:00:00.000Z",
    });
    const second = await requireOnboarded({ request }).then(
      () => null,
      (error) => error,
    );
    expect(second).toBeInstanceOf(Response);
    expect((second as Response).headers.get("Location")).toBe(
      `/onboarding/identity?subject=${encodeURIComponent("https://gate.example")}`,
    );

    await insertSelfEntity({
      id: "entity-gate-1",
      workspaceId,
      domain: "gate.example",
      name: "Gate",
      identityJson: "{}",
      now: "2026-09-28T00:00:30.000Z",
    });
    const third = await requireOnboarded({ request }).then(
      () => null,
      (error) => error,
    );
    expect(third).toBeInstanceOf(Response);
    expect((third as Response).headers.get("Location")).toBe("/onboarding/competitors");

    await markWatchingStarted(workspaceId, "2026-09-28T00:01:00.000Z");
    await expect(requireOnboarded({ request })).resolves.toBeUndefined();
  });
});
