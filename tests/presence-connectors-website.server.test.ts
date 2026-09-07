import { describe, expect, it, vi } from "vitest";

import { websiteConnector } from "~/lib/presence-connectors/website.server";

import type { AppEnv } from "~/lib/env.server";

const baseEnv = {
  META_TOKEN_ENCRYPTION_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://0509.io",
  PRESENCE_WEBSITE_ROLLOUT: "internal",
  PRESENCE_INTERNAL_WORKSPACE_ID: "internal-ws",
  PRESENCE_X_ROLLOUT: "disabled",
  PRESENCE_REDDIT_ROLLOUT: "disabled",
  PRESENCE_LINKEDIN_ROLLOUT: "disabled",
} satisfies Partial<AppEnv> as AppEnv;

describe("presence website connector decode wiring", () => {
  it("decodes feed item titles and excerpts once (no double-escape)", async () => {
    // RSS with HTML entities in title and description. The connector must
    // decode each entity at most once via the shared decoder.
    const rss = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>Tom &amp; Jerry &lt;3</title>
        <link>https://1.1.1.1/post</link>
        <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
        <description>a &amp; b &quot;q&quot; &#39;s&#39;</description>
      </item>
    </channel></rss>`;

    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: FiveToNinePresenceBot\nAllow: /", { status: 200 });
      }
      if (url.includes("/feed")) {
        return new Response(rss, {
          status: 200,
          headers: { "content-type": "application/rss+xml", etag: '"abc"' },
        });
      }
      return new Response(
        '<html><head><link rel="alternate" type="application/rss+xml" href="/feed"/></head></html>',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });

    const poll = await websiteConnector.poll(
      { env: baseEnv, userId: "u1", trackingMode: "competitor", fetchImpl: fetchImpl as typeof fetch },
      { targetUrl: "https://1.1.1.1", metadata: {} },
    );

    expect(poll.ok).toBe(true);
    expect(poll.items).toHaveLength(1);
    // Single decode pass: &amp; -> &, &lt; -> <, &quot; -> ", &#39; -> '.
    expect(poll.items[0]?.title).toBe("Tom & Jerry <3");
    expect(poll.items[0]?.bodyExcerpt).toBe('a & b "q" \'s\'');
  });

  it("does not double-decode an already-decoded ampersand in feed text", async () => {
    // The description is already decoded once (bare &). The connector must not
    // re-emit &amp; or otherwise mutate it.
    const rss = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>plain</title>
        <link>https://1.1.1.1/post</link>
        <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
        <description>a & b already decoded</description>
      </item>
    </channel></rss>`;

    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: FiveToNinePresenceBot\nAllow: /", { status: 200 });
      }
      if (url.includes("/feed")) {
        return new Response(rss, {
          status: 200,
          headers: { "content-type": "application/rss+xml", etag: '"abc"' },
        });
      }
      return new Response(
        '<html><head><link rel="alternate" type="application/rss+xml" href="/feed"/></head></html>',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });

    const poll = await websiteConnector.poll(
      { env: baseEnv, userId: "u1", trackingMode: "competitor", fetchImpl: fetchImpl as typeof fetch },
      { targetUrl: "https://1.1.1.1", metadata: {} },
    );

    expect(poll.ok).toBe(true);
    expect(poll.items[0]?.bodyExcerpt).toBe("a & b already decoded");
  });
});
