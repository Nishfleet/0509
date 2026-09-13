import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  enforceAuthenticatedSearchRateLimit,
  enforceBillingProviderRateLimit,
  enforcePublicBrandPageRateLimit,
  enforcePublicSearchRateLimit,
  enforcePublicSearchSelectionRateLimit,
  enforceRequestRateLimit,
  enforceSearchSelectionRateLimit,
  AUTH_ANON_GET_PER_MINUTE_LIMIT,
  PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT,
  PUBLIC_PROOF_BRIEF_PER_MINUTE_LIMIT,
  PUBLIC_SEARCH_ANON_BROWSER_LIMIT,
  PUBLIC_SEARCH_IP_BACKSTOP_LIMIT,
  PUBLIC_SEARCH_SELECTION_PER_MINUTE_LIMIT,
  rateLimitPolicyFor,
} from "~/lib/rate-limit.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * Issue #2985: the public hot-path scopes (auth, public search, brand pages,
 * public API reads incl. /api/demo-proof, /status) are enforced by the native
 * Cloudflare Rate Limiting binding and touch NO D1, and they FAIL CLOSED with
 * 429 + Retry-After. Only cost-bearing scopes (account search, warm
 * selection, billing provider, share PDF) still reserve capacity in D1 via
 * the one-statement atomic claim.
 */

// Mirrors the RL_* binding capacities declared in wrangler.jsonc (issue
// #2985): capacity lives ON the binding and the runtime call is
// `limit({ key })`, so the fake enforces the same per-binding limit the
// platform would. Each policy's scope is part of the key, so per-binding
// counting against the configured limit matches production semantics.
const EDGE_BINDING_LIMITS: Record<string, number> = {
  RL_AUTH: 2,
  RL_AUTH_GET: 60,
  RL_SEARCH_ANON_BROWSER: 2,
  RL_PROOF_BRIEF: 3,
  RL_SEARCH_SELECTION: 3,
  RL_SEARCH_IP: 10,
  RL_BRAND_PAGE: 12,
  RL_WRITE: 60,
  RL_STATUS: 120,
  RL_DELIVERY_WEBHOOK: 180,
  RL_API_READ: 240,
  RL_WEBHOOK: 300,
};

function createFakeEdgeLimiters(options?: {
  failures?: (key: string) => boolean;
  throwOn?: (key: string) => boolean;
}): { env: AppEnv } {
  const counts = new Map<string, number>();
  const makeLimiter = (bindingLimit: number) => ({
    async limit(params: { key: string }) {
      const key = params.key;
      if (options?.throwOn?.(key)) throw new Error("edge limiter unavailable");
      if (options?.failures?.(key)) return { success: false };
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      if (count > bindingLimit) {
        // Do not retain rejected bursts; matches a rolling-window counter.
        counts.set(key, count - 1);
        return { success: false };
      }
      return { success: true };
    },
  });
  const env = Object.fromEntries(
    Object.entries(EDGE_BINDING_LIMITS).map(([name, limit]) => [name, makeLimiter(limit)]),
  ) as unknown as AppEnv;
  return { env };
}

