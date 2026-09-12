import { describe, expect, it } from "vitest";

import { CANARY_TOKEN_HEADER } from "~/lib/canary-release-identity.server";
import { enforcePublicBrandPageRateLimit } from "~/lib/rate-limit.server";

import { appEnv } from "./fixtures";

/**
 * Issue #3166 — the sitemap-coverage canary probes EVERY advertised URL,
 * including the whole /ads/:domain + /timeline/:domain cohort (~134 URLs)
 * in one run. That exceeds the 120/10min shared per-IP public-brand-page
 * budget, so the canary would 429 its own tail and report false-red. The
 * x-0509-canary-token header gets the same scoped exemption a verified
 * crawler (cf-verified-bot, issue #2062) has — and only that scope.
 *
 * Runs the REAL limiter against the REAL D1 (tests/integration/apply-
 * migrations.ts), same as the verified-bot sibling spec. The brand-page
 * bucket is keyed by IP only, so each test runs on its own IP.
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
  it("lets a token-holding canary sweep past the 120/10min brand-page budget", async () => {
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
    // The exempted probes above recorded no rate-limit events, so an
    // anonymous client on the same IP still gets its full 120 budget.
    for (let index = 0; index < 120; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(ip, `/ads/anon-${index}.com`),
        envWithToken,
      );
      expect(response).toBeNull();
    }
    const blocked = await enforcePublicBrandPageRateLimit(
      brandPageRequest(ip, "/ads/anon-overflow.com"),
      envWithToken,
    );
    expect(blocked?.status).toBe(429);
  });

  it("keeps the budget enforced for a wrong or missing token", async () => {
    const ip = "203.0.113.62";
    for (let index = 0; index < 120; index += 1) {
      const response = await enforcePublicBrandPageRateLimit(
        brandPageRequest(ip, `/ads/wrong-${index}.com`, {
          [CANARY_TOKEN_HEADER]: "not-the-token",
        }),
        envWithToken,
      );
      expect(response).toBeNull();
    }
    const blocked = await enforcePublicBrandPageRateLimit(
      brandPageRequest(ip, "/ads/wrong-overflow.com", {
        [CANARY_TOKEN_HEADER]: "not-the-token",
      }),
      envWithToken,
    );
    expect(blocked?.status).toBe(429);
  });
});
