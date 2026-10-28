import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { touchWorkspaceSeen } from "../../app/lib/data/workspace.server";

const WS = "ws-seen";

const seenAt = async () =>
  (
    await env.DB.prepare("SELECT last_seen_at AS at FROM workspace WHERE id = ?")
      .bind(WS)
      .first<{ at: string | null }>()
  )?.at;

describe("workspace last seen", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES ('user-seen', 'Seen', 'seen@0509.io', 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at)
         VALUES (?, 'Seen', 'user-seen', 'UTC', '2026-10-01T00:00:00Z')`,
      ).bind(WS),
    ]);
  });

  it("records a first visit, ignores more within a day, and records the next day", async () => {
    await env.DB.exec("UPDATE workspace SET last_seen_at = NULL");

    await touchWorkspaceSeen(WS, new Date("2026-10-14T08:00:00.000Z"));
    expect(await seenAt()).toBe("2026-10-14T08:00:00.000Z");

    await touchWorkspaceSeen(WS, new Date("2026-10-14T20:00:00.000Z"));
    expect(await seenAt()).toBe("2026-10-14T08:00:00.000Z");

    await touchWorkspaceSeen(WS, new Date("2026-10-15T08:00:00.000Z"));
    expect(await seenAt()).toBe("2026-10-15T08:00:00.000Z");
  });
});
