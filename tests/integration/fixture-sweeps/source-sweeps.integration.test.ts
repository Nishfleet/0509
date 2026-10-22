import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readPaidWorkspaceIds } from "../../../app/lib/data/plan.server";
import { planFeedSweep } from "../../../app/lib/feeds/sweep.server";
import { planHiringSweep } from "../../../app/lib/hiring/sweep.server";
import { planTargets } from "../../../workers/mentions/sweep";
import { NOW, resetWorld, seedPair, sourceId } from "./seed";

async function watchRival(rivalId: string, key: string, target: string): Promise<void> {
  await env.DB.prepare("UPDATE source SET is_enabled = 1 WHERE key = ?").bind(key).run();
  await env.DB.prepare("INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?, ?, ?, ?)")
    .bind(`watch-${key}-${rivalId}`, rivalId, await sourceId(key), target)
    .run();
}

describe("source sweeps skip fixture workspaces (0509#5774)", () => {
  beforeEach(resetWorld);

  it("counts only the live workspace as paid", async () => {
    const { live, fixture } = await seedPair();

    const paid = await readPaidWorkspaceIds(new Date(NOW));

    expect(paid.has(live.workspaceId)).toBe(true);
    expect(paid.has(fixture.workspaceId)).toBe(false);
  });

  it("plans the hiring sweep for the live workspace only", async () => {
    const { live, fixture } = await seedPair();
    await watchRival(live.rivalId, "hiring.greenhouse", "https://boards.greenhouse.io/live");
    await watchRival(fixture.rivalId, "hiring.greenhouse", "https://boards.greenhouse.io/fixture");

    const plan = await planHiringSweep();

    expect(plan.targets.map((target) => target.workspaceId)).toEqual([live.workspaceId]);
    expect(plan.entities.map((entity) => entity.id).sort()).toEqual([live.selfId].sort());
  });

  it("plans the feed sweep for the live workspace only", async () => {
    const { live, fixture } = await seedPair();
    await watchRival(live.rivalId, "feed.rss", "https://live-rival.com/feed.xml");
    await watchRival(fixture.rivalId, "feed.rss", "https://fixture-rival.com/feed.xml");

    const plan = await planFeedSweep();

    expect(plan.targets.map((target) => target.workspaceId)).toEqual([live.workspaceId]);
    expect(plan.entities.map((entity) => entity.id)).toEqual([live.selfId]);
  });

  it("plans mention targets, and creates mention watches, for the live workspace only", async () => {
    const { live } = await seedPair();

    const targets = await planTargets();

    const planned = targets.flatMap((target) => target.watches.map((watch) => watch.workspace_id));
    expect(planned.length).toBeGreaterThan(0);
    expect(new Set(planned)).toEqual(new Set([live.workspaceId]));
    const created = await env.DB.prepare(
      "SELECT DISTINCT e.workspace_id AS workspace_id FROM watch w JOIN entity e ON e.id = w.entity_id",
    ).all<{ workspace_id: string }>();
    expect(created.results.map((row) => row.workspace_id)).toEqual([live.workspaceId]);
  });
});
