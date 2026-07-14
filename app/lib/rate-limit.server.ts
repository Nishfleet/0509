import type { AppEnv } from "~/lib/env.server";

type RateLimitPolicy = {
  scope: string;
  limit: number;
  windowSeconds: number;
  failClosed: boolean;
  keyByIpOnly?: boolean;
  // When set, the rate-limit key is derived from this value instead of
  // IP/user-agent — e.g. a user id, so rotating IPs can't reset the bucket.
  keySeed?: string;
  routeOverride?: string;
  atomicClaim?: boolean;
};

const CLEANUP_WINDOW_SECONDS = 2 * 60 * 60;
const LONG_WINDOW_SCOPE = "share-pdf-daily";
const LONG_WINDOW_CLEANUP_SECONDS = 25 * 60 * 60;

export async function enforceRequestRateLimit(
  request: Request,
  env: AppEnv,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  const policy = rateLimitPolicyFor(request);
  if (!policy) return null;

  return enforceRateLimitPolicy(request, env, policy, ctx);
}

export async function enforcePublicSearchRateLimit(
  request: Request,
  env: AppEnv,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  return enforceRateLimitPolicy(
    request,
    env,
    { scope: "public-search", limit: 20, windowSeconds: 10 * 60, failClosed: false, keyByIpOnly: true },
    ctx,
  );
}

// Signed-in live search drives usage-billed Browser Rendering scrapes, and
// signup is free — without a per-account ceiling a scripted free account
// could fire unlimited distinct live queries. Keyed by user id so rotating
// IPs doesn't reset the bucket.
export async function enforceAuthenticatedSearchRateLimit(
  request: Request,
  env: AppEnv,
  userId: string,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  return enforceRateLimitPolicy(
    request,
    env,
    {
      scope: "account-search",
      limit: 60,
      windowSeconds: 10 * 60,
      failClosed: false,
      keySeed: userId,
    },
    ctx,
  );
}

// Signed-in selection clicks on a warm discovery cache skip the account-search
// bucket, but selection enrichment still runs usage-billed landing-page
// capture (Browser Rendering rendered fallback) per click. This dedicated
// bucket is the hard ceiling on that spend: twice as generous as fresh
// searches and separate from them, so browsing results never locks a user
// out of new searches. Fail-closed — it is the only spend gate on this path.
export async function enforceSearchSelectionRateLimit(
  request: Request,
  env: AppEnv,
  userId: string,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  return enforceRateLimitPolicy(
    request,
    env,
    {
      scope: "search-selection",
      limit: 120,
      windowSeconds: 10 * 60,
      failClosed: true,
      keySeed: userId,
    },
    ctx,
  );
}

export async function enforceSharePdfRateLimit(
  request: Request,
  env: AppEnv,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  return enforceRateLimitPolicy(
    request,
    env,
    {
      scope: "share-pdf",
      limit: 5,
      windowSeconds: 60,
      failClosed: true,
      keyByIpOnly: true,
      routeOverride: "/share/:token/pdf",
      atomicClaim: true,
    },
    ctx,
  );
}

export async function enforceSharePdfDailyCap(
  request: Request,
  env: AppEnv,
  sharerUserId: string,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  return enforceRateLimitPolicy(
    request,
    env,
    {
      scope: LONG_WINDOW_SCOPE,
      limit: 40,
      windowSeconds: 24 * 60 * 60,
      failClosed: true,
      keySeed: sharerUserId,
      routeOverride: "/share/:token/pdf",
      atomicClaim: true,
    },
    ctx,
  );
}

