import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readChangesWithoutExcerpt, readUnjudgedChanges } from "../../../app/lib/data/signal.server";
import { readCompetitorsToClassify, readOwnSitePages, readSilentRivals } from "../../../app/lib/data/page.server";
import { readWorkspacesWatchingSource } from "../../../app/lib/data/source.server";
import { readBlockedRivals, readSiteSweepTarget } from "../../../app/lib/data/watch.server";
import { planSiteSweep } from "../../../app/lib/site/sweep.server";
import { LONG_AGO, NOW, resetWorld, seedChangeSignals, seedPair, seedSiteWatches, sourceId } from "./seed";

describe("site sweeps skip fixture workspaces (0509#5774)", () => {
  beforeEach(resetWorld);

  it("marks the per-run e2e workspace as a fixture and the real one as live", async () => {
    const { live, fixture } = await seedPair();
    const marks = await env.DB.prepare("SELECT id, fixture FROM workspace WHERE id IN (?, ?)")
      .bind(live.workspaceId, fixture.workspaceId)
      .all<{ id: string; fixture: number }>();
    expect(Object.fromEntries(marks.results.map((row) => [row.id, row.fixture]))).toEqual({
      [live.workspaceId]: 0,
      [fixture.workspaceId]: 1,
    });
  });

  it("plans home pages, watches and targets for the live workspace only", async () => {
    const { live, fixture } = await seedPair();

    const targets = await planSiteSweep(NOW);

    expect(new Set(targets.map((target) => target.workspaceId))).toEqual(new Set([live.workspaceId]));
    expect(targets.map((target) => target.entityId).sort()).toEqual([live.rivalId, live.selfId].sort());
    const pages = await env.DB.prepare("SELECT entity_id FROM page WHERE entity_id IN (?, ?)")
      .bind(fixture.selfId, fixture.rivalId)
      .all();
    const watches = await env.DB.prepare("SELECT id FROM watch WHERE entity_id IN (?, ?)")
      .bind(fixture.selfId, fixture.rivalId)
      .all();
    expect(pages.results).toEqual([]);
    expect(watches.results).toEqual([]);
  });

  it("answers a fetch-sweep message for a live watch and drops one for a fixture watch", async () => {
    const pair = await seedPair();
    const live = await seedSiteWatches(pair.live);
    const fixture = await seedSiteWatches(pair.fixture);

    const liveTarget = await readSiteSweepTarget(live.rivalWatchId);
    const fixtureTarget = await readSiteSweepTarget(fixture.rivalWatchId);

    expect(liveTarget?.workspaceId).toBe(live.workspaceId);
    expect(fixtureTarget).toBeNull();
  });

  it("classifies the live competitor only", async () => {
    const pair = await seedPair();
    await seedSiteWatches(pair.live);
    await seedSiteWatches(pair.fixture);

    const competitors = await readCompetitorsToClassify(10, NOW);

    expect(competitors.map((competitor) => competitor.workspaceId)).toEqual([pair.live.workspaceId]);
  });

  it("reads own-site pages, silent rivals and blocked rivals for the live workspace only", async () => {
    const pair = await seedPair();
    await seedSiteWatches(pair.live);
    await seedSiteWatches(pair.fixture);
    await env.DB.prepare("UPDATE page SET deferred_at = ? WHERE role = 'home'").bind(NOW).run();

    const own = await readOwnSitePages();
    const silent = await readSilentRivals(NOW);
    const blocked = await readBlockedRivals(10);

    expect(own.map((page) => page.workspaceId)).toEqual([pair.live.workspaceId]);
    expect(silent.map((rival) => rival.workspaceId)).toEqual([pair.live.workspaceId]);
    expect(blocked.map((rival) => rival.workspaceId)).toEqual([pair.live.workspaceId]);
  });

  it("rejudges and excerpts the live workspace's changes only", async () => {
    const pair = await seedPair();
    await seedChangeSignals(pair);

    const unjudged = await readUnjudgedChanges({
      workspaceId: null,
      windowStartAt: LONG_AGO,
      windowEndAt: "2026-10-06T00:00:00.000Z",
      limit: 10,
    });
    const excerpts = await readChangesWithoutExcerpt(10);

    expect(unjudged.map((change) => change.workspaceId)).toEqual([pair.live.workspaceId]);
    expect(excerpts.map((row) => row.id)).toEqual([`signal-${pair.live.workspaceId}`]);
  });

  it("alerts only live workspaces that watch a source", async () => {
    const pair = await seedPair();
    await seedSiteWatches(pair.live);
    await seedSiteWatches(pair.fixture);

    const watching = await readWorkspacesWatchingSource(await sourceId("site.web"));

    expect(watching).toEqual([pair.live.workspaceId]);
  });
});
