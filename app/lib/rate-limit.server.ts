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
	// When set, stored instead of the request pathname. Use for routes whose
	// pathname embeds a bearer credential (e.g. share tokens) so the token
	// never lands in the rate_limit_events table.
	routeOverride?: string;
	// Cost-bearing routes must reserve capacity synchronously in one SQL
	// statement. This prevents concurrent requests from all observing the same
	// stale COUNT before any event is recorded.
	atomicClaim?: boolean;
};

export type BillingProviderRateLimitKind = "pricing" | "mutation";

const BILLING_PROVIDER_RATE_LIMITS: Record<
  BillingProviderRateLimitKind,
  { scope: string; limit: number; windowSeconds: number }
> = {
  // Pricing previews can fan out to one provider request per configured SKU,
  // so keep their bucket separate from writes while still bounding spend.
  pricing: { scope: "billing-provider-pricing", limit: 30, windowSeconds: 60 },
  // Checkout, portal, and subscription mutations are materially more costly
  // and must share one conservative owner budget.
  mutation: { scope: "billing-provider-mutation", limit: 5, windowSeconds: 10 * 60 },
};

const CLEANUP_WINDOW_SECONDS = 2 * 60 * 60;
// Scopes whose counting window exceeds the short cleanup horizon. Their
// events must survive a full day plus slack or the daily caps silently reset.
const LONG_WINDOW_SCOPES = new Set(["share-pdf-daily", "account-search-daily"]);
const LONG_WINDOW_CLEANUP_SECONDS = 25 * 60 * 60;
const PDF_SINGLE_FLIGHT_SCOPE = "share-pdf-single-flight";
const PDF_SINGLE_FLIGHT_ROUTE = "/share/:token/pdf";
const PDF_SINGLE_FLIGHT_LEASE_SECONDS = 75;

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

export async function enforcePublicSearchSelectionRateLimit(
  request: Request,
  env: AppEnv,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  return enforceRateLimitPolicy(
    request,
    env,
    {
      scope: "public-search-selection",
      limit: 30,
      windowSeconds: 10 * 60,
      failClosed: false,
      keyByIpOnly: true,
    },
    ctx,
  );
}

// Public /ads/:domain brand pages are cache-read-only (no provider spend), so
// the bucket is more generous than public search, but still bounded: each
// request costs bounded D1 reads and this is a crawl/abuse-facing surface.
// Same shape as the public-search policy: per-IP, fail-open.
export async function enforcePublicBrandPageRateLimit(
  request: Request,
  env: AppEnv,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  return enforceRateLimitPolicy(
    request,
    env,
    {
      scope: "public-brand-page",
      limit: 120,
      windowSeconds: 10 * 60,
      failClosed: false,
      keyByIpOnly: true,
      // One shared bucket across every brand page — without this the pathname
      // (which embeds the domain) would give each domain its own budget.
      routeOverride: "/ads/:domain",
    },
    ctx,
  );
}

// Plan-keyed daily live-search ceilings (UTC day). Stacked on the short
// 10-minute burst bucket so free/Scout cannot burn Browser Rendering all day.
const ACCOUNT_SEARCH_DAILY_LIMITS: Record<string, number> = {
  free: 25,
  scout: 100,
  starter: 300,
  agency: 1_000,
};

// Signed-in live search drives usage-billed Browser Rendering scrapes, and
// signup is free — without a per-account ceiling a scripted free account
// could fire unlimited distinct live queries. Keyed by user id so rotating
// IPs doesn't reset the bucket.
export async function enforceAuthenticatedSearchRateLimit(
  request: Request,
  env: AppEnv,
  userId: string,
  ctx?: ExecutionContext,
  planFamily?: string | null,
): Promise<Response | null> {
  const burst = await enforceRateLimitPolicy(
    request,
    env,
    {
      scope: "account-search",
      limit: 60,
      windowSeconds: 10 * 60,
      failClosed: true,
      keySeed: userId,
      atomicClaim: true,
    },
    ctx,
  );
  if (burst) return burst;

  // WP-35: daily plan budget on top of the 10-minute burst.
  const plan = (planFamily ?? "free").trim().toLowerCase() || "free";
  const dailyLimit = ACCOUNT_SEARCH_DAILY_LIMITS[plan] ?? ACCOUNT_SEARCH_DAILY_LIMITS.free;
  return enforceRateLimitPolicy(
    request,
    env,
    {
      scope: "account-search-daily",
      limit: dailyLimit,
      windowSeconds: 24 * 60 * 60,
      failClosed: true,
      keySeed: `${userId}:${plan}`,
      routeOverride: "account-search-daily",
      atomicClaim: true,
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
      atomicClaim: true,
    },
    ctx,
  );
}

/**
 * Reserve capacity for a Dodo billing provider operation.
 *
 * The key is the authenticated workspace owner, rather than request headers,
 * so rotating an IP or user-agent cannot reset spend. Both buckets use the
 * atomic claim path and fail closed when D1 or its rate-limit table is absent.
 */
