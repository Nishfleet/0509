import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { listBriefs, readBrief } from "../../app/lib/data/digest.server";

const USER_A = "user-brief-a";
const USER_B = "user-brief-b";
const WS_A = "ws-brief-a";
const WS_B = "ws-brief-b";

const seedUser = async (id: string, email: string): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Brief reader', ?, 1, '2026-09-25T00:00:00Z', '2026-09-25T00:00:00Z')`,
  )
    .bind(id, email)
    .run();
};

const seedWorkspace = async (id: string, ownerId: string): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Brief read', ?, 'UTC', 1, 8, '2026-09-25T00:00:00Z')`,
  )
    .bind(id, ownerId)
    .run();
};

const seedDigest = async (
  id: string,
  workspaceId: string,
  periodStart: string,
  periodEnd: string,
  status: string,
  payloadJson: string,
  sentAt: string | null,
): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json, sent_at)
     VALUES (?, ?, 'weekly', ?, ?, ?, ?, ?)`,
  )
    .bind(id, workspaceId, periodStart, periodEnd, status, payloadJson, sentAt)
    .run();
};

describe("brief reads (0509#5145)", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM workspace").run();
    await env.DB.prepare('DELETE FROM "user"').run();
    await seedUser(USER_A, "brief-a@0509.io");
    await seedUser(USER_B, "brief-b@0509.io");
    await seedWorkspace(WS_A, USER_A);
    await seedWorkspace(WS_B, USER_B);
    await seedDigest(
      "dg-a-1",
      WS_A,
      "2026-09-07T08:00:00.000Z",
      "2026-09-14T08:00:00.000Z",
      "sent",
      '{"n":1}',
      "2026-09-14T08:00:05.000Z",
    );
    await seedDigest(
      "dg-a-2",
      WS_A,
      "2026-09-14T08:00:00.000Z",
      "2026-09-21T08:00:00.000Z",
      "failed",
      '{"n":2}',
      null,
    );
    await seedDigest(
      "dg-b-1",
      WS_B,
      "2026-09-14T08:00:00.000Z",
      "2026-09-21T08:00:00.000Z",
      "pending",
      "{}",
      null,
    );
  });

  it("lists a workspace's weekly briefs newest first", async () => {
    const rows = await listBriefs(env.DB, WS_A);
    expect(rows.map((row) => row.id)).toEqual(["dg-a-2", "dg-a-1"]);
  });

  it("keeps a listed brief's sent_at instant", async () => {
    const rows = await listBriefs(env.DB, WS_A);
    expect(rows[1]?.sent_at).toBe("2026-09-14T08:00:05.000Z");
  });

  it("does not read another workspace's brief", async () => {
    expect(await readBrief(env.DB, WS_A, "dg-b-1")).toBeNull();
  });

  it("reads one of a workspace's briefs with its payload", async () => {
    const brief = await readBrief(env.DB, WS_A, "dg-a-1");
    expect(brief?.payload_json).toBe('{"n":1}');
  });
});