function searchRequest(userAgent: string) {
  return new Request("https://0509.io/search?query=nykaa", {
    headers: { "cf-connecting-ip": "203.0.113.11", "user-agent": userAgent },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rateLimitPolicyFor", () => {
  it("skips the cheap edge health check", () => {
    expect(rateLimitPolicyFor(new Request("https://0509.io/api/health"))).toBeNull();
  });

  it("protects the public API-read scope and /api/demo-proof fail-closed via the edge binding", () => {
    expect(rateLimitPolicyFor(new Request("https://0509.io/api/health/deep"))).toMatchObject({
      scope: "api-read",
      limit: 240,
      periodSeconds: 60,
    });
    expect(rateLimitPolicyFor(new Request("https://0509.io/api/demo-proof"))).toMatchObject({
      scope: "public-proof-brief",
      limit: PUBLIC_PROOF_BRIEF_PER_MINUTE_LIMIT,
      periodSeconds: 60,
      keyByIpOnly: true,
    });
  });

  it("protects auth routes with a stricter bucket", () => {
    expect(rateLimitPolicyFor(new Request("https://0509.io/auth/login", { method: "POST" }))).toMatchObject({
      scope: "auth",
      limit: 2,
    });
  });

  it("gives anonymous money-path page GETs + passive /api/auth prefetch their own generous budget (issue #3317)", () => {
    // The converting step's own page read and better-auth's passive
    // session/CSRF prefetch (fired by EVERY funnel page) are page READS:
    // they share one generous anonymous-GET budget keyed by IP, and neither
    // touches the credential-POST ceiling (#3160's brand-page bucket and
    // every other scope are untouched).
    expect(rateLimitPolicyFor(new Request("https://0509.io/auth/signup"))).toMatchObject({
      scope: "auth-anon-get",
      limit: AUTH_ANON_GET_PER_MINUTE_LIMIT,
      periodSeconds: 60,
      binding: "RL_AUTH_GET",
      keyByIpOnly: true,
      humane429: true,
    });
    expect(rateLimitPolicyFor(new Request("https://0509.io/api/auth/get-session"))).toMatchObject({
      scope: "auth-anon-get",
    });
    // State-changing auth calls keep the tight fail-closed legacy ceiling.
    expect(
      rateLimitPolicyFor(new Request("https://0509.io/api/auth/sign-up/email", { method: "POST" })),
    ).toMatchObject({ scope: "auth", limit: 2, periodSeconds: 60 });
    expect(
      rateLimitPolicyFor(new Request("https://0509.io/auth/login", { method: "POST" })),
    ).toMatchObject({ scope: "auth", limit: 2 });
  });

  it("keeps the auth-scope anonymous-GET 429 honest: readable page copy, preserved Retry-After (issue #3317)", async () => {
    const { env } = createFakeEdgeLimiters();

    // The shared-NAT flood case (issue #3317 acceptance 4): when the
    // anonymous-GET budget does 429 a signup visitor, that one impression
    // must show readable copy — never a bare status or raw JSON.
    let blocked: Response | null = null;
    const overshootCap = AUTH_ANON_GET_PER_MINUTE_LIMIT + 8;
    for (let index = 0; index < overshootCap && !blocked; index += 1) {
      blocked = await enforceRequestRateLimit(
        new Request("https://0509.io/auth/signup", {
          headers: { "cf-connecting-ip": "203.0.113.71", "user-agent": "flood" },
        }),
        env,
      );
    }
    expect(blocked, `expected a 429 within ${overshootCap} over-budget requests`).not.toBeNull();
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("retry-after")).toBe("60");
    expect(blocked?.headers.get("content-type")).toContain("text/html");
    const body = await blocked!.text();
    expect(body).toContain("Checking faster than we allow");
    expect(body).toContain("Try again");
    // NOT a bare status or the API JSON envelope.
    expect(body).not.toContain("rate_limited");
    expect(body).not.toContain(`<${"{"}`);
  });

  it("gives provider webhooks a dedicated higher write ceiling before generic writes", () => {
    expect(
      rateLimitPolicyFor(new Request("https://0509.io/api/webhooks/dodo", { method: "POST" })),
    ).toMatchObject({
      scope: "webhook",
      limit: 300,
      periodSeconds: 60,
    });
    expect(
      rateLimitPolicyFor(new Request("https://0509.io/api/webhooks/other", { method: "POST" })),
    ).toMatchObject({
      scope: "webhook",
      limit: 300,
    });
    // Generic app writes stay on the tighter bucket.
    expect(
      rateLimitPolicyFor(new Request("https://0509.io/api/watchlists", { method: "POST" })),
    ).toMatchObject({
      scope: "write",
      limit: 60,
    });
  });

  it("leaves search queries to the route-level anonymous limiter", () => {
    expect(rateLimitPolicyFor(new Request("https://0509.io/search"))).toBeNull();
    expect(rateLimitPolicyFor(new Request("https://0509.io/search?website=https%3A%2F%2Fnykaa.com"))).toBeNull();
    expect(rateLimitPolicyFor(new Request("https://0509.io/search?query=nykaa", { method: "HEAD" }))).toBeNull();
  });

  it("protects the public status page because it can render cached production evidence", () => {
    expect(rateLimitPolicyFor(new Request("https://0509.io/status"))).toMatchObject({
      scope: "public-status",
      limit: 120,
      keyByIpOnly: true,
    });
    expect(rateLimitPolicyFor(new Request("https://0509.io/status", { method: "HEAD" }))).toMatchObject({
      scope: "public-status",
    });
    expect(rateLimitPolicyFor(new Request("https://0509.io/status/"))).toMatchObject({
      scope: "public-status",
    });
  });
});

