import { describe, expect, it } from "vitest";

import {
  enforcePublicBrandPageRateLimit,
  enforceRequestRateLimit,
  PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT,
} from "~/lib/rate-limit.server";

import { createFakeEdgeLimiters } from "./helpers/rate-limit-edge-kit";

/**
 * Issue #3278 — the SEO canary sweeps every sitemap /ads/:domain URL in one
 * run — at 127 URLs that exceeds the public-brand-page budget (12/60s)
 * several times over and trips the very limiter it is supposed to be
 * measuring. An authenticated canary request (x-0509-canary-token matching
 * env.CANARY_BYPASS_TOKEN) bypasses the limiter so the canary can fetch
 * every URL and report on the actual noindex/redirect drift it was built
 * to catch.
 *
 * These tests moved here from tests/rate-limit.server.test.ts when the
 * #3278 additions pushed that file past the tests/ 800-line ratchet
 * (tests/file-size-ratchet.test.ts); the shared edge-binding fake now lives
 * in ./helpers/rate-limit-edge-kit.ts.
 */
describe("enforcePublicBrandPageRateLimit canary-token bypass (#3278)", () => {
  it("exempts a canary-token request from the public-brand-page budget", async () => {
    const { env } = createFakeEdgeLimiters();
    (env as { CANARY_BYPASS_TOKEN?: string }).CANARY_BYPASS_TOKEN = "secret-token";

    // 5× the budget, every request from the same IP — would 429 long before
    // this completes if the bypass did not hold.
    const totalRequests = PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT * 5;
    for (let index = 0; index < totalRequests; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        new Request(`https://0509.io/ads/domain-${index}.com`, {
          headers: {
            "cf-connecting-ip": "203.0.113.31",
            "user-agent": "vitest",
            "x-0509-canary-token": "secret-token",
          },
        }),
        env,
      );
      expect(
        response,
        `canary request ${index} should never 429 once authenticated`,
      ).toBeNull();
    }
  });

  it("still 429s a canary-token request when the token does not match", async () => {
    const { env } = createFakeEdgeLimiters();
    (env as { CANARY_BYPASS_TOKEN?: string }).CANARY_BYPASS_TOKEN = "secret-token";

    // Wrong token: same anonymous budget applies.
    for (let index = 0; index < PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT; index += 1) {
      await expect(
        enforcePublicBrandPageRateLimit(
          new Request(`https://0509.io/ads/domain-${index}.com`, {
            headers: {
              "cf-connecting-ip": "203.0.113.32",
              "user-agent": "vitest",
              "x-0509-canary-token": "wrong-token",
            },
          }),
          env,
        ),
      ).resolves.toBeNull();
    }
    const blocked = await enforcePublicBrandPageRateLimit(
      new Request("https://0509.io/ads/domain-overflow.com", {
        headers: {
          "cf-connecting-ip": "203.0.113.32",
          "user-agent": "vitest",
          "x-0509-canary-token": "wrong-token",
        },
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });

  it("still 429s when CANARY_BYPASS_TOKEN is unset (fail-closed on bypass)", async () => {
    const { env } = createFakeEdgeLimiters();
    // No CANARY_BYPASS_TOKEN on env — the bypass must NOT silently grant
    // unlimited access if the secret is missing in production.

    for (let index = 0; index < PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT; index += 1) {
      await expect(
        enforcePublicBrandPageRateLimit(
          new Request(`https://0509.io/ads/domain-${index}.com`, {
            headers: {
              "cf-connecting-ip": "203.0.113.33",
              "user-agent": "vitest",
              "x-0509-canary-token": "secret-token",
            },
          }),
          env,
        ),
      ).resolves.toBeNull();
    }
    const blocked = await enforcePublicBrandPageRateLimit(
      new Request("https://0509.io/ads/domain-overflow.com", {
        headers: {
          "cf-connecting-ip": "203.0.113.33",
          "user-agent": "vitest",
          "x-0509-canary-token": "secret-token",
        },
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });

  it("does NOT exempt auth, write, or share-pdf scopes — the bypass is scope-scoped to public-brand-page only", async () => {
    // The canary-token bypass is intentionally narrow: only the
    // public-brand-page scope, so a stolen token cannot unlock auth, write,
    // or share-pdf. This test pins the scope fence: a canary-token request
    // on a NON-brand-page route still 429s at its own anonymous budget, so a
    // forged header buys nothing outside the SEO canary's actual hit
    // surface. We use /api/demo-proof (RL_PROOF_BRIEF, 3/60s) because its
    // tight budget makes the over-budget assertion deterministic.
    const { env } = createFakeEdgeLimiters();
    (env as { CANARY_BYPASS_TOKEN?: string }).CANARY_BYPASS_TOKEN = "secret-token";

    const proofBriefLimit = 3;
    for (let index = 0; index < proofBriefLimit; index += 1) {
      const response = await enforceRequestRateLimit(
        new Request("https://0509.io/api/demo-proof", {
          method: "GET",
          headers: {
            "cf-connecting-ip": "203.0.113.34",
            "user-agent": "vitest",
            "x-0509-canary-token": "secret-token",
          },
        }),
        env,
      );
      expect(response, `canary-token request ${index} on /api/demo-proof should still count`).toBeNull();
    }
    const blocked = await enforceRequestRateLimit(
      new Request("https://0509.io/api/demo-proof", {
        method: "GET",
        headers: {
          "cf-connecting-ip": "203.0.113.34",
          "user-agent": "vitest",
          "x-0509-canary-token": "secret-token",
        },
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });
});
