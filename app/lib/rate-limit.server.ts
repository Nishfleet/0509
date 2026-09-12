import type { AppEnv, EdgeRateLimitBindingName } from "~/lib/env.server";

// The Public hot paths no longer touch D1 for their rate limiting (issue
// #2985): every scope below is enforced by a native Cloudflare Rate
// Limiting binding (the RL_* bindings, declared in wrangler.jsonc with
// their capacities). Those bindings count at the Cloudflare edge —
// no rate_limit_events row per request, no D1 round-trip on the hot path,
// and no dependency on D1 health: a degraded D1 can no longer switch the
// public-search buckets off, and a degraded EDGE limiter fails CLOSED with
// a 429 + Retry-After instead of silently admitting unbounded traffic.
//
// Window accounting changed with the binding: the Rate Limiting binding
// only supports 10s and 60s periods, so the old 10-minute window buckets
// keep the same long-run rate (old limit / 10, per minute) with 60s burst
// granularity instead of the old one 10-minute window. The comments under
// each exported gate spell out the derivation from the original budget.
//
// Cost-bearing routes (usage-billed Browser Rendering spend, billing calls,
// share-PDF renders) keep the synchronous D1 atomicClaim: they need an
// exact, account-keyed ceiling and D1 serializes the conditional INSERT
// atomically. Those keep failing closed with a 503 when D1 is degraded —
// they are spend gates, not availability gates.

// E2E test mode bypass: the local fixture server sets E2E_TEST_MODE=1 (never
// set in production — wrangler configs carry "0"). The Gate-B release suite
// fires dozens of requests per viewport against the same shared rate-limit
// bucket (e.g. the 30-domain timeline render check in Journey-1, issue #1284),
// which would exhaust the public-brand-page budget before all viewports
// complete. Bypassing the limiter in e2e test mode is safe: the fixture
// server is loopback-only, has no real users, and the rate limiter exists to
// protect production from real abuse, not to gate deterministic test traffic.
function isE2ETestMode(env: AppEnv): boolean {
  return env.E2E_TEST_MODE?.trim() === "1";
}

// Verified search crawlers (Cloudflare verified-bot categories: Googlebot,
// Bingbot) must be able to recrawl the whole 87-URL sitemap in one session
// without tripping the anonymous brand-page budget (issue #2062). Cloudflare
// sets the `cf-verified-bot` header to "true" ONLY for bots it has verified
// against the operators' published IP ranges, so trusting it is safe — a
// scraper spoofing a Googlebot user-agent still gets the anonymous budget. The
// exemption is scoped to the public indexable brand-page route (the
// /ads/:domain and /timeline/:domain surfaces) and deliberately leaves every
// auth, write, and API scope untouched.
const VERIFIED_BOT_EXEMPT_SCOPES = new Set(["public-brand-page"]);

function isVerifiedSearchCrawler(request: Request): boolean {
  return request.headers.get("cf-verified-bot")?.trim().toLowerCase() === "true";
}

type EdgeLimitPolicy = {
  scope: string;
  // The Cloudflare Rate Limiting binding supports only "10s" and "60s"
  // periods. Policies keep long-run parity with the pre-binding budgets:
  // for old 10-minute windows the per-60s limit is ceil(oldLimit / 10), so
  // the sustained rate is identical and only the burst granularity changes
  // (a 20/10min budget becomes 2 per any rolling 60s, not one window of 20).
  limit: number;
  periodSeconds: 10 | 60;
  // The edge binding that enforces this policy. Capacity is configured on
  // the binding itself (wrangler.jsonc `simple: { limit, period }`) and MUST
  // match `limit` here — the binding is the enforcing counter, `limit` is
  // the declared budget the tests and this file document.
  binding: EdgeRateLimitBindingName;
  // When set, the rate-limit key is derived from this value instead of
  // IP/user-agent — e.g. an anonymous browser id or a user id, so rotating
  // IPs can't reset the bucket.
  keySeed?: string;
  keyByIpOnly?: boolean;
};

// Preserves the #1972 per-IP abuse-presence public posture while moving the
// counting to the edge binding: the IP bucket was the D1-degraded fail-open
// backstop of the live evidence in #2964.
export const PUBLIC_SEARCH_IP_BACKSTOP_LIMIT = 10;
export const PUBLIC_SEARCH_ANON_BROWSER_LIMIT = 2;
export const PUBLIC_SEARCH_SELECTION_PER_MINUTE_LIMIT = 3;
export const PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT = 12;
// Issue #2964 legacy budget was 30 per 10-minute window; the native Rate
// Limiting binding only supports 10s/60s periods, so the sustained rate
// becomes 3/60s.
export const PUBLIC_PROOF_BRIEF_PER_MINUTE_LIMIT = 3;
const EDGE_LIMIT_PERIOD_SECONDS = 60;

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

  return enforceEdgeRateLimit(request, env, policy);
}

