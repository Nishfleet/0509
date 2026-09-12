import { describe, expect, it } from "vitest";

import {
  enforcePublicBrandPageRateLimit,
  PUBLIC_BRAND_PAGE_LIMIT,
} from "~/lib/rate-limit.server";

import { appEnv } from "./fixtures";

/**
 * Issue #2062 — a verified search crawler (Cloudflare verified-bot categories:
 * Googlebot, Bingbot) recrawling the 87-URL sitemap (/ads/:domain +
 * /timeline/:domain) must never be 429'd, while an anonymous human keeps the
 * #1972 budget.
 *
 * This runs the REAL limiter (`enforcePublicBrandPageRateLimit`) against the
 * REAL D1 built by applying the repo's real migrations
 * (tests/integration/apply-migrations.ts) — no mocked binding. The verified-bot
 * request shape is monkeypatched via the `cf-verified-bot: true` header, which
 * is exactly what Cloudflare sets for bots it has verified against the
 * operators' published IP ranges.
 *
 * The two assertions share one IP and the shared "/ads/:domain" bucket, so the
 * anonymous check is meaningful: had the crawler's requests counted against the
 * bucket, the anonymous client would hit the 120/10min ceiling far earlier.
 */
const VERIFIED_BOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

function brandPageRequest(path: string, headers: Record<string, string> = {}) {
  return new Request(`https://0509.io${path}`, {
    headers: {
      "cf-connecting-ip": "203.0.113.50",
      "user-agent": "anonymous-client",
      ...headers,
    },
  });
}

describe("rate-limit verified-bot exemption (issue #2062)", () => {
  it("lets a verified crawler sweep 100 sequential sitemap URLs without a single 429", async () => {
    for (let index = 0; index < 100; index += 1) {
      const path = index % 2 === 0 ? `/ads/domain-${index}.com` : `/timeline/domain-${index}.com`;
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(path, {
          "cf-verified-bot": "true",
          "user-agent": VERIFIED_BOT_UA,
        }),
        appEnv,
      );
      expect(response, `verified bot should never be 429 on ${path}`).toBeNull();
    }
  });

  it("does not let the verified-bot sweep consume the anonymous brand-page budget", async () => {
    // The crawler's 100 requests above recorded no rate-limit events, so a
    // fresh anonymous client on the same IP still gets its full
    // PUBLIC_BRAND_PAGE_LIMIT/10min budget (raised 120 -> 600 in #3156) before
    // the one-past-the-limit request is 429. If the exemption were broken, the
    // shared bucket would already be 100 events deep and this would trip far
    // earlier. Derived from the exported constant so a future limit change
    // cannot silently orphan this test again.
    for (let index = 0; index < PUBLIC_BRAND_PAGE_LIMIT; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(`/ads/anon-${index}.com`),
        appEnv,
      );
      expect(response).toBeNull();
    }
    const blocked = await enforcePublicBrandPageRateLimit(
      brandPageRequest("/ads/anon-overflow.com"),
      appEnv,
    );
    expect(blocked?.status).toBe(429);
  });
});
