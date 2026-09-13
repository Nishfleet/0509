import { describe, expect, it } from "vitest";

import { CANARY_TOKEN_HEADER } from "~/lib/canary-release-identity.server";
import {
  enforcePublicBrandPageRateLimit,
  PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT,
} from "~/lib/rate-limit.server";

import { appEnv } from "./fixtures";

/**
 * Issue #3166 — the sitemap-coverage canary probes EVERY advertised URL,
 * including the whole /ads/:domain + /timeline/:domain cohort (~134 URLs)
 * in one run. That exceeds the enforced public-brand-page budget
 * (PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT per 60s — #2985's sustained parity
 * with the old 120/10min D1 bucket), so the canary would 429 its own tail
 * and report false-red. The x-0509-canary-token header gets the same
 * scoped exemption a verified crawler (cf-verified-bot, issue #2062) has —
 * and only that scope.
 *
 * Runs the REAL limiter against the REAL edge bindings and the REAL D1
 * (tests/integration/apply-migrations.ts), same as the verified-bot
 * sibling spec. The brand-page bucket is keyed by IP only, so each test
 * runs on its own IP.
 */
const CANARY_TOKEN = "sitemap-coverage-test-token";
const envWithToken = { ...appEnv, CANARY_BYPASS_TOKEN: CANARY_TOKEN };

function brandPageRequest(
  ip: string,
  path: string,
  headers: Record<string, string> = {},
) {
  return new Request(`https://0509.io${path}`, {
    headers: {
      "cf-connecting-ip": ip,
      "user-agent": "0509-sitemap-coverage-canary/1.0",
      ...headers,
    },
  });
}

describe("rate-limit canary-token exemption (issue #3166)", () => {
  it("lets a token-holding canary sweep past the enforced brand-page budget", async () => {
    const ip = "203.0.113.60";
    for (let index = 0; index < 140; index += 1) {
      const path =
        index % 2 === 0
          ? `/ads/canary-${index}.com`
          : `/timeline/canary-${index}.com`;
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(ip, path, { [CANARY_TOKEN_HEADER]: CANARY_TOKEN }),
        envWithToken,
      );
      expect(response, `canary should never be 429 on ${path}`).toBeNull();
    }
  });

  it("does not let the canary sweep consume the anonymous brand-page budget", async () => {
    const ip = "203.0.113.61";
    for (let index = 0; index < 140; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(ip, `/ads/canary-${index}.com`, {
          [CANARY_TOKEN_HEADER]: CANARY_TOKEN,
        }),
        envWithToken,
      );
      expect(response).toBeNull();
    }
    // The exempted probes above are returned before the edge binding is
    // ever consulted, so an anonymous client on the same IP still gets its
    // full fresh budget: the first PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT
    // requests all pass (deterministic — no window can have counted more
    // than these requests). Had the exemption been broken, the shared
    // bucket would already be 140 events deep and this would trip far
    // earlier.
    for (let index = 0; index < PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(ip, `/ads/anon-${index}.com`),
        envWithToken,
      );
      expect(response, `anonymous request ${index} should pass on a fresh budget`).toBeNull();
    }
    // The budget then exhausts. Local edge windows are 60s and these calls
    // are fast, so a 429 is guaranteed well inside a bounded overshoot
    // loop; the cap only absorbs a window boundary falling mid-loop, which
    // would otherwise grant one fresh window's worth of extra capacity.
    let blocked: Response | null = null;
    const overshootCap = 3 * PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT + 4;
    for (let index = 0; index < overshootCap; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(ip, `/ads/anon-overflow-${index}.com`),
        envWithToken,
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

  it("keeps the budget enforced for a wrong or missing token", async () => {
    // A wrong token buys no exemption: the holder counts against the same
    // enforced budget, so the first PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT
    // wrong-token requests pass and the budget then exhausts — the
    // overshoot loop absorbs a window boundary mid-run exactly as the
    // anonymous case does.
    const ip = "203.0.113.62";
    for (let index = 0; index < PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(ip, `/ads/wrong-${index}.com`, {
          [CANARY_TOKEN_HEADER]: "not-the-token",
        }),
        envWithToken,
      );
      expect(response, `wrong-token request ${index} should pass within the budget`).toBeNull();
    }
    let blocked: Response | null = null;
    const overshootCap = 3 * PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT + 4;
    for (let index = 0; index < overshootCap; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(ip, `/ads/wrong-overflow-${index}.com`, {
          [CANARY_TOKEN_HEADER]: "not-the-token",
        }),
        envWithToken,
      );
      if (response) {
        blocked = response;
        break;
      }
    }
    expect(blocked, `expected a 429 within ${overshootCap} over-budget requests`).not.toBeNull();
    expect(blocked?.status).toBe(429);
  });
});