/**
 * Anonymous /search budget (issues #1972 and #2985).
 *
 * Two stacked buckets, always in this order:
 *  1. Per-IP abuse backstop (scope "public-search-ip"): bounds a no-cookie
 *     attacker or a whole NAT fan-out. Enforced by the edge Rate Limiting
 *     binding and FAILS CLOSED with a 429 — issue #2964's live evidence
 *     showed a degraded D1 previously disabled this backstop entirely.
 *  2. Per-browser bucket keyed by `anonymousBrowserId` via `keySeed`. Each
 *     browser gets its own share of the shared IP. Same fail-closed posture —
 *     with counting off D1 there is no longer a D1 outage standing between a
 *     genuine evaluator and their budget.
 *
 * IP is checked first so an exhausted NAT/backstop 429s everyone, including a
 * brand-new browser id. A browser that already spent its own share of the
 * shared IP is then throttled by bucket 2 even when the IP still has room.
 */
export async function enforcePublicSearchRateLimit(
  request: Request,
  env: AppEnv,
  _ctx?: ExecutionContext,
  anonymousBrowserId?: string,
): Promise<Response | null> {
  const ipBackstop = await enforceEdgeRateLimit(
    request,
    env,
    {
      scope: "public-search-ip",
      limit: PUBLIC_SEARCH_IP_BACKSTOP_LIMIT,
      periodSeconds: EDGE_LIMIT_PERIOD_SECONDS,
      binding: "RL_SEARCH_IP",
      keyByIpOnly: true,
    },
  );
  if (ipBackstop) return ipBackstop;

  if (anonymousBrowserId && anonymousBrowserId.trim()) {
    const browserLimit = await enforceEdgeRateLimit(
      request,
      env,
      {
        scope: "public-search-anon-browser",
        limit: PUBLIC_SEARCH_ANON_BROWSER_LIMIT,
        periodSeconds: EDGE_LIMIT_PERIOD_SECONDS,
        binding: "RL_SEARCH_ANON_BROWSER",
        keySeed: anonymousBrowserId,
      },
    );
    if (browserLimit) return browserLimit;
  }

  return null;
}

export async function enforcePublicSearchSelectionRateLimit(
  request: Request,
  env: AppEnv,
  _ctx?: ExecutionContext,
): Promise<Response | null> {
  return enforceEdgeRateLimit(
    request,
    env,
    {
      scope: "public-search-selection",
      limit: PUBLIC_SEARCH_SELECTION_PER_MINUTE_LIMIT,
      periodSeconds: EDGE_LIMIT_PERIOD_SECONDS,
      binding: "RL_SEARCH_SELECTION",
      keyByIpOnly: true,
    },
  );
}

