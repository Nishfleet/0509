import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readCompetitorSnapshot } from "../../../app/lib/competitor-snapshot.server";
import {
  insertContentSignals,
  readEntityDevelopments,
  readScoredSignals,
  readWeekEvidence,
  readWorkspaceContent,
} from "../../../app/lib/data/signal.server";
import { readEntitySources, readRegistrySources } from "../../../app/lib/data/source.server";
import {
  insertWatches,
  readEntityR2Prefixes,
  readSiteSweepTarget,
  readSiteSweepTargets,
  readSiteWatchSummary,
} from "../../../app/lib/data/watch.server";
import { readWorkspaceR2Prefixes } from "../../../app/lib/data/workspace.server";
import { insertPages } from "../../../app/lib/data/page.server";
import { COUNT_BUCKETS } from "../../../app/lib/standing-score.server";
import { NOW, resetFeedFixtures, seedEntity } from "./seed";

const USER = "user-feed-isolation";
const WS = "ws-feed-isolation";
const FEED_URL = "https://rival.com/feed";
const HOME_URL = "https://rival.com/";

const sourceId = async (key: string) =>
  (await env.DB.prepare("SELECT id FROM source WHERE key = ?1").bind(key).first<{ id: string }>())?.id ?? "";

describe("a feed watch is never a site watch", () => {
  beforeEach(async () => {
    await resetFeedFixtures({ user: USER, workspace: WS, email: "feed-isolation@0509.io" });
    await seedEntity(WS, "ent-rival", "rival.com");
    await env.DB.prepare("UPDATE source SET is_enabled = 1 WHERE key = 'site.web'").run();
    await insertPages([
      { id: "page-home", entityId: "ent-rival", url: HOME_URL, role: "home", discoveredAt: NOW },
      { id: "page-feed", entityId: "ent-rival", url: FEED_URL, role: "other", discoveredAt: NOW },
    ]);
    await insertWatches([
      { id: "watch-site", entityId: "ent-rival", sourceId: await sourceId("site.web"), targetKey: HOME_URL },
      { id: "watch-feed", entityId: "ent-rival", sourceId: await sourceId("feed.rss"), targetKey: FEED_URL },
    ]);
  });

  it("seeds the feed source as a disabled site-kind row with platform feed", async () => {
    const row = await env.DB.prepare(
      "SELECT id, kind, platform, plugin_key, reliability FROM source WHERE key = 'feed.rss'",
    ).first();
    expect(row).toEqual({
      id: "src_site_feed",
      kind: "site",
      platform: "feed",
      plugin_key: "feed.rss",
      reliability: "rss",
    });
  });

  it("is left out of the site sweep, even when a page row has the feed's URL", async () => {
    const targets = await readSiteSweepTargets("site.web");
    expect(targets.map((target) => target.watchId)).toEqual(["watch-site"]);
    expect(await readSiteSweepTargets("feed.rss")).toEqual([]);
    expect(await readSiteSweepTarget("watch-feed")).toBeNull();
    expect((await readSiteSweepTarget("watch-site"))?.url).toBe(HOME_URL);
  });

  it("is left out of the site watch summary's page count", async () => {
    const summary = await readSiteWatchSummary(WS, "ent-rival");
    expect(summary.pages).toBe(1);
  });

  it("is listed under the content kind, never the site kind, in every source list", async () => {
    await env.DB.prepare("UPDATE source SET latest_fetched_at = ?1, latest_item_count = 1 WHERE key = 'feed.rss'")
      .bind(NOW)
      .run();
    const entity = await readEntitySources(WS, "ent-rival");
    expect(entity.map((entry) => [entry.source.key, entry.source.kind])).toEqual([
      ["feed.rss", "content"],
      ["site.web", "site"],
    ]);
    const registry = await readRegistrySources();
    expect(registry.find((entry) => entry.source.key === "feed.rss")?.kind).toBe("content");
    expect(registry.find((entry) => entry.source.key === "site.web")?.kind).toBe("site");
  });

  it("does not make a competitor's site-change cell look watched or answered", async () => {
    await env.DB.prepare("UPDATE watch SET is_active = 0 WHERE id = 'watch-site'").run();
    const snapshot = await readCompetitorSnapshot(WS, "ent-rival", new Date(NOW));
    expect(snapshot.sources.map((source) => source.kind)).toEqual(["content"]);
  });

  it("clears the feed snapshots with the competitor and the account", async () => {
    expect(await readEntityR2Prefixes(WS, "ent-rival")).toContain("snapshot/feed/watch-feed/");
    expect(await readWorkspaceR2Prefixes(WS)).toContain("snapshot/feed/watch-feed/");
  });

  it("shows a content signal as a post, and never scores or ranks it", async () => {
    await insertContentSignals([
      {
        id: "sig-content",
        workspaceId: WS,
        entityId: "ent-rival",
        sourceId: await sourceId("feed.rss"),
        watchId: "watch-feed",
        snapshotId: null,
        itemKey: "k1",
        title: "Launching Rival 2",
        excerpt: "A big release",
        url: "https://rival.com/blog/2",
        publishedAt: "2026-10-01T00:00:00.000Z",
        observedAt: NOW,
      },
    ]);

    const posts = await readWorkspaceContent(WS, "2026-09-01T00:00:00.000Z", 10);
    expect(posts).toEqual([
      expect.objectContaining({ title: "Launching Rival 2", brand: "rival.com", url: "https://rival.com/blog/2" }),
    ]);

    const evidence = await readWeekEvidence({ workspaceId: WS, entityId: "ent-rival", since: "2026-09-01T00:00:00Z" });
    expect(evidence.map((item) => item.sourceKind)).toEqual(["content"]);

    const developments = await readEntityDevelopments({
      workspaceId: WS,
      entityId: "ent-rival",
      since: "2026-09-01T00:00:00Z",
      limit: 10,
    });
    expect(developments.map((item) => item.kind)).toEqual(["content"]);

    const scored = await readScoredSignals({
      workspaceId: WS,
      entityId: "ent-rival",
      since: "2026-09-01T00:00:00Z",
      until: "2026-10-03T00:00:00Z",
    });
    expect(scored).toEqual([]);

    const buckets = await env.DB.prepare(COUNT_BUCKETS)
      .bind(WS, "2026-09-01T00:00:00Z", "2026-10-03T00:00:00Z", "mention_is_about_brand", "noteworthy_change")
      .all();
    expect(buckets.results).toEqual([]);
  });
});
