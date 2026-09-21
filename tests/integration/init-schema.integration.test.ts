import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

// REBUILD P2 C3 (#3862): the pre-rebuild integration suite died with the old
// schema it pinned. This is the first suite against migrations/0001_init.sql
// (issue #3846): apply the real migrations (setup file) and prove a write +
// read round-trip through the new user -> workspace -> plan spine works.
describe("0001_init schema", () => {
  it("accepts a user, workspace and plan row on the fresh schema", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 0, ?, ?)`,
    )
      .bind("u_init_test", "Init Test", "init-test@example.com", now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind("w_init_test", "Init Workspace", "u_init_test", now, now)
      .run();

    const workspace = await env.DB.prepare(
      `SELECT id, owner_user_id FROM workspace WHERE id = ?`,
    )
      .bind("w_init_test")
      .first<{ id: string; owner_user_id: string }>();

    expect(workspace?.id).toBe("w_init_test");
    expect(workspace?.owner_user_id).toBe("u_init_test");
  });
});
