import { describe, expect, it } from "vitest";

import {
  enforcePublicBrandPageRateLimit,
  PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT,
} from "~/lib/rate-limit.server";

import { appEnv } from "./fixtures";

/**
 * Issue #3278 — the programmatic-SEO live canary
 * (`ads-prog-seo-canary.yml`) sweeps every sitemap /ads/:domain URL (127
 * today) in one burst, well past the public-brand-page budget (12/60s,
 * issue #2985). Without a bypass the canary red's for a transport reason
 * (429), masking the noindex/redirect drift it is built to catch.
 *
 * This runs the REAL limiter (`enforcePublicBrandPageRateLimit`) against the
 * REAL edge bindings (the RL_* bindings declared in wrangler.test.jsonc,
 * mirroring production) and the REAL D1 built by applying the repo's real
 * migrations — no mocked binding. The canary-token shape is monkeypatched
 * by setting CANARY_BYPASS_TOKEN on the env we hand the limiter, the same
 * shape production uses (env-var from `wrangler secret put`).
 *
 * The token check is constant-time at the limiter; this integration test
 * proves the end-to-end behavior the SEO canary workflow depends on: with a
 * valid token the canary sweeps the entire 127-URL sitemap without a single
 * 429, and a forged/missing token still gets the anonymous budget.
 */
const CANARY_TOKEN = "secret-token";

/**
 * Fresh anonymous budget per test: the edge Rate Limiting binding counts per
 * key (scope|client-ip), so every test drives ONE stable IP for its whole
 * body — a new IP per request would mint a fresh bucket each time and a
 * "budget exhausts" assertion would never fire. Tests share no IP, so a
 * bucket one test exhausts cannot bleed into another. TEST-NET-3 (RFC 5737).
 */
function brandPageRequest(
  path: string,
  clientIp: string,
  headers: Record<string, string> = {},
) {
  return new Request(`https://0509.io${path}`, {
    headers: {
      "cf-connecting-ip": clientIp,
      "user-agent": "canary-client",
      ...headers,
    },
  });
}

// Build a fresh env that mirrors the wrangler.test.jsonc bindings but lets
// each test pick its own CANARY_BYPASS_TOKEN — production wires the secret
// in via `wrangler secret put CANARY_BYPASS_TOKEN`, and the limiter reads
// it straight off env. Reusing appEnv directly would force one fixed token
// across every test, hiding the fail-closed path.
function envWithToken(token: string | null) {
  const { CANARY_BYPASS_TOKEN: _strip, ...rest } = appEnv as Record<string, unknown>;
  return token === null ? rest : { ...rest, CANARY_BYPASS_TOKEN: token };
}

describe("rate-limit canary-token bypass (issue #3278)", () => {
  it("lets an authenticated canary sweep 127 sequential sitemap URLs without a single 429", async () => {
    const env = envWithToken(CANARY_TOKEN);

    for (let index = 0; index < 127; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(`/ads/domain-${index}.com`, "203.0.113.61", {
          "x-0509-canary-token": CANARY_TOKEN,
        }),
        env,
      );
      expect(response, `canary request ${index} should never 429 once authenticated`).toBeNull();
    }
  });

  it("does not let the canary sweep consume the anonymous brand-page budget", async () => {
    // The canary's 127 requests above are exempt before the edge binding is
    // ever consulted, so a fresh anonymous client on the same IP still gets
    // its full fresh budget: the first PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT
    // requests all pass (deterministic — no window can have counted more
    // than these requests). If the exemption were broken, the shared bucket
    // would already be 127 events deep and the first anonymous request would
    // 429.
    const env = envWithToken(CANARY_TOKEN);

    for (let index = 0; index < PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(`/ads/anon-${index}.com`, "203.0.113.62"),
        env,
      );
      expect(response, `anonymous request ${index} should pass on a fresh budget`).toBeNull();
    }
    let blocked: Response | null = null;
    const overshootCap = 3 * PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT + 4;
    for (let index = 0; index < overshootCap; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(`/ads/anon-overflow-${index}.com`, "203.0.113.62"),
        env,
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

  it("still 429s a canary request with a wrong token", async () => {
    const env = envWithToken(CANARY_TOKEN);

    for (let index = 0; index < PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(`/ads/wrong-${index}.com`, "203.0.113.63", {
          "x-0509-canary-token": "wrong-token",
        }),
        env,
      );
      expect(response).toBeNull();
    }
    const blocked = await enforcePublicBrandPageRateLimit(
      brandPageRequest(`/ads/wrong-overflow.com`, "203.0.113.63", {
        "x-0509-canary-token": "wrong-token",
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });

  it("still 429s when CANARY_BYPASS_TOKEN is unset (fail-closed on the bypass)", async () => {
    // No CANARY_BYPASS_TOKEN: the limiter must NOT silently grant unlimited
    // access if the secret is missing in production.
    const env = envWithToken(null);

    for (let index = 0; index < PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(`/ads/no-token-${index}.com`, "203.0.113.64", {
          "x-0509-canary-token": CANARY_TOKEN,
        }),
        env,
      );
      expect(response).toBeNull();
    }
    const blocked = await enforcePublicBrandPageRateLimit(
      brandPageRequest(`/ads/no-token-overflow.com`, "203.0.113.64", {
        "x-0509-canary-token": CANARY_TOKEN,
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });
});
