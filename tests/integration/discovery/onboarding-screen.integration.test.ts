import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { readOnboardingScreen } from "../../../app/lib/discovery/start.server";

const REAL_DISCOVERY = env.DISCOVERY;

afterEach(() => {
  Reflect.set(env, "DISCOVERY", REAL_DISCOVERY);
});

async function seedWorkspace(id: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(`user-${id}`, id, `${id}@example.com`, "2026-10-05T03:00:00.000Z", "2026-10-05T03:00:00.000Z")
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, ?, ?, 'UTC', 1, 8, ?)`,
  )
    .bind(id, id, `user-${id}`, "2026-10-05T03:00:00.000Z")
    .run();
}

function completingWhileStatusIsRead(workspaceId: string): void {
  const status = async () => {
    await env.DB.prepare(
      `INSERT INTO suggestion (id, workspace_id, kind, candidate_domain, candidate_name, verdict_p, status, created_at)
       VALUES (?, ?, 'add', 'adidas.com', 'Adidas', 0.8, 'pending', '2026-10-05T03:31:22.000Z')`,
    )
      .bind(`sugg-${workspaceId}`, workspaceId)
      .run();
    return { status: "complete" };
  };
  Reflect.set(env, "DISCOVERY", { get: () => Promise.resolve({ status }) });
}

describe("readOnboardingScreen", () => {
  it("never reports discovery done with a suggestion list read before the last write landed", async () => {
    await seedWorkspace("ws-screen-order");
    completingWhileStatusIsRead("ws-screen-order");

    const screen = await readOnboardingScreen("ws-screen-order", new Date("2026-10-05T03:31:23Z"));

    expect(screen.discovery).toBe("done");
    expect(screen.maybes.map((maybe) => maybe.domain)).toEqual(["adidas.com"]);
  });
});
