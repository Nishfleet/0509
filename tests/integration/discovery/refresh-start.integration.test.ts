import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readSelfWorkspaceIds } from "../../../app/lib/data/entity.server";
import type { DiscoveryParams } from "../../../app/lib/discovery/start.server";
import {
  startDiscovery,
  startWeeklyRefresh,
  WEEKLY_REFRESH_CRON,
} from "../../../app/lib/discovery/start.server";

const NOW = "2026-09-28T04:00:00.000Z";
const DATE = "2026-09-28";

interface BatchItem {
  id: string;
  params: DiscoveryParams;
}

let runs = 0;

async function seedSelfWorkspace(domain: string): Promise<string> {
  runs += 1;
  const userId = `user-refresh-${String(runs)}`;
  const workspaceId = `ws-refresh-${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', ?3, 'Self', '{\"description\":\"Gym clothing\"}', ?4)",
    ).bind(`${workspaceId}-self`, workspaceId, domain, NOW),
  ]);
  return workspaceId;
}

afterEach(() => {
  Reflect.deleteProperty(env, "DISCOVERY");
});

describe("startWeeklyRefresh", () => {
  it("starts one refresh instance per self workspace with the refresh id and mode", async () => {
    await seedSelfWorkspace("gymshark.com");
    await seedSelfWorkspace("nike.com");
    const workspaceIds = await readSelfWorkspaceIds();
    const createBatch = vi.fn((_batch: BatchItem[]) => Promise.resolve([]));
    Reflect.set(env, "DISCOVERY", { createBatch });

    const started = await startWeeklyRefresh(new Date(NOW));

    expect(started).toBe(workspaceIds.length);
    expect(createBatch).toHaveBeenCalledTimes(1);
    expect(createBatch.mock.calls[0][0]).toEqual(
      workspaceIds.map((workspaceId) => ({
        id: `refresh-${workspaceId}-${DATE}`,
        params: { workspaceId, mode: "refresh" },
      })),
    );
  });

  it("keeps the create instance id and mode for startDiscovery", async () => {
    const workspaceId = await seedSelfWorkspace("gymshark.com");
    const createBatch = vi.fn((_batch: BatchItem[]) => Promise.resolve([]));
    Reflect.set(env, "DISCOVERY", { createBatch });

    await startDiscovery(workspaceId, new Date(NOW));

    expect(createBatch).toHaveBeenCalledTimes(1);
    expect(createBatch.mock.calls[0][0]).toEqual([
      { id: `discovery-${workspaceId}-${DATE}`, params: { workspaceId, mode: "create" } },
    ]);
  });
});

describe("WEEKLY_REFRESH_CRON", () => {
  it("is the Monday 04:00 UTC cron", () => {
    expect(WEEKLY_REFRESH_CRON).toBe("0 4 * * 1");
  });
});
