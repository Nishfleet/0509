import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readChangeAlerts, setChangeAlerts } from "../../app/lib/data/workspace.server";

const WORKSPACE = "ws-change-alerts";

describe("workspace change alerts setting (0509#6375)", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM workspace").run();
    await env.DB.prepare('DELETE FROM "user"').run();
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('user-change-alerts', 'Owner', 'owner@0509.io', 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Change alerts', 'user-change-alerts', 'UTC', 1, 8, '2026-10-01T00:00:00Z')`,
    )
      .bind(WORKSPACE)
      .run();
  });

  it("defaults to on, including for an unknown workspace", async () => {
    expect(await readChangeAlerts(WORKSPACE)).toBe(true);
    expect(await readChangeAlerts("missing-workspace")).toBe(true);
  });

  it("turns off and back on", async () => {
    await setChangeAlerts(WORKSPACE, false);
    expect(await readChangeAlerts(WORKSPACE)).toBe(false);
    await setChangeAlerts(WORKSPACE, true);
    expect(await readChangeAlerts(WORKSPACE)).toBe(true);
  });
});
