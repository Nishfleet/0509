import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readWorkspaceLanding, readWorkspaceTimezone } from "../../../app/lib/data/workspace.server";

const NOW = "2026-09-24T00:00:00Z";

async function seedWorkspace(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)`,
  )
    .bind(`user-${id}`, "Owner", `${id}@0509.io`, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?, ?, ?, 'Asia/Kolkata', ?)`,
  )
    .bind(id, "Owner", `user-${id}`, NOW)
    .run();
}

beforeEach(async () => {
  for (const table of ["onboarding_run", "entity", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await seedWorkspace("ws-a");
});

describe("readWorkspaceTimezone", () => {
  it("returns the stored IANA zone", async () => {
    expect(await readWorkspaceTimezone("ws-a")).toBe("Asia/Kolkata");
  });

  it("falls back to UTC when the workspace is missing", async () => {
    expect(await readWorkspaceTimezone("ws-none")).toBe("UTC");
  });
});

describe("readWorkspaceLanding", () => {
  it("returns the workspace with its self entity and onboarding input", async () => {
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, state, created_at) VALUES (?, ?, 'self', ?, 'on', ?)`,
    )
      .bind("ent-a", "ws-a", "a.example", NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at, watching_started_at)
       VALUES (?, ?, ?, 'Acme and its rivals', ?, ?)`,
    )
      .bind("ob-a", "ws-a", "user-ws-a", NOW, "2026-09-25T00:00:00Z")
      .run();
    expect(await readWorkspaceLanding(env.DB, "user-ws-a")).toEqual({
      id: "ws-a",
      timezone: "Asia/Kolkata",
      self_id: "ent-a",
      input_raw: "Acme and its rivals",
      watching_started_at: "2026-09-25T00:00:00Z",
    });
  });

  it("returns null self, input and watching fields when no self entity or onboarding run exists", async () => {
    expect(await readWorkspaceLanding(env.DB, "user-ws-a")).toEqual({
      id: "ws-a",
      timezone: "Asia/Kolkata",
      self_id: null,
      input_raw: null,
      watching_started_at: null,
    });
  });

  it("returns null when the owner has no workspace", async () => {
    expect(await readWorkspaceLanding(env.DB, "user-none")).toBeNull();
  });
});
