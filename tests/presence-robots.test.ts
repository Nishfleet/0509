import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertRobotsAllowedForUrls,
  clearRobotsCacheForTests,
  isRobotsAllowed,
  parseRobotsTxt,
  PRESENCE_BOT_NAME,
  PRESENCE_USER_AGENT,
} from "~/lib/presence-robots.server";

describe("presence robots parser", () => {
  it("uses FiveToNinePresenceBot user agent token", () => {
    expect(PRESENCE_BOT_NAME).toBe("FiveToNinePresenceBot");
    expect(PRESENCE_USER_AGENT).toContain("FiveToNinePresenceBot");
    expect(PRESENCE_USER_AGENT).toContain("0509.io/bots/presence");
  });

  it("parses allow/disallow groups with longest-match precedence", () => {
    const parsed = parseRobotsTxt(`
User-agent: *
Disallow: /private
Allow: /private/ok

User-agent: ${PRESENCE_BOT_NAME}
Disallow: /admin
Allow: /admin/public
`);
    expect(isRobotsAllowed({ status: "ok", fetchedAt: "", sitemaps: [], rules: parsed.rules }, "https://example.com/admin/public")).toBe(true);
    expect(isRobotsAllowed({ status: "ok", fetchedAt: "", sitemaps: [], rules: parsed.rules }, "https://example.com/admin/secret")).toBe(false);
  });

  it("supports wildcard and end-anchor rules", () => {
    const parsed = parseRobotsTxt(`
User-agent: ${PRESENCE_BOT_NAME}
Disallow: /*.pdf$
Allow: /
`);
    expect(isRobotsAllowed({ status: "ok", fetchedAt: "", sitemaps: [], rules: parsed.rules }, "https://example.com/file.pdf")).toBe(false);
    expect(isRobotsAllowed({ status: "ok", fetchedAt: "", sitemaps: [], rules: parsed.rules }, "https://example.com/file.pdfx")).toBe(true);
  });

  it("collects sitemap directives", () => {
    const parsed = parseRobotsTxt(`
Sitemap: https://example.com/sitemap.xml
User-agent: *
Disallow:
`);
    expect(parsed.sitemaps).toContain("https://example.com/sitemap.xml");
  });
});

describe("presence robots fetch policy", () => {
  beforeEach(() => {
    clearRobotsCacheForTests();
  });

  it("blocks crawling when robots.txt returns 404", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("not found", { status: 404 });
      }
      return new Response("ok", { status: 200 });
    });

    const result = await assertRobotsAllowedForUrls(
      "https://example.com",
      ["https://example.com/feed"],
      fetchImpl as typeof fetch,
    );
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("robots_unavailable");
  });

  it("blocks crawling when robots.txt returns 500", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("error", { status: 500 });
      }
      return new Response("ok", { status: 200 });
    });

    const result = await assertRobotsAllowedForUrls(
      "https://example.com",
      ["https://example.com/feed"],
      fetchImpl as typeof fetch,
    );
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("robots_fetch_failed");
  });

  it("obeys disallow rules from 200 robots.txt before fetch", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response(`User-agent: ${PRESENCE_BOT_NAME}\nDisallow: /feed`, { status: 200 });
      }
      return new Response("feed", { status: 200 });
    });

    const result = await assertRobotsAllowedForUrls(
      "https://example.com",
      ["https://example.com/feed"],
      fetchImpl as typeof fetch,
    );
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("robots_disallowed");
  });

  it("allows paths when robots.txt permits crawling", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response(`User-agent: ${PRESENCE_BOT_NAME}\nAllow: /`, { status: 200 });
      }
      return new Response("ok", { status: 200 });
    });

    const result = await assertRobotsAllowedForUrls(
      "https://example.com",
      ["https://example.com/feed"],
      fetchImpl as typeof fetch,
    );
    expect(result.allowed).toBe(true);
  });
});
