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

  it("ingests a feed item with the observed timestamp when pubDate is invalid (no throw)", async () => {
    // An unparseable pubDate used to throw RangeError inside parseFeedItems:
    // manual "Check now" returned a 500 and the scheduled poll cursor was never
    // updated, silently killing monitoring for the source.
    const rss = `<rss><channel><item><title>x</title><link>https://a.test/1</link><pubDate>not-a-date</pubDate></item></channel></rss>`;

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
    expect(poll.items[0]?.publishedAt).toBe(poll.items[0]?.observedAt);
  });

  it("does not fabricate a change when only hidden page markup differs between polls", async () => {
    // Two polls of the same page whose HTML differs only in an injected
    // <meta name="csrf-token" content="..."> within the first 500 chars.
    // The page-snapshot contentHash must be computed over the same normalized
    // text that is stored (stripHtml excerpt), not raw HTML — otherwise every
    // poll records a phantom "website change" for a page that never changed.
    const buildHtml = (csrfToken: string) =>
      `<html><head><title>Stable page</title><meta name="csrf-token" content="${csrfToken}">` +
      `</head><body><h1>Stable heading</h1><p>Stable page copy about the roadmap.</p></body></html>`;

    let pollIndex = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: FiveToNinePresenceBot\nAllow: /", { status: 200 });
      }
      if (url === "https://1.1.1.1" || url === "https://1.1.1.1/") {
        pollIndex += 1;
        // Calls 1-2 belong to poll #1 (discovery + page change), 3-4 to poll #2.
        const html = pollIndex <= 2 ? buildHtml("tok-first-visit") : buildHtml("tok-second-visit");
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      // No feed anywhere: guessed feed candidates must miss.
      return new Response("not found", { status: 404 });
    });

    const first = await websiteConnector.poll(
      { env: baseEnv, userId: "u1", trackingMode: "competitor", fetchImpl: fetchImpl as unknown as typeof fetch },
      { targetUrl: "https://1.1.1.1", metadata: {} },
    );
    expect(first.ok).toBe(true);
    expect(first.items).toHaveLength(1);

    const second = await websiteConnector.poll(
      { env: baseEnv, userId: "u1", trackingMode: "competitor", fetchImpl: fetchImpl as unknown as typeof fetch },
      { targetUrl: "https://1.1.1.1", metadata: {} },
    );
    expect(second.ok).toBe(true);
    expect(second.items).toHaveLength(1);

    // Identical visible page => identical content hash (no phantom change).
    expect(second.items[0]?.contentHash).toBe(first.items[0]?.contentHash);
  });
});
