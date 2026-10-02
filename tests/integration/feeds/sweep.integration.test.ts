import { env, introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { planFeedSweep } from "../../../app/lib/feeds/sweep.server";
import { resetFeedFixtures, rssFeed, seedEntity } from "./seed";

const PAD =
  "Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team.";

const USER = "user-feed-sweep";
const WS = "ws-feed-sweep";

const homepage = (head: string) =>
  `<!doctype html><html><head>${head}</head><body><h1>Rival</h1><p>${PAD}</p></body></html>`;

const declared = `<link rel="alternate" type="application/atom+xml" href="/changelog.atom">`;

const web = {
  head: declared,
  feeds: new Map<string, string>(),
  calls: [] as string[],
};

const NIGHT_ONE = [{ id: "p1", title: "First post" }];
const NIGHT_TWO = [...NIGHT_ONE, { id: "p2", title: "Second post" }];

const runSweep = async (id: string) => {
  await using introspector = await introspectWorkflowInstance(env.FEED_SWEEP, id);
  await env.FEED_SWEEP.create({ id });
  await introspector.waitForStatus("complete");
  return introspector.getOutput();
};

const contentSignals = async () => {
  const { results } = await env.DB.prepare(
    "SELECT title, entity_id FROM signal WHERE kind = 'content' ORDER BY title",
  ).all<{ title: string; entity_id: string }>();
  return results;
};

const feedWatches = async () => {
  const { results } = await env.DB.prepare(
    "SELECT w.entity_id, w.target_key FROM watch w JOIN source s ON s.id = w.source_id WHERE s.key = 'feed.rss' AND w.is_active = 1",
  ).all<{ entity_id: string; target_key: string }>();
  return results;
};

describe("nightly feed sweep workflow", () => {
  beforeEach(async () => {
    await resetFeedFixtures({ user: USER, workspace: WS, email: "feed-sweep@0509.io" });
    await seedEntity(WS, "ent-rival", "rival.com");
    await seedEntity(WS, "ent-paused", "paused.com", "off");

    web.head = declared;
    web.feeds = new Map([["https://rival.com/changelog.atom", rssFeed(NIGHT_ONE)]]);
    web.calls = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      web.calls.push(url);
      if (url === "https://rival.com/") return Promise.resolve(new Response(homepage(web.head), { status: 200 }));
      const feed = web.feeds.get(url);
      if (feed !== undefined) return Promise.resolve(new Response(feed, { status: 200 }));
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing while the feed source is disabled", async () => {
    await env.DB.prepare("UPDATE source SET is_enabled = 0 WHERE key = 'feed.rss'").run();
    expect(await planFeedSweep()).toEqual({ entities: [], targets: [] });

    const output = await runSweep("feed-disabled");

    expect(output).toMatchObject({ discovered: 0, feeds: 0, failed: 0 });
    expect(web.calls).toEqual([]);
  });

  it("discovers the declared feed, baselines it, then files the new post on the next night", async () => {
    const first = await runSweep("feed-night-1");

    expect(first).toMatchObject({ discovered: 1, feeds: 1, first: 1, newPosts: 0, failed: 0 });
    expect(await feedWatches()).toEqual([{ entity_id: "ent-rival", target_key: "https://rival.com/changelog.atom" }]);
    expect(await contentSignals()).toEqual([]);
    expect(web.calls.filter((url) => new URL(url).hostname.endsWith("paused.com"))).toEqual([]);

    web.feeds.set("https://rival.com/changelog.atom", rssFeed(NIGHT_TWO));
    const second = await runSweep("feed-night-2");

    expect(second).toMatchObject({ discovered: 0, feeds: 1, changed: 1, newPosts: 1, failed: 0 });
    expect(await contentSignals()).toEqual([{ title: "Second post", entity_id: "ent-rival" }]);

    const third = await runSweep("feed-night-3");
    expect(third).toMatchObject({ unchanged: 1, newPosts: 0 });
    expect(await contentSignals()).toHaveLength(1);
  });

  it("finds a feed at a common path when the homepage declares none", async () => {
    web.head = "";
    web.feeds = new Map([["https://rival.com/rss.xml", rssFeed(NIGHT_ONE)]]);

    const output = await runSweep("feed-common-path");

    expect(output).toMatchObject({ discovered: 1, feeds: 1, first: 1 });
    expect(await feedWatches()).toEqual([{ entity_id: "ent-rival", target_key: "https://rival.com/rss.xml" }]);
  });

  it("skips a path that answers with HTML instead of a feed, and watches nothing for a brand with no feed", async () => {
    web.head = "";
    web.feeds = new Map([["https://rival.com/feed", "<!doctype html><html><body>Page not found</body></html>"]]);

    const output = await runSweep("feed-none");

    expect(output).toMatchObject({ discovered: 0, feeds: 0, failed: 0 });
    expect(await feedWatches()).toEqual([]);
  });

  it("never fetches a feed that robots.txt disallows", async () => {
    web.feeds.set("https://rival.com/robots.txt", "User-agent: *\nDisallow: /changelog.atom");

    const output = await runSweep("feed-robots");

    expect(output).toMatchObject({ discovered: 0, feeds: 0, failed: 0 });
    expect(web.calls).not.toContain("https://rival.com/changelog.atom");
  });
});