export async function enforceBillingProviderRateLimit(
  request: Request,
  env: AppEnv,
  workspaceUserId: string,
  kind: BillingProviderRateLimitKind,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  if (!workspaceUserId.trim()) return rateLimitUnavailableResponse();
  const policy = BILLING_PROVIDER_RATE_LIMITS[kind];
  return enforceRateLimitPolicy(
    request,
    env,
    {
      ...policy,
      windowSeconds: policy.windowSeconds,
      failClosed: true,
      keySeed: workspaceUserId,
      // All Dodo billing calls for this owner share the same budget, even
      // when they originate from different route pathnames.
      routeOverride: "billing-provider",
      atomicClaim: true,
    },
    ctx,
  );
}

// Public share-report PDF renders launch usage-billed Browser Rendering
// sessions from an unauthenticated route, so both gates fail closed — they
// are the only spend gates on that path (mirrors search-selection). Per-IP
// stops burst abuse from one viewer.
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

// Per-sharer daily ceiling: a forwarded link can reach any number of viewer
// IPs, so the sharer's account is the budget that actually bounds Browser
// Rendering spend. Keyed by the sharer's user id, not the viewer.
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
			scope: "share-pdf-daily",
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

/** Claim one short lease for an immutable PDF render. */
export async function claimSharePdfSingleFlight(
  env: AppEnv,
  input: { sharerUserId: string; resourceId: string; contentFingerprint: string },
): Promise<Response | null> {
  if (!env.DB || !input.sharerUserId.trim() || !input.resourceId.trim() || !input.contentFingerprint.trim()) {
    if (!env.DB) console.error("[rate-limit] D1 binding missing; request was not single-flight protected.");
    return rateLimitUnavailableResponse();
  }
  const now = new Date();
  const createdAt = now.toISOString();
  const since = new Date(now.getTime() - PDF_SINGLE_FLIGHT_LEASE_SECONDS * 1000).toISOString();
  try {
    const keyHash = await sha256Hex(`${PDF_SINGLE_FLIGHT_SCOPE}|${input.sharerUserId}|${input.resourceId}|${input.contentFingerprint}`);
    const claim = await env.DB.prepare(
      `INSERT INTO rate_limit_events (id, scope, key_hash, route, created_at)
       SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (
         SELECT 1 FROM rate_limit_events WHERE scope = ? AND key_hash = ? AND route = ? AND created_at >= ?
       )`,
    ).bind(crypto.randomUUID(), PDF_SINGLE_FLIGHT_SCOPE, keyHash, PDF_SINGLE_FLIGHT_ROUTE, createdAt,
      PDF_SINGLE_FLIGHT_SCOPE, keyHash, PDF_SINGLE_FLIGHT_ROUTE, since).run();
    if (Number(claim.meta?.changes ?? 0) > 0) return null;
    const existing = await env.DB.prepare(
      `SELECT created_at FROM rate_limit_events WHERE scope = ? AND key_hash = ? AND route = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(PDF_SINGLE_FLIGHT_SCOPE, keyHash, PDF_SINGLE_FLIGHT_ROUTE, since).first<{ created_at: string }>();
    const parsedCreatedAt = existing?.created_at ? Date.parse(existing.created_at) : NaN;
    const ageMs = Number.isFinite(parsedCreatedAt) ? Math.max(0, now.getTime() - parsedCreatedAt) : 0;
    return pdfSingleFlightBusyResponse(Math.max(1, Math.ceil((PDF_SINGLE_FLIGHT_LEASE_SECONDS * 1000 - ageMs) / 1000)));
  } catch (error) {
    console.error("[rate-limit] single-flight claim failed", error);
    return rateLimitUnavailableResponse();
  }
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
			// A single conditional INSERT is the reservation and the limit check.
			// D1/SQLite serializes the statement atomically, so concurrent callers
			// cannot all pass on a stale pre-insert count. The claim is synchronous;
			// only opportunistic cleanup may be deferred through waitUntil.
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
  return sha256Hex(input);
}

async function sha256Hex(input: string | Uint8Array) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
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
  // Derive the scope list from LONG_WINDOW_SCOPES (parameterized) so adding a
  // long-window scope cannot drift from the cleanup SQL.
  const longWindowScopes = [...LONG_WINDOW_SCOPES];
  const scopePlaceholders = longWindowScopes.map(() => "?").join(", ");
  await env.DB.prepare(
    `DELETE FROM rate_limit_events
      WHERE (scope NOT IN (${scopePlaceholders}) AND created_at < ?)
         OR (scope IN (${scopePlaceholders}) AND created_at < ?)`,
  )
    .bind(...longWindowScopes, cutoff, ...longWindowScopes, longWindowCutoff)
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

function pdfSingleFlightBusyResponse(retryAfterSeconds: number) {
  return new Response(JSON.stringify({
    error: "pdf_single_flight",
    message: "This PDF is already being prepared. Try again shortly.",
  }), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(retryAfterSeconds),
      "cache-control": "no-store",
    },
  });
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