// Public /ads/:domain brand pages are cache-read-only (no provider spend), so
// the bucket is more generous than public search, but still bounded: each
// request costs bounded D1 reads and this is a crawl/abuse-facing surface.
export async function enforcePublicBrandPageRateLimit(
  request: Request,
  env: AppEnv,
  _ctx?: ExecutionContext,
): Promise<Response | null> {
  return enforceEdgeRateLimit(
    request,
    env,
    {
      scope: "public-brand-page",
      limit: PUBLIC_BRAND_PAGE_PER_MINUTE_LIMIT,
      periodSeconds: EDGE_LIMIT_PERIOD_SECONDS,
      binding: "RL_BRAND_PAGE",
      keyByIpOnly: true,
    },
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
// IPs doesn't reset the bucket. Cost-bearing, so it stays on the D1
// atomicClaim (exact reservation) even with the edge binding available.
export async function enforceAuthenticatedSearchRateLimit(
  request: Request,
  env: AppEnv,
  userId: string,
  ctx?: ExecutionContext,
  planFamily?: string | null,
): Promise<Response | null> {
  const burst = await enforceAtomicClaimRateLimit(
    request,
    env,
    {
      scope: "account-search",
      limit: 60,
      windowSeconds: 10 * 60,
      keySeed: userId,
      routeOverride: "account-search",
    },
    ctx,
  );
  if (burst) return burst;

  // WP-35: daily plan budget on top of the 10-minute burst.
  const plan = (planFamily ?? "free").trim().toLowerCase() || "free";
  const dailyLimit = ACCOUNT_SEARCH_DAILY_LIMITS[plan] ?? ACCOUNT_SEARCH_DAILY_LIMITS.free;
  return enforceAtomicClaimRateLimit(
    request,
    env,
    {
      scope: "account-search-daily",
      limit: dailyLimit,
      windowSeconds: 24 * 60 * 60,
      keySeed: `${userId}:${plan}`,
      routeOverride: "account-search-daily",
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
  return enforceAtomicClaimRateLimit(
    request,
    env,
    {
      scope: "search-selection",
      limit: 120,
      windowSeconds: 10 * 60,
      keySeed: userId,
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
  return enforceAtomicClaimRateLimit(
    request,
    env,
    {
      scope: policy.scope,
      limit: policy.limit,
      windowSeconds: policy.windowSeconds,
      keySeed: workspaceUserId,
      // All Dodo billing calls for this owner share the same budget, even
      // when they originate from different route pathnames.
      routeOverride: "billing-provider",
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
	return enforceAtomicClaimRateLimit(
		request,
		env,
		{
			scope: "share-pdf",
			limit: 5,
			windowSeconds: 60,
			keyByIpOnly: true,
			routeOverride: "/share/:token/pdf",
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
	return enforceAtomicClaimRateLimit(
		request,
		env,
		{
			scope: "share-pdf-daily",
			limit: 40,
			windowSeconds: 24 * 60 * 60,
			keySeed: sharerUserId,
			routeOverride: "/share/:token/pdf",
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

/**
 * Rate Limiting binding policies for the worker's global request gate
 * (workers/app.ts) and the route-level limiters above. These scopes were the
 * D1 WRITE hot path of the pre-#2985 limiter: every auth POST, every write,
 * every public API read recorded a rate_limit_events row synchronously or
 * via waitUntil, and the read scopes failed OPEN on D1 errors.
 *
 * Period mapping from the legacy D1 windows (the binding only supports 10s
 * and 60s):
 *  - scopes whose legacy window was already 60s keep their limit;
 *  - the legacy 10-minute scopes keep the same sustained rate at
 *    ceil(legacyLimit / 10) per 60s (e.g. auth 20/10min -> 2/60s).
 */
export function rateLimitPolicyFor(request: Request): EdgeLimitPolicy | null {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const pathname = normalizeRateLimitedPathname(url.pathname);

  if (method === "OPTIONS" || (method === "GET" && pathname === "/api/health")) {
    return null;
  }

  if ((method === "GET" || method === "HEAD") && pathname === "/status") {
    return { scope: "public-status", limit: 120, periodSeconds: 60, binding: "RL_STATUS", keyByIpOnly: true };
  }

  if (pathname.startsWith("/api/auth") || pathname.startsWith("/auth/")) {
    // 20/10min legacy -> same sustained 2/min at 60s burst granularity.
    return { scope: "auth", limit: 2, periodSeconds: 60, binding: "RL_AUTH" };
  }

  if (pathname.startsWith("/api/delivery-status")) {
    return { scope: "delivery-webhook", limit: 180, periodSeconds: 60, binding: "RL_DELIVERY_WEBHOOK" };
  }

  // Provider webhooks (Dodo, etc.): higher ceiling than generic writes.
  // Signature verification remains the real auth gate for these routes.
  if (pathname.startsWith("/api/webhooks/")) {
    return { scope: "webhook", limit: 300, periodSeconds: 60, binding: "RL_WEBHOOK" };
  }

  if (method !== "GET" && method !== "HEAD") {
    return { scope: "write", limit: 60, periodSeconds: 60, binding: "RL_WRITE" };
  }

  if (pathname.startsWith("/api/")) {
    // /api/demo-proof keeps its own dedicated edge bucket (issue #2964
    // budget parity): 30/10min legacy -> 3/60s, same sustained rate, fail
    // closed. A degraded edge limiter 429s the public endpoint instead of
    // silently admitting unbounded traffic.
    if (pathname === "/api/demo-proof") {
      return {
        scope: "public-proof-brief",
        limit: PUBLIC_PROOF_BRIEF_PER_MINUTE_LIMIT,
        periodSeconds: 60,
        binding: "RL_PROOF_BRIEF",
        keyByIpOnly: true,
      };
    }

    // Covers the remaining /api/* reads on the shared edge bucket.
    return { scope: "api-read", limit: 240, periodSeconds: 60, binding: "RL_API_READ" };
  }

  // Anything else (HTML page reads such as /, /search, sample-brief) stays
  // with the route-level anonymous limiters, not the generic API bucket.
  return null;
}

function normalizeRateLimitedPathname(pathname: string) {
  return pathname === "/" ? pathname : pathname.replace(/\/+$/, "");
}

/**
 * Enforce an edge-scope policy through the native Rate Limiting binding.
 *
 * Fail closed with 429 + Retry-After (issue #2985): this limiter does not
 * depend on D1 at all, so a D1 outage can no longer disable public-search
 * buckets, and a degraded/missing edge limiter returns 429 + Retry-After
 * rather than admitting unbounded traffic on a public hot path.
 *
 * The runtime contract (worker-configuration.d.ts `RateLimit`) is
 * `limit({ key })`: the capacity lives ON the binding (wrangler.jsonc
 * `simple: { limit, period }`, one binding per scope), so the call passes
 * only the bucket key.
 */
async function enforceEdgeRateLimit(
  request: Request,
  env: AppEnv,
  policy: EdgeLimitPolicy,
): Promise<Response | null> {
  if (isE2ETestMode(env)) {
    return null;
  }
  if (isVerifiedSearchCrawler(request) && VERIFIED_BOT_EXEMPT_SCOPES.has(policy.scope)) {
    return null;
  }
  const limiter = env[policy.binding];
  if (!limiter) {
    console.error(
      `[rate-limit] Rate Limiting binding ${policy.binding} missing; failing closed.`,
    );
    return tooManyRequestsResponse(policy.periodSeconds);
  }

  try {
    const keyHash = await requestKeyHash(request, policy);
    const result = await limiter.limit({ key: keyHash });
    if (result.success) return null;
    return tooManyRequestsResponse(policy.periodSeconds);
  } catch (error) {
    console.error("[rate-limit] edge limiter failed", error);
    return tooManyRequestsResponse(policy.periodSeconds);
  }
}

async function requestKeyHash(
  request: Request,
  policy: { scope: string; keySeed?: string; keyByIpOnly?: boolean },
) {
  // Only Cloudflare's `cf-connecting-ip` is trusted for the rate-limit key.
  // `x-forwarded-for` is client-controlled: where `cf-connecting-ip` is absent
  // (any future front-door change; the env layer is proxy-aware for that very
  // reason) spoofing it would mint unlimited identities. Requests without a
  // trusted client IP are keyed as `<scope>|unknown` with NO user-agent
  // component, so all headerless requests — whatever XFF or user-agent they
  // carry — share one bucket and the existing per-policy cap then applies
  // collectively to that shared bucket.
  const clientIp = request.headers.get("cf-connecting-ip");
  const userAgent = request.headers.get("user-agent") || "";
  let keyInput: string;
  if (policy.keySeed) {
    keyInput = `${policy.scope}|${policy.keySeed}`;
  } else if (clientIp) {
    keyInput = policy.keyByIpOnly
      ? `${policy.scope}|${clientIp}`
      : `${policy.scope}|${clientIp}|${userAgent}`;
  } else {
    keyInput = `${policy.scope}|unknown`;
  }
  const input = new TextEncoder().encode(keyInput);
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

export async function cleanupRateLimitEvents(env: AppEnv) {
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

type AtomicClaimRateLimitPolicy = {
  scope: string;
  limit: number;
  windowSeconds: number;
  keySeed?: string;
  // Key the budget by client IP alone, ignoring user-agent (share-pdf):
  // rotating UAs must not mint fresh buckets on a cost-bearing route.
  keyByIpOnly?: boolean;
  // When set, stored instead of the request pathname. Use for routes whose
  // pathname embeds a bearer credential (e.g. share tokens) so the token
  // never lands in the rate_limit_events table.
  routeOverride?: string;
};

// Persisted counting for the cost-bearing scopes only. Every remaining
// policy claims capacity synchronously in ONE SQL statement: D1/SQLite
// serializes the conditional INSERT atomically, so concurrent requests
// cannot all pass on a stale pre-insert count, and a one-way write is only
// paid by admitted requests. Auth/write scopes stay fail-closed when D1 is
// unavailable — these limiter stores gate spend, not just abuse.
async function enforceAtomicClaimRateLimit(
  request: Request,
  env: AppEnv,
  policy: AtomicClaimRateLimitPolicy,
  ctx?: ExecutionContext,
) {
  if (isE2ETestMode(env)) {
    return null;
  }
  if (!env.DB) {
    console.error(
      `[rate-limit] D1 binding missing; scope=${policy.scope} falls back to 429 (fail closed).`,
    );
    return rateLimitUnavailableResponse();
  }

  try {
    const url = new URL(request.url);
    const route = policy.routeOverride ?? normalizeRateLimitedPathname(url.pathname);
    const now = new Date();
    const since = new Date(now.getTime() - policy.windowSeconds * 1000).toISOString();
    const keyHash = await requestKeyHash(request, {
      scope: policy.scope,
      keySeed: policy.keySeed,
      keyByIpOnly: policy.keyByIpOnly,
    });

    // A single conditional INSERT is the reservation and the limit check.
    // D1/SQLite serializes the statement atomically, so concurrent callers
    // cannot all pass on a stale pre-insert count.
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

    return null;
  } catch (error) {
    console.error(
      `[rate-limit] limiter failed; scope=${policy.scope} falls back to 429 (fail closed).`,
      error,
    );
    if (isMissingRateLimitTableError(error)) {
      return rateLimitUnavailableResponse();
    }
    return rateLimitUnavailableResponse();
  }
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