async function enforceRateLimitPolicy(
  request: Request,
  env: AppEnv,
  policy: RateLimitPolicy,
  ctx?: ExecutionContext,
) {
  if (!env.DB) {
    console.error("[rate-limit] D1 binding missing; request was not rate-limited.");
    return policy.failClosed ? rateLimitUnavailableResponse() : null;
  }

  try {
    const url = new URL(request.url);
    const route = policy.routeOverride ?? normalizeRateLimitedPathname(url.pathname);
    const now = new Date();
    const since = new Date(now.getTime() - policy.windowSeconds * 1000).toISOString();
    const keyHash = await requestKeyHash(request, policy);

    if (policy.atomicClaim) {
      const eventId = crypto.randomUUID();
      const createdAt = now.toISOString();
      const claim = await env.DB.prepare(
        `INSERT INTO rate_limit_events (id, scope, key_hash, route, created_at)
         SELECT ?, ?, ?, ?, ?
          WHERE (
            SELECT COUNT(*)
              FROM rate_limit_events
             WHERE scope = ?
               AND key_hash = ?
               AND route = ?
               AND created_at >= ?
          ) < ?`,
      )
        .bind(
          eventId,
          policy.scope,
          keyHash,
          route,
          createdAt,
          policy.scope,
          keyHash,
          route,
          since,
          policy.limit,
        )
        .run();

      if (Number(claim.meta?.changes ?? 0) < 1) {
        return tooManyRequestsResponse(policy.windowSeconds);
      }

      if (Math.random() < 0.02) {
        const cleanup = cleanupRateLimitEvents(env).catch((error) => {
          console.error("[rate-limit] deferred cleanup failed", error);
        });
        if (ctx) {
          ctx.waitUntil(cleanup);
        } else {
          await cleanup;
        }
      }

      return null;
    }

    // Gate on the windowed COUNT alone so the request path does not wait on
    // the INSERT. Auth/write scopes stay fail-closed when D1 is unavailable.
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM rate_limit_events
        WHERE scope = ?
          AND key_hash = ?
          AND route = ?
          AND created_at >= ?`,
    )
      .bind(policy.scope, keyHash, route, since)
      .first<{ count: number }>();

    const count = Number(row?.count ?? 0);
    if (count >= policy.limit) {
      return tooManyRequestsResponse(policy.windowSeconds);
    }

    const eventId = crypto.randomUUID();
    const createdAt = now.toISOString();
    const recordEvent = () =>
      env.DB!.prepare(
        `INSERT INTO rate_limit_events (id, scope, key_hash, route, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(eventId, policy.scope, keyHash, route, createdAt)
        .run();

    if (ctx) {
      ctx.waitUntil(
        recordEvent()
          .then(() => {
            if (Math.random() < 0.02) {
              return cleanupRateLimitEvents(env);
            }
            return undefined;
          })
          .catch((error) => {
            console.error("[rate-limit] deferred event insert failed", error);
          }),
      );
    } else {
      await recordEvent();
    }

    return null;
  } catch (error) {
    console.error("[rate-limit] limiter failed", error);
    if (isMissingRateLimitTableError(error)) {
      return policy.failClosed ? rateLimitUnavailableResponse() : null;
    }
    return policy.failClosed ? rateLimitUnavailableResponse() : null;
  }
}

export function rateLimitPolicyFor(request: Request): RateLimitPolicy | null {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const pathname = normalizeRateLimitedPathname(url.pathname);

  if (method === "OPTIONS" || (method === "GET" && pathname === "/api/health")) {
    return null;
  }

  if ((method === "GET" || method === "HEAD") && pathname === "/status") {
    return { scope: "public-status", limit: 120, windowSeconds: 60, failClosed: false, keyByIpOnly: true };
  }

  if (pathname.startsWith("/api/auth") || pathname.startsWith("/auth/")) {
    return { scope: "auth", limit: 20, windowSeconds: 10 * 60, failClosed: true };
  }

  if (pathname.startsWith("/api/delivery-status")) {
    return { scope: "delivery-webhook", limit: 180, windowSeconds: 60, failClosed: false };
  }

  // Provider webhooks (Dodo, etc.): higher ceiling than generic writes.
  // Signature verification remains the real auth gate for these routes.
  if (pathname.startsWith("/api/webhooks/")) {
    return { scope: "webhook", limit: 300, windowSeconds: 60, failClosed: false };
  }

  if (method !== "GET" && method !== "HEAD") {
    return { scope: "write", limit: 60, windowSeconds: 60, failClosed: true };
  }

  if (pathname.startsWith("/api/")) {
    return { scope: "api-read", limit: 240, windowSeconds: 60, failClosed: false };
  }

  return null;
}

function normalizeRateLimitedPathname(pathname: string) {
  return pathname === "/" ? pathname : pathname.replace(/\/+$/, "");
}

async function requestKeyHash(request: Request, policy: RateLimitPolicy) {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const userAgent = request.headers.get("user-agent") || "";
  const input = new TextEncoder().encode(
    policy.keySeed
      ? `${policy.scope}|${policy.keySeed}`
      : policy.keyByIpOnly
        ? `${policy.scope}|${ip}`
        : `${policy.scope}|${ip}|${userAgent}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function cleanupRateLimitEvents(env: AppEnv) {
  if (!env.DB) return;
  const cutoff = new Date(Date.now() - CLEANUP_WINDOW_SECONDS * 1000).toISOString();
  const longWindowCutoff = new Date(
    Date.now() - LONG_WINDOW_CLEANUP_SECONDS * 1000,
  ).toISOString();
  await env.DB.prepare(
    `DELETE FROM rate_limit_events
      WHERE (scope != ? AND created_at < ?)
         OR (scope = ? AND created_at < ?)`,
  )
    .bind(LONG_WINDOW_SCOPE, cutoff, LONG_WINDOW_SCOPE, longWindowCutoff)
    .run();
}

function isMissingRateLimitTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.toLowerCase().includes("no such table") && message.includes("rate_limit_events");
}

function tooManyRequestsResponse(retryAfterSeconds: number) {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: "Too many requests. Please try again shortly.",
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(retryAfterSeconds),
        "cache-control": "no-store",
      },
    },
  );
}

function rateLimitUnavailableResponse() {
  return new Response(
    JSON.stringify({
      error: "rate_limit_unavailable",
      message: "Request protection is temporarily unavailable.",
    }),
    {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
