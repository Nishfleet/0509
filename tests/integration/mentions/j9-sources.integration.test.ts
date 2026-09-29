import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { planTargets, sweepTarget } from "../../../workers/mentions/sweep";

const NOW = "2026-09-24T03:00:00.000Z";
const CHANNEL_ID = "UCma7hhYJ3bfEhZgw3xl77ww";
const BRAND = "Zephyrwear J9";

const GDELT = {
  articles: [
    {
      url: "https://news.example.com/j9-flagship",
      title: "Zephyrwear J9 opens a London flagship",
      seendate: "20260923T101500Z",
      domain: "news.example.com",
    },
    {
      url: "https://weather.example.com/j9-winds",
      title: "Zephyr winds expected this weekend",
      seendate: "20260923T081500Z",
      domain: "weather.example.com",
    },
  ],
};

const HN = {
  hits: [
    {
      objectID: "90000001",
      title: "Zephyrwear J9 raises a Series B",
      url: "https://blog.example.com/j9-series-b",
      created_at: "2026-09-23T09:00:00.000Z",
    },
    {
      objectID: "90000002",
      title: "Zephyr J9 the Greek wind god, a thread",
      url: null,
      created_at: "2026-09-23T07:00:00.000Z",
    },
  ],
};

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <title>Zephyrwear J9</title>
  <entry>
    <id>yt:video:QVx0PY1lf-s</id>
    <yt:videoId>QVx0PY1lf-s</yt:videoId>
    <title>Zephyrwear J9 autumn campaign film</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=QVx0PY1lf-s"/>
    <published>2026-09-23T06:00:00+00:00</published>
    <updated>2026-09-23T06:00:00+00:00</updated>
  </entry>
  <entry>
    <id>yt:video:aaaaaaaaaaa</id>
    <yt:videoId>aaaaaaaaaaa</yt:videoId>
    <title>Zephyr J9 winds explained for pilots</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=aaaaaaaaaaa"/>
    <published>2026-09-23T05:00:00+00:00</published>
    <updated>2026-09-23T05:00:00+00:00</updated>
  </entry>
</feed>`;

function stubUpstreams() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.gdeltproject.org")) return Promise.resolve(new Response(JSON.stringify(GDELT)));
      if (url.includes("hn.algolia.com")) return Promise.resolve(new Response(JSON.stringify(HN)));
      if (url.includes("youtube.com/feeds/videos.xml")) {
        return Promise.resolve(new Response(ATOM, { status: 200, headers: { "content-type": "text/xml" } }));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    }),
  );
}

function jevAnswering() {
  return vi.fn((_model: string, input: { state: { item: { title: string } }; questions: Record<string, unknown> }) => {
    const [questionId] = Object.keys(input.questions);
    const homonym = /winds|wind god/.test(input.state.item.title);
    const p = questionId === "mention_is_about_brand" ? (homonym ? 0.03 : 0.96) : 0.94;
    return Promise.resolve({ answers: { [questionId ?? ""]: { type: "noul", noul: p } } });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(env, "AI");
});

describe("J9 mentions land from three sources", () => {
  it("stores news, Hacker News and a YouTube channel feed, and drops the homonym on each", async () => {
    const workspaceId = "ws-j9";
    const competitorId = "ws-j9-competitor";
    const identity = JSON.stringify({
      socials: [{ platform: "youtube", url: `https://www.youtube.com/channel/${CHANNEL_ID}` }],
    });
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (\'user-j9\', \'user-j9\', \'user-j9@example.com\', 1, ?1, ?1)',
      ).bind(NOW),
      env.DB.prepare(
        "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', 'user-j9', 'UTC', 1, 8, ?2)",
      ).bind(workspaceId, NOW),
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES ('ws-j9-self', ?1, 'self', 'gymshark-j9.com', 'Gymshark', '{\"description\":\"Gym clothing\"}', ?2)",
      ).bind(workspaceId, NOW),
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'competitor', 'zephyrwear-j9.com', ?3, ?4, ?5)",
      ).bind(competitorId, workspaceId, BRAND, identity, NOW),
    ]);
    stubUpstreams();
    Reflect.set(env, "AI", { run: jevAnswering() });

    const targets = (await planTargets()).filter((entry) => entry.watches.some((w) => w.entity_id === competitorId));
    expect(targets.map((entry) => entry.pluginKey).sort()).toEqual(["gdelt.doc", "hn.algolia", "youtube.channel_rss"]);

    const outcomes = new Map<string, { items: number; stored: number; unjudged: number }>();
    for (const target of targets) {
      outcomes.set(target.pluginKey, await sweepTarget(target, NOW, null));
    }
    expect(Object.fromEntries(outcomes)).toEqual({
      "gdelt.doc": { items: 2, stored: 1, unjudged: 0 },
      "hn.algolia": { items: 2, stored: 1, unjudged: 0 },
      "youtube.channel_rss": { items: 2, stored: 1, unjudged: 0 },
    });

    const rows = await env.DB.prepare(
      `SELECT s.plugin_key AS plugin_key, sg.title AS title, sg.is_tombstoned AS tombstoned
       FROM signal sg JOIN source s ON s.id = sg.source_id
       WHERE sg.entity_id = ?1 AND sg.kind = 'mention'
       ORDER BY s.plugin_key, sg.title`,
    )
      .bind(competitorId)
      .all<{ plugin_key: string; title: string; tombstoned: number }>();
    expect(rows.results.map((row) => [row.plugin_key, row.title, row.tombstoned])).toEqual([
      ["gdelt.doc", "Zephyr winds expected this weekend", 1],
      ["gdelt.doc", "Zephyrwear J9 opens a London flagship", 0],
      ["hn.algolia", "Zephyr J9 the Greek wind god, a thread", 1],
      ["hn.algolia", "Zephyrwear J9 raises a Series B", 0],
      ["youtube.channel_rss", "Zephyr J9 winds explained for pilots", 1],
      ["youtube.channel_rss", "Zephyrwear J9 autumn campaign film", 0],
    ]);

    const alerts = await env.DB.prepare("SELECT title FROM alert WHERE workspace_id = ?1 AND kind = 'mention' ORDER BY title")
      .bind(workspaceId)
      .all<{ title: string }>();
    expect(alerts.results.map((row) => row.title)).toEqual([
      `${BRAND}: Zephyrwear J9 autumn campaign film`,
      `${BRAND}: Zephyrwear J9 opens a London flagship`,
      `${BRAND}: Zephyrwear J9 raises a Series B`,
    ]);
  });
});
