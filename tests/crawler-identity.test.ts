import { describe, expect, it } from "vitest";

import { CRAWLER_USER_AGENT, ROBOTS_AGENT } from "../app/lib/fetch/crawler-identity";

function contactUrl(userAgent: string): URL {
  const inside = userAgent.match(/\(([^)]*)\)/);
  if (inside === null) throw new Error(`no parenthesised contact url in ${userAgent}`);
  return new URL(inside[1].replace(/^\+/, ""));
}

describe("the crawler's robots token", () => {
  it("is the bare product token a robots.txt group names", () => {
    expect(ROBOTS_AGENT).toBe("FiveToNineBot");
  });

  it("holds only characters a robots.txt product token allows", () => {
    expect(ROBOTS_AGENT).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("the crawler's user agent", () => {
  it("is the robots token, a version and the contact url", () => {
    expect(CRAWLER_USER_AGENT).toBe("FiveToNineBot/1.0 (+https://0509.io)");
  });

  it("stays headed by the token robots.txt rules are matched against", () => {
    expect(CRAWLER_USER_AGENT.startsWith(`${ROBOTS_AGENT}/`)).toBe(true);
  });

  it("carries a contact url on 0509.io inside the parentheses", () => {
    const url = contactUrl(CRAWLER_USER_AGENT);
    expect(url.hostname).toBe("0509.io");
    expect(url.protocol).toBe("https:");
  });
});