describe("enforceRequestRateLimit (edge binding, fail closed)", () => {
  it("blocks requests after the configured auth limit via the edge binding", async () => {
    const { env } = createFakeEdgeLimiters();
    const request = new Request("https://0509.io/auth/login", {
      method: "POST",
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "user-agent": "vitest",
      },
    });

    await expect(enforceRequestRateLimit(request, env)).resolves.toBeNull();
    await expect(enforceRequestRateLimit(request, env)).resolves.toBeNull();

    const blocked = await enforceRequestRateLimit(request, env);
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("retry-after")).toBe("60");
    await expect(blocked?.json()).resolves.toMatchObject({ error: "rate_limited" });
  });

  it("enforces public scopes WITHOUT touching D1 (detector: no hot-path event writes)", async () => {
    // The pre-#2985 limiter wrote a rate_limit_events row per auth POST and
    // per public read, and read-scopes failed OPEN when D1 degraded. The edge
    // enforcing must not need D1 at all: a D1 that is entirely broken changes
    // nothing for the edge scopes.
    const env = {
      ...createFakeEdgeLimiters().env,
      DB: createMissingTableD1(),
    } as unknown as AppEnv;
    const prepareSpy = vi.spyOn(env.DB!, "prepare");

    for (let index = 0; index < 2; index += 1) {
      const request = new Request(index === 0 ? "https://0509.io/api/demo-proof" : "https://0509.io/auth/login", {
        method: index === 0 ? "GET" : "POST",
        headers: { "cf-connecting-ip": "203.0.113.44", "user-agent": "vitest" },
      });
      request.headers.set("cf-connecting-ip", "203.0.113.44");
      // Different scopes key differently; one call apiece stays under both.
      await expect(enforceRequestRateLimit(request, env)).resolves.toBeNull();
    }
    expect(prepareSpy).not.toHaveBeenCalled();
  });

  it("fails closed with 429 when the binding is missing (no fail-open on public hot paths)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await enforceRequestRateLimit(
      new Request("https://0509.io/api/demo-proof", {
        headers: { "cf-connecting-ip": "203.0.113.45" },
      }),
      {} as AppEnv,
    );
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
    consoleError.mockRestore();
  });

  it("fails closed with 429 when the edge limiter throws", async () => {
    const { env } = createFakeEdgeLimiters();
    env.RL_PROOF_BRIEF!.limit = async () => {
      throw new Error("cloudflare edge hiccup");
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await enforceRequestRateLimit(
      new Request("https://0509.io/api/demo-proof", {
        headers: { "cf-connecting-ip": "203.0.113.46" },
      }),
      env,
    );
    expect(response?.status).toBe(429);
    consoleError.mockRestore();
  });

  it("keeps the per-IP public-status bucket shared across slash variants", async () => {
    const { env } = createFakeEdgeLimiters();

    for (let index = 0; index < 120; index += 1) {
      const path = index % 2 === 0 ? "/status" : "/status////";
      await expect(
        enforceRequestRateLimit(
          new Request(`https://0509.io${path}`, {
            headers: {
              "cf-connecting-ip": "203.0.113.13",
              "user-agent": `rotating-agent-${index}`,
            },
          }),
          env,
        ),
      ).resolves.toBeNull();
    }

    const blocked = await enforceRequestRateLimit(
      new Request("https://0509.io/status/", {
        headers: {
          "cf-connecting-ip": "203.0.113.13",
          "user-agent": "new-agent",
        },
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });

  it("admits a 24-GET/10-min signup burst at ≤1 rps even with the funnel's prefetches already spent (issue #3317)", async () => {
    const { env } = createFakeEdgeLimiters();
    const request = (path: string, ua: string) =>
      new Request(`https://0509.io${path}`, {
        headers: { "cf-connecting-ip": "203.0.113.72", "user-agent": ua },
      });

    // The funnel walks first: 4 pages × 2 devices of passive session
    // prefetches, then both devices' signup page reads — all on the
    // anonymous-GET budget (keyByIpOnly, so both devices share one IP key).
    for (const device of ["desktop", "mobile"]) {
      for (let step = 0; step < 4; step += 1) {
        await expect(enforceRequestRateLimit(request("/api/auth/get-session", device), env)).resolves.toBeNull();
      }
      await expect(enforceRequestRateLimit(request("/auth/signup", device), env)).resolves.toBeNull();
    }

    // Then the issue's 24-GET burst leg. The fake limiter has no clock, so
    // these fire FASTER than ≤1 rps and all land inside one 60s window —
    // the strictest case for the anonymous-GET budget, and therefore the
    // strongest pass: a paced 24-GET/10-min burst can only be easier.
    let four29s = 0;
    for (let index = 0; index < 24; index += 1) {
      const response = await enforceRequestRateLimit(request("/auth/signup", "burst"), env);
      if (response) four29s += 1;
    }
    expect(four29s, "24-GET signup burst must not 429 (issue #3317)").toBe(0);
  });

  it("keys all headerless requests into one shared unknown bucket (spoofed XFF cannot mint identities)", async () => {
    const { env } = createFakeEdgeLimiters();

    const spoofedIps = ["198.51.100.1", "203.0.113.9", "192.0.2.44"];
    for (let index = 0; index < 2; index += 1) {
      const request = new Request("https://0509.io/auth/login", {
        method: "POST",
        headers: {
          "x-forwarded-for": spoofedIps[index % spoofedIps.length]!,
          "user-agent": `spoofed-agent-${index}`,
        },
      });
      await expect(enforceRequestRateLimit(request, env)).resolves.toBeNull();
    }

    const blocked = await enforceRequestRateLimit(
      new Request("https://0509.io/auth/login", {
        method: "POST",
        headers: {
          "x-forwarded-for": "198.51.100.77",
          "user-agent": "brand-new-spoof",
        },
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });

  it("ignores spoofed x-forwarded-for when a real cf-connecting-ip is present", async () => {
    const { env } = createFakeEdgeLimiters();

    for (let index = 0; index < 2; index += 1) {
      const request = new Request("https://0509.io/auth/login", {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.50",
          "x-forwarded-for": `1.2.3.${index}`,
          "user-agent": "same-browser",
        },
      });
      await expect(enforceRequestRateLimit(request, env)).resolves.toBeNull();
    }

    const blocked = await enforceRequestRateLimit(
      new Request("https://0509.io/auth/login", {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.50",
          "x-forwarded-for": "9.9.9.9",
          "user-agent": "same-browser",
        },
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });
});

describe("enforcePublicSearchRateLimit (edge binding)", () => {
  it("429s a browser that exceeds its own per-browser budget", async () => {
    const { env } = createFakeEdgeLimiters();

    await expect(enforcePublicSearchRateLimit(searchRequest("a"), env, undefined, "browser-a")).resolves.toBeNull();
    await expect(enforcePublicSearchRateLimit(searchRequest("a"), env, undefined, "browser-a")).resolves.toBeNull();
    const blocked = await enforcePublicSearchRateLimit(searchRequest("a"), env, undefined, "browser-a");
    expect(blocked?.status).toBe(429);
    // Same anonymous id again is still blocked (rolling window, not a one-shot).
    await expect(
      enforcePublicSearchRateLimit(searchRequest("a-again"), env, undefined, "browser-a"),
    ).resolves.toMatchObject({ status: 429 });
  });

  it("separates per-browser budgets on a shared NAT IP", async () => {
    const { env } = createFakeEdgeLimiters();

    for (let index = 0; index < 5; index += 1) {
      const request = new Request("https://0509.io/search?query=nykaa", {
        headers: { "cf-connecting-ip": "203.0.113.55" },
      });
      await expect(
        enforcePublicSearchRateLimit(request, env, undefined, `nat-browser-${index}`),
      ).resolves.toBeNull();
    }
  });

  it("keeps the per-IP public-search backstop throttling once the IP ceiling is exceeded", async () => {
    const { env } = createFakeEdgeLimiters();

    for (let index = 0; index < PUBLIC_SEARCH_IP_BACKSTOP_LIMIT; index += 1) {
      await expect(enforcePublicSearchRateLimit(searchRequest(`agent-${index}`), env)).resolves.toBeNull();
    }

    // Even a brand-new anonymousId cannot bypass the exhausted per-IP backstop.
    const blocked = await enforcePublicSearchRateLimit(searchRequest("fresh"), env, undefined, "any-browser");
    expect(blocked?.status).toBe(429);
  });

  it("keys by anonymous browser id so its own exhausted budget does not block other browsers on the IP", async () => {
    const { env } = createFakeEdgeLimiters();

    for (let index = 0; index < PUBLIC_SEARCH_ANON_BROWSER_LIMIT; index += 1) {
      await expect(
        enforcePublicSearchRateLimit(searchRequest(`vitest-${index}`), env, undefined, "browser-a"),
      ).resolves.toBeNull();
    }
    await expect(
      enforcePublicSearchRateLimit(searchRequest("vitest-3"), env, undefined, "browser-a"),
    ).resolves.toMatchObject({ status: 429 });

    await expect(
      enforcePublicSearchRateLimit(searchRequest("vitest-4"), env, undefined, "browser-b"),
    ).resolves.toBeNull();
  });
});

describe("enforcePublicSearchSelectionRateLimit", () => {
  it("admits 3 anonymous ad checks then returns 429", async () => {
    const { env } = createFakeEdgeLimiters();
    const request = new Request("https://0509.io/search?query=nykaa&selected=meta-1", {
      headers: { "cf-connecting-ip": "203.0.113.21", "user-agent": "vitest" },
    });

    for (let index = 0; index < PUBLIC_SEARCH_SELECTION_PER_MINUTE_LIMIT; index += 1) {
      await expect(enforcePublicSearchSelectionRateLimit(request, env)).resolves.toBeNull();
    }

    const blocked = await enforcePublicSearchSelectionRateLimit(request, env);
    expect(blocked?.status).toBe(429);
  });
});

describe("enforcePublicBrandPageRateLimit", () => {
  it("shares one bucket across brand page domains and 429s past the ceiling", async () => {
    const { env } = createFakeEdgeLimiters();

    for (let index = 0; index < PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT; index += 1) {
      await expect(
        enforcePublicBrandPageRateLimit(
          new Request(`https://0509.io/ads/domain-${index}.com`, {
            headers: { "cf-connecting-ip": "203.0.113.30", "user-agent": "vitest" },
          }),
          env,
        ),
      ).resolves.toBeNull();
    }

    const blocked = await enforcePublicBrandPageRateLimit(
      new Request("https://0509.io/ads/next-domain.com", {
        headers: { "cf-connecting-ip": "203.0.113.30", "user-agent": "fresh" },
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });
});

describe("cost-bearing scopes keep the D1 atomic claim", () => {
  it("blocks a signed-in account after the limit even when it rotates IPs", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;

    // 60 searches from 60 different IPs: same account, same 10-min burst bucket.
    // Use agency so the daily plan budget (1000) does not trip first.
    for (let index = 0; index < 60; index += 1) {
      const request = new Request("https://0509.io/search?query=nykaa", {
        headers: {
          "cf-connecting-ip": `203.0.113.${index % 250}`,
          "user-agent": `rotating-agent-${index}`,
        },
      });
      await expect(
        enforceAuthenticatedSearchRateLimit(request, env, "user-1", undefined, "agency"),
      ).resolves.toBeNull();
    }

    const blocked = await enforceAuthenticatedSearchRateLimit(
      new Request("https://0509.io/search?query=nykaa", {
        headers: { "cf-connecting-ip": "198.51.100.99", "user-agent": "fresh" },
      }),
      env,
      "user-1",
      undefined,
      "agency",
    );
    expect(blocked?.status).toBe(429);

    // a different account is unaffected
    await expect(
      enforceAuthenticatedSearchRateLimit(
        new Request("https://0509.io/search?query=nykaa", {
          headers: { "cf-connecting-ip": "198.51.100.99", "user-agent": "fresh" },
        }),
        env,
        "user-2",
      ),
    ).resolves.toBeNull();
  });

  it("claims the warm-selection budget synchronously instead of deferring admission", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const waitUntil = vi.fn();

    await expect(
      enforceSearchSelectionRateLimit(
        new Request("https://0509.io/search?query=nykaa&selected=meta-1"),
        env,
        "user-1",
        { waitUntil } as unknown as ExecutionContext,
      ),
    ).resolves.toBeNull();

    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("refuses the 121st warm selection in the window without touching the fresh-search bucket", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;

    for (let index = 0; index < 120; index += 1) {
      const request = new Request("https://0509.io/search?query=nykaa&selected=meta-1", {
        headers: {
          "cf-connecting-ip": `203.0.113.${index % 250}`,
          "user-agent": `rotating-agent-${index}`,
        },
      });
      await expect(
        enforceSearchSelectionRateLimit(request, env, "user-1"),
      ).resolves.toBeNull();
    }

    const blocked = await enforceSearchSelectionRateLimit(
      new Request("https://0509.io/search?query=nykaa&selected=meta-1", {
        headers: { "cf-connecting-ip": "198.51.100.99", "user-agent": "fresh" },
      }),
      env,
      "user-1",
    );
    expect(blocked?.status).toBe(429);

    // separate buckets: an exhausted selection bucket never blocks fresh searches
    await expect(
      enforceAuthenticatedSearchRateLimit(
        new Request("https://0509.io/search?query=nykaa", {
          headers: { "cf-connecting-ip": "198.51.100.99", "user-agent": "fresh" },
        }),
        env,
        "user-1",
      ),
    ).resolves.toBeNull();

    // a different account is unaffected
    await expect(
      enforceSearchSelectionRateLimit(
        new Request("https://0509.io/search?query=nykaa&selected=meta-1", {
          headers: { "cf-connecting-ip": "198.51.100.99", "user-agent": "fresh" },
        }),
        env,
        "user-2",
      ),
    ).resolves.toBeNull();
  });

  it("fails closed before a provider call when D1 or its table is unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      enforceBillingProviderRateLimit(
        new Request("https://0509.io/api/billing/dodo/checkout"),
        {} as AppEnv,
        "owner-1",
        "mutation",
      ),
    ).resolves.toMatchObject({ status: 503 });
    await expect(
      enforceBillingProviderRateLimit(
        new Request("https://0509.io/api/billing/dodo/checkout"),
        { DB: createMissingTableD1() } as unknown as AppEnv,
        "owner-1",
        "mutation",
      ),
    ).resolves.toMatchObject({ status: 503 });
    consoleError.mockRestore();
  });
});

/**
 * Committed-configuration guard for the RL_* edge bindings (issue #2985).
 *
 * History this exists to prevent: the first cut of #2985 shipped
 * `namespace_id` values invented as descriptive strings ("0509-rl-auth",
 * …). Every worker unit test passed, because the fake limiters never look at
 * the binding metadata. Cloudflare's deploy-time validator rejected the
 * upload with `binding RL_WEBHOOK of type ratelimit must have valid
 * namespace_id [code: 10021]`, and the failure only surfaced in the
 * `preview-assert` required check after a full build+upload round-trip.
 *
 * The platform contract (developers.cloudflare.com Workers Rate Limiting
 * binding): `namespace_id` is "a string containing a positive integer that
 * uniquely defines this rate limiting namespace within your Cloudflare
 * account". It is chosen by the config author — no Cloudflare-side resource
 * has to be created first — but it MUST be an integer string and MUST be
 * unique per namespace within the account. These assertions fail before
 * merge instead of in the deploy validator.
 */
function readWranglerRateLimits(path: string): { name: unknown; namespace_id: unknown; simple: unknown }[] {
  const raw = readFileSync(path, "utf8");
  // wrangler.jsonc allows // comments; strip them before parsing. String
  // contents are preserved by only dropping comments that start a run of
  // non-quoted text on their line.
  const withoutComments = raw
    .split("\n")
    .map((line) => {
      const commentIndex = line.indexOf("//");
      if (commentIndex === -1) return line;
      const before = line.slice(0, commentIndex);
      const quoteCount = (before.match(/"/g) ?? []).length;
      return quoteCount % 2 === 0 ? before : line;
    })
    .join("\n");
  const parsed = JSON.parse(withoutComments) as {
    unsafe?: { bindings?: { type?: string; name?: unknown; namespace_id?: unknown; simple?: unknown }[] };
  };
  return (parsed.unsafe?.bindings ?? []).filter((binding) => binding.type === "ratelimit") as {
    name: unknown;
    namespace_id: unknown;
    simple: unknown;
  }[];
}

const RATE_LIMIT_CONFIGS = ["wrangler.jsonc", "wrangler.e2e.jsonc", "tests/integration/wrangler.test.jsonc"] as const;

describe("RL_* edge binding configuration (#2985)", () => {
  it.each(RATE_LIMIT_CONFIGS)("declares every RL_* scope in %s", (path) => {
    const names = readWranglerRateLimits(path).map((binding) => binding.name);

    expect(names.sort()).toEqual(Object.keys(EDGE_BINDING_LIMITS).sort());
  });

  it.each(RATE_LIMIT_CONFIGS)("uses positive-integer namespace_id strings in %s", (path) => {
    for (const binding of readWranglerRateLimits(path)) {
      const namespaceId = binding.namespace_id;

      // Cloudflare: "A string containing a positive integer … Although the
      // value must be a valid integer, it is specified as a string." A
      // descriptive label here is the #10021 deploy failure.
      expect(typeof namespaceId, `${String(binding.name)} namespace_id must be a string`).toBe("string");
      expect(String(namespaceId), `${String(binding.name)} namespace_id must be a positive integer`).toMatch(
        /^[1-9][0-9]*$/,
      );
    }
  });

  it.each(RATE_LIMIT_CONFIGS)("keeps each namespace_id unique within %s", (path) => {
    const ids = readWranglerRateLimits(path).map((binding) => String(binding.namespace_id));

    // Unique per Cloudflare account. Distinct scopes must not share a
    // namespace, or one route's burst spends another route's budget.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(RATE_LIMIT_CONFIGS)("matches the committed capacity each scope is tested against in %s", (path) => {
    for (const binding of readWranglerRateLimits(path)) {
      const simple = binding.simple as { limit?: unknown; period?: unknown };

      expect(simple.limit, `${String(binding.name)} simple.limit`).toBe(EDGE_BINDING_LIMITS[String(binding.name)]);
      // The platform accepts only 10s or 60s windows.
      expect([10, 60]).toContain(simple.period);
    }
  });
});

function createFakeD1() {
  const rows: { scope: string; keyHash: string; route: string; createdAt: string }[] = [];

  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (sql.includes("INSERT INTO rate_limit_events")) {
                const [, scope, keyHash, route, createdAt, _scope, _keyHash, _route, since, limit] = args;
                const count = rows.filter(
                  (row) =>
                    row.scope === String(scope) &&
                    row.keyHash === String(keyHash) &&
                    row.route === String(route) &&
                    row.createdAt >= String(since),
                ).length;
                if (count < Number(limit)) {
                  rows.push({
                    scope: String(scope),
                    keyHash: String(keyHash),
                    route: String(route),
                    createdAt: String(createdAt),
                  });
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (sql.includes("DELETE FROM rate_limit_events")) {
                // Bind shape: [...longScopes, cutoff, ...longScopes, longWindowCutoff]
                const scopeCount = (args.length - 2) / 2;
                const longScopes = new Set(args.slice(0, scopeCount).map(String));
                const cutoff = String(args[scopeCount]);
                const longWindowCutoff = String(args[args.length - 1]);
                for (let index = rows.length - 1; index >= 0; index -= 1) {
                  const row = rows[index]!;
                  const expired = longScopes.has(row.scope)
                    ? row.createdAt < longWindowCutoff
                    : row.createdAt < cutoff;
                  if (expired) rows.splice(index, 1);
                }
              }
              return {};
            },
            async first<T>() {
              if (!sql.includes("SELECT")) return null;
              return null as unknown as T;
            },
          };
        },
      };
    },
  };
}

function createMissingTableD1() {
  return {
    prepare() {
      return {
        bind() {
          return {
            async run() {
              throw new Error("no such table: rate_limit_events");
            },
            async first() {
              throw new Error("no such table: rate_limit_events");
            },
          };
        },
      };
    },
  };
}
