import { describe, expect, it } from "vitest";

import {
  enforcePublicBrandPageRateLimit,
  PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT,
} from "~/lib/rate-limit.server";

import { appEnv } from "./fixtures";

/**
 * Issue #2062 — a verified search crawler (Cloudflare verified-bot categories:
 * Googlebot, Bingbot) recrawling the 87-URL sitemap (/ads/:domain +
 * /timeline/:domain) must never be 429'd, while an anonymous human keeps the
 * public brand-page budget (now the #2985 edge Rate Limiting binding:
 * PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT per 60s, sustained parity with the old
 * 120/10min D1 bucket).
 *
 * This runs the REAL limiter (`enforcePublicBrandPageRateLimit`) against the
 * REAL edge bindings (the RL_* bindings declared in wrangler.test.jsonc, mirroring
 * production) and the REAL D1 built by applying the repo's real migrations
 * (tests/integration/apply-migrations.ts) — no mocked binding. The verified-bot
 * request shape is monkeypatched via the `cf-verified-bot: true` header, which
 * is exactly what Cloudflare sets for bots it has verified against the
 * operators' published IP ranges.
 *
 * Both assertions share one IP, so the anonymous check is meaningful: had the
 * crawler's requests consumed the edge bucket, the anonymous client would hit
 * the per-minute ceiling far earlier than its full fresh budget.
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
    // The crawler's 100 requests above are exempt before the edge binding is
    // ever consulted, so a fresh anonymous client on the same IP still gets
    // its full fresh budget: the first PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT
    // requests all pass (deterministic — no window can have counted more
    // than these requests). If the exemption were broken, the shared bucket
    // would already be 100 events deep and this would trip far earlier.
    for (let index = 0; index < PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(`/ads/anon-${index}.com`),
        appEnv,
      );
      expect(response, `anonymous request ${index} should pass on a fresh budget`).toBeNull();
    }
    // The budget then exhausts. Local edge windows are 60s and these calls
    // are fast, so a 429 is guaranteed well inside a bounded overshoot loop;
    // the cap only absorbs a window boundary falling mid-loop, which would
    // otherwise grant one fresh window's worth of extra capacity.
    let blocked: Response | null = null;
    const overshootCap = 3 * PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT + 4;
    for (let index = 0; index < overshootCap; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(`/ads/anon-overflow-${index}.com`),
        appEnv,
      );
      if (response) {
        blocked = response;
        break;
      }
    }
    expect(blocked, `expected a 429 within ${overshootCap} over-budget requests`).not.toBeNull();
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("retry-after")).toBeTruthy();
  });
});
