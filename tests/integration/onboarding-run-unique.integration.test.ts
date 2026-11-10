import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { startOnboardingRun } from "../../app/lib/data/onboarding_run.server";
import { ensureWorkspace, firstWorkspaceId } from "../../app/lib/workspace.server";

const NOW = "2026-11-04T06:00:00.000Z";

async function seedWorkspace(userId: string): Promise<string> {
  const email = `${userId}@example.com`;
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(userId, email, email, NOW, NOW)
    .run();
  await ensureWorkspace(env.DB, { userId, email, timezone: "UTC" });
  return firstWorkspaceId(userId);
}

async function runInputs(workspaceId: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT input_raw FROM onboarding_run WHERE workspace_id = ?")
    .bind(workspaceId)
    .all();
  return results.map((row) => String(row.input_raw));
}

describe("one onboarding run per workspace", () => {
  it("keeps the first run when onboarding starts twice", async () => {
    const workspaceId = await seedWorkspace("user-run-once");
    const run = { workspaceId, userId: "user-run-once", startedAt: NOW };
    await startOnboardingRun({ ...run, inputRaw: "first.example" });
    await startOnboardingRun({ ...run, inputRaw: "second.example" });
    expect(await runInputs(workspaceId)).toEqual(["first.example"]);
  });

  it("rejects a second run from any writer", async () => {
    const workspaceId = await seedWorkspace("user-run-raw");
    const insert = env.DB.prepare(
      "INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at) VALUES (?, ?, 'user-run-raw', 'x.example', ?)",
    );
    await insert.bind("run-raw-1", workspaceId, NOW).run();
    await expect(insert.bind("run-raw-2", workspaceId, NOW).run()).rejects.toThrow(/UNIQUE constraint failed/);
  });
});
