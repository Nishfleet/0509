import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { insertSelfEntity } from "../../app/lib/data/entity.server";
import { markWatchingStarted, startOnboardingRun } from "../../app/lib/data/onboarding_run.server";
import { firstWorkspaceId, workspaceLanding } from "../../app/lib/workspace.server";

async function seedUser(id: string, email: string) {
  const now = "2026-09-25T06:00:00.000Z";
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(id, email, email, now, now)
    .run();
}

describe("workspaceLanding resume point", () => {
  it("a fresh user lands on /onboarding", async () => {
    await seedUser("user-resume-1", "resume-1@example.com");
    const input = { userId: "user-resume-1", email: "resume-1@example.com", timezone: "UTC" };
    expect(await workspaceLanding(env.DB, input)).toBe("/onboarding");
  });

  it("walks identity, competitors and done as the run advances", async () => {
    await seedUser("user-resume-2", "resume-2@example.com");
    const input = { userId: "user-resume-2", email: "resume-2@example.com", timezone: "UTC" };
    expect(await workspaceLanding(env.DB, input)).toBe("/onboarding");
    const workspaceId = firstWorkspaceId("user-resume-2");
    await startOnboardingRun({
      workspaceId,
      userId: "user-resume-2",
      inputRaw: "https://acme.example/about?x=1",
      startedAt: "2026-09-25T06:00:00.000Z",
    });
    expect(await workspaceLanding(env.DB, input)).toBe(
      `/onboarding/identity?subject=${encodeURIComponent("https://acme.example/about?x=1")}`,
    );
    await insertSelfEntity({
      id: "entity-resume-2",
      workspaceId,
      domain: "acme.example",
      name: "Acme",
      identityJson: "{}",
      now: "2026-09-25T06:00:30.000Z",
    });
    expect(await workspaceLanding(env.DB, input)).toBe("/onboarding/competitors");
    await markWatchingStarted(workspaceId, "2026-09-25T06:01:00.000Z");
    expect(await workspaceLanding(env.DB, input)).toBeNull();
  });

  it("a self row with no run row is done", async () => {
    await seedUser("user-resume-3", "resume-3@example.com");
    const input = { userId: "user-resume-3", email: "resume-3@example.com", timezone: "UTC" };
    await workspaceLanding(env.DB, input);
    const workspaceId = firstWorkspaceId("user-resume-3");
    await insertSelfEntity({
      id: "entity-resume-3",
      workspaceId,
      domain: "solo.example",
      name: "Solo",
      identityJson: "{}",
      now: "2026-09-25T06:00:30.000Z",
    });
    expect(await workspaceLanding(env.DB, input)).toBeNull();
  });
});
