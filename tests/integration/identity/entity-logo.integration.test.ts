import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readEntityLogo } from "../../../app/lib/identity/logo-store.server";

const NOW = "2026-09-24T00:00:00Z";

async function seedWorkspace(ws: string, user: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, ?, ?)`,
  )
    .bind(user, `${user}@0509.io`, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(ws, ws, user, NOW)
    .run();
}

beforeEach(async () => {
  for (const table of ["entity", "workspace", '"user"']) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }
  const listed = await env.SNAPSHOTS.list({ prefix: "logo/" });
  await Promise.all(listed.objects.map((object) => env.SNAPSHOTS.delete(object.key)));

  await seedWorkspace("ws-1", "u-1");
  await seedWorkspace("ws-2", "u-2");
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES ('e1', 'ws-1', 'competitor', 'gymshark.com', 'Gymshark', 'on', ?)`,
  )
    .bind(NOW)
    .run();
  await env.SNAPSHOTS.put("logo/gymshark.com", "logo-bytes", {
    httpMetadata: { contentType: "image/png" },
  });
});

describe("readEntityLogo", () => {
  it("returns the logo stored for the entity's domain when the workspace owns the entity", async () => {
    const object = await readEntityLogo("ws-1", "e1");
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe("image/png");
  });

  it("returns null when a different workspace asks for the same entity", async () => {
    expect(await readEntityLogo("ws-2", "e1")).toBeNull();
  });

  it("returns null when the entity does not exist in the workspace", async () => {
    expect(await readEntityLogo("ws-1", "missing")).toBeNull();
  });
});
