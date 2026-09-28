import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readBriefScheduleForOwner, setBriefPaused } from "../../app/lib/data/workspace.server";

const OWNER = "user-brief-pause";
const WORKSPACE = "ws-brief-pause";
const OTHER_OWNER = "user-brief-pause-other";
const OTHER_WORKSPACE = "ws-brief-pause-other";

const storedPausedAt = async (workspaceId: string): Promise<string | null> =>
  (
    await env.DB.prepare("SELECT brief_paused_at AS v FROM workspace WHERE id = ?")
      .bind(workspaceId)
      .first<{ v: string | null }>()
  )?.v ?? null;

describe("workspace brief pause (0509#5107)", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM workspace").run();
    await env.DB.prepare('DELETE FROM "user"').run();
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'owner@0509.io', 1, '2026-09-24T00:00:00Z', '2026-09-24T00:00:00Z')`,
    )
      .bind(OWNER)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Brief pause', ?, 'UTC', 1, 8, '2026-09-24T00:00:00Z')`,
    )
      .bind(WORKSPACE, OWNER)
      .run();
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Other owner', 'other-owner@0509.io', 1, '2026-09-24T00:00:00Z', '2026-09-24T00:00:00Z')`,
    )
      .bind(OTHER_OWNER)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Brief pause other', ?, 'UTC', 1, 8, '2026-09-24T00:00:00Z')`,
    )
      .bind(OTHER_WORKSPACE, OTHER_OWNER)
      .run();
  });

  it("a fresh workspace reads pausedAt: null", async () => {
    expect(await readBriefScheduleForOwner(OWNER)).toEqual({
      workspaceId: WORKSPACE,
      schedule: { timezone: "UTC", weekday: 1, hour: 8, pausedAt: null },
    });
    expect(await storedPausedAt(WORKSPACE)).toBe(null);
  });

  it("setBriefPaused stores the instant and the read returns it", async () => {
    await setBriefPaused(WORKSPACE, "2026-09-25T10:00:00.000Z");
    expect(await storedPausedAt(WORKSPACE)).toBe("2026-09-25T10:00:00.000Z");
    expect(await readBriefScheduleForOwner(OWNER)).toEqual({
      workspaceId: WORKSPACE,
      schedule: { timezone: "UTC", weekday: 1, hour: 8, pausedAt: "2026-09-25T10:00:00.000Z" },
    });
  });

  it("setBriefPaused(null) clears the pause", async () => {
    await setBriefPaused(WORKSPACE, "2026-09-25T10:00:00.000Z");
    await setBriefPaused(WORKSPACE, null);
    expect(await storedPausedAt(WORKSPACE)).toBe(null);
    expect(await readBriefScheduleForOwner(OWNER)).toEqual({
      workspaceId: WORKSPACE,
      schedule: { timezone: "UTC", weekday: 1, hour: 8, pausedAt: null },
    });
  });

  it("pausing one workspace leaves the other workspace's brief_paused_at NULL", async () => {
    await setBriefPaused(WORKSPACE, "2026-09-25T10:00:00.000Z");
    expect(await storedPausedAt(OTHER_WORKSPACE)).toBe(null);
    expect(await readBriefScheduleForOwner(OTHER_OWNER)).toEqual({
      workspaceId: OTHER_WORKSPACE,
      schedule: { timezone: "UTC", weekday: 1, hour: 8, pausedAt: null },
    });
  });
});
