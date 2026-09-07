import type { AppEnv } from "~/lib/env.server";

export type AuthenticatedApiActionClass = "read" | "write" | "provider_spend";

export type AuthenticatedApiIdentity = {
  workspaceUserId: string;
  actorUserId: string;
  apiKeyId: string;
};

export type AuthenticatedApiActionName =
  | "source.meta.retest"
  | "watchlist.create"
  | "watchlist.refresh"
  | "billing.checkout"
  | "billing.cancel"
  | "billing.plan_change"
  | "billing.portal"
  | "pricing.preview"
  | (string & {});

export type AuthenticatedApiLimitInput = {
  env: AppEnv;
  identity: AuthenticatedApiIdentity;
  /** Route or operation label. Never include bearer tokens or user input. */
  operation: string;
  actionName?: AuthenticatedApiActionName | null;
  actionClass?: AuthenticatedApiActionClass;
  /** Accepted for route parity; identity keys intentionally ignore all request headers. */
  request?: Request;
  now?: Date;
  isIdentityActive?: () => boolean | Promise<boolean>;
  claimer?: AuthenticatedApiAtomicClaimer;
};

export type AuthenticatedApiScopeClaim = {
  scope: string;
  keyHash: string;
  route: string;
  limit: number;
  windowSeconds: number;
};

export type AuthenticatedApiAtomicClaimer = (input: {
  env: AppEnv;
  claims: readonly AuthenticatedApiScopeClaim[];
  now: Date;
}) => Promise<boolean>;

export type AuthenticatedApiExecutionResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

export function createAuthenticatedApiLimitContext(
  env: AppEnv,
  identity: AuthenticatedApiIdentity,
) {
  return {
    identity,
    isIdentityActive: async () => {
      const { isActiveCustomerApiKey } = await import("~/lib/data.server");
      const keyActive = await isActiveCustomerApiKey(env, {
        apiKeyId: identity.apiKeyId,
        userId: identity.actorUserId,
      });
      if (!keyActive) return false;
      const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
      return (await resolveWorkspaceDataUserId(env, identity.actorUserId)) === identity.workspaceUserId;
    },
  };
}

type AuthenticatedApiPolicy = {
  actionClass: AuthenticatedApiActionClass;
  scope: string;
  limit: number;
  windowSeconds: number;
  failClosed: boolean;
  route: string;
};

const BASE_POLICIES: Record<AuthenticatedApiActionClass, Omit<AuthenticatedApiPolicy, "actionClass" | "route">> = {
  read: {
    scope: "authenticated-api-read",
    limit: 240,
    windowSeconds: 60,
    failClosed: true,
  },
  write: {
    scope: "authenticated-api-write",
    limit: 60,
    windowSeconds: 60,
    failClosed: true,
  },
  provider_spend: {
    scope: "authenticated-api-provider-spend",
    limit: 10,
    windowSeconds: 60,
    failClosed: true,
  },
};

/**
 * Provider actions get their own, smaller windows. Keeping this list explicit
 * means a route integration cannot silently treat a new provider call as an
 * ordinary write; it must add the action here or pass actionClass explicitly.
 */
export const PROVIDER_SPEND_ACTION_POLICIES: Readonly<Record<
  string,
  { limit: number; windowSeconds: number }
>> = {
  "source.meta.retest": { limit: 5, windowSeconds: 10 * 60 },
  "watchlist.create": { limit: 10, windowSeconds: 10 * 60 },
  "watchlist.refresh": { limit: 10, windowSeconds: 10 * 60 },
  "support_case.create": { limit: 5, windowSeconds: 10 * 60 },
  "billing.checkout": { limit: 5, windowSeconds: 10 * 60 },
  "billing.cancel": { limit: 5, windowSeconds: 10 * 60 },
  "billing.plan_change": { limit: 5, windowSeconds: 10 * 60 },
  "billing.portal": { limit: 10, windowSeconds: 10 * 60 },
  "billing.dodo.checkout": { limit: 5, windowSeconds: 10 * 60 },
  "billing.dodo.cancel": { limit: 5, windowSeconds: 10 * 60 },
  "billing.dodo.plan-change": { limit: 5, windowSeconds: 10 * 60 },
  "billing.dodo.portal": { limit: 10, windowSeconds: 10 * 60 },
  "pricing.preview": { limit: 30, windowSeconds: 60 },
  "api.pricing-preview": { limit: 30, windowSeconds: 60 },
};

const IDENTITY_DIMENSIONS = ["workspace", "actor", "api_key"] as const;
type IdentityDimension = (typeof IDENTITY_DIMENSIONS)[number];

export function classifyAuthenticatedApiAction(
  actionName?: string | null,
  explicitClass?: AuthenticatedApiActionClass,
): AuthenticatedApiActionClass {
  if (explicitClass) return explicitClass;
  if (actionName && Object.hasOwn(PROVIDER_SPEND_ACTION_POLICIES, actionName)) {
    return "provider_spend";
  }
  return actionName ? "write" : "read";
}

export function resolveAuthenticatedApiLimitPolicy(
  input: Pick<AuthenticatedApiLimitInput, "operation" | "actionName" | "actionClass">,
): AuthenticatedApiPolicy {
  const actionClass = classifyAuthenticatedApiAction(input.actionName, input.actionClass);
  const base = BASE_POLICIES[actionClass];
  const actionPolicy =
    actionClass === "provider_spend" && input.actionName
      ? PROVIDER_SPEND_ACTION_POLICIES[input.actionName]
      : undefined;
  const actionRoute = input.actionName ? normalizeRoute(input.actionName) : normalizeRoute(input.operation);

  return {
    actionClass,
    scope: actionPolicy ? `${base.scope}:${actionRoute}` : base.scope,
    limit: actionPolicy?.limit ?? base.limit,
    windowSeconds: actionPolicy?.windowSeconds ?? base.windowSeconds,
    failClosed: base.failClosed,
    route: actionPolicy ? `provider:${actionRoute}` : actionRoute,
  };
}

/**
 * Claims all three identity dimensions in one SQL statement. Existing
 * `rate_limit_events` is sufficient: scope separates the dimensions, key_hash
 * hides identifiers, and route separates operation windows.
 */
export async function enforceAuthenticatedApiLimit(
  input: AuthenticatedApiLimitInput,
): Promise<Response | null> {
  const policy = resolveAuthenticatedApiLimitPolicy(input);
  const identityError = validateIdentity(input.identity);
  if (identityError) return identityError;

  const identityCheck = await verifyAuthenticatedApiIdentity(input);
  if (identityCheck) return identityCheck;

  const now = input.now ?? new Date();
  const claimer = input.claimer ?? claimAuthenticatedApiScopes;
  try {
    const claimed = await claimer({
      env: input.env,
      claims: await buildClaims(input.identity, policy),
      now,
    });
    return claimed ? null : tooManyRequestsResponse(policy.windowSeconds);
  } catch (error) {
    console.error("[authenticated-api-limit]", {
      event: "claim_failed",
      actionClass: policy.actionClass,
      route: policy.route,
    });
    return policy.failClosed ? rateLimitUnavailableResponse() : null;
  }
}

/**
 * Provider callers should use this wrapper so a key revoked after the first
 * lookup is rechecked immediately before the provider callback. The callback
 * is never invoked when the identity is inactive or the spend claim fails.
 */
export async function runWithAuthenticatedApiLimit<T>(
  input: AuthenticatedApiLimitInput,
  providerCallback: () => T | Promise<T>,
): Promise<AuthenticatedApiExecutionResult<T>> {
  const response = await enforceAuthenticatedApiLimit(input);
  if (response) return { ok: false, response };

  const identityCheck = await verifyAuthenticatedApiIdentity(input);
  if (identityCheck) return { ok: false, response: identityCheck };

  // Do not await between the final identity check and callback invocation.
  // This is the narrowest local fence available before an external call.
  return { ok: true, value: await providerCallback() };
}

export async function claimAuthenticatedApiScopes(input: {
  env: AppEnv;
  claims: readonly AuthenticatedApiScopeClaim[];
  now: Date;
}): Promise<boolean> {
  if (!input.env.DB) throw new Error("D1 rate-limit storage is unavailable.");
  if (input.claims.length !== IDENTITY_DIMENSIONS.length) {
    throw new Error("Authenticated API claims must cover all identity dimensions.");
  }

  const createdAt = input.now.toISOString();
  const rows = input.claims.map((claim) => ({
    id: crypto.randomUUID(),
    ...claim,
  }));
  const values = rows.map(() => "(?, ?, ?, ?, ?)").join(", ");
  const predicates = rows
    .map(
      () =>
        `(SELECT COUNT(*) FROM rate_limit_events AS existing
            WHERE existing.scope = ?
              AND existing.key_hash = ?
              AND existing.route = ?
              AND existing.created_at >= ?) < ?`,
    )
    .join(" AND ");
  const sql = `
    WITH claims(id, scope, key_hash, route, created_at) AS (VALUES ${values})
    INSERT INTO rate_limit_events (id, scope, key_hash, route, created_at)
    SELECT id, scope, key_hash, route, created_at
      FROM claims
     WHERE ${predicates}
  `;
  const bindings: unknown[] = [];
  for (const row of rows) {
    bindings.push(row.id, row.scope, row.keyHash, row.route, createdAt);
  }
  for (const claim of input.claims) {
    bindings.push(
      claim.scope,
      claim.keyHash,
      claim.route,
      new Date(input.now.getTime() - claim.windowSeconds * 1000).toISOString(),
      claim.limit,
    );
  }

  const result = await input.env.DB.prepare(sql).bind(...bindings).run();
  return Number(result.meta?.changes ?? 0) === input.claims.length;
}

async function buildClaims(
  identity: AuthenticatedApiIdentity,
  policy: AuthenticatedApiPolicy,
): Promise<AuthenticatedApiScopeClaim[]> {
  const values: Record<IdentityDimension, string> = {
    workspace: identity.workspaceUserId,
    actor: identity.actorUserId,
    api_key: identity.apiKeyId,
  };
  return Promise.all(
    IDENTITY_DIMENSIONS.map(async (dimension) => ({
      scope: `${policy.scope}:${dimension}`,
      keyHash: await hashSubject(dimension, values[dimension]),
      route: policy.route,
      limit: policy.limit,
      windowSeconds: policy.windowSeconds,
    })),
  );
}

async function hashSubject(dimension: IdentityDimension, value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`authenticated-api|${dimension}|${value}`),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyAuthenticatedApiIdentity(
  input: Pick<AuthenticatedApiLimitInput, "operation" | "actionName" | "actionClass" | "isIdentityActive">,
) {
  if (!input.isIdentityActive) return null;
  const policy = resolveAuthenticatedApiLimitPolicy(input);
  try {
    if (await input.isIdentityActive()) return null;
    return revokedIdentityResponse();
  } catch {
    console.error("[authenticated-api-limit]", {
      event: "identity_check_failed",
      actionClass: policy.actionClass,
      route: policy.route,
    });
    return rateLimitUnavailableResponse();
  }
}

function validateIdentity(identity: AuthenticatedApiIdentity) {
  for (const [name, value] of Object.entries(identity)) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
      return Response.json(
        { error: "invalid_api_identity", message: `${name} is required.` },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  return null;
}

function normalizeRoute(value: string) {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._:/-]+/g, "_").slice(0, 120);
  return normalized || "unknown";
}

function tooManyRequestsResponse(retryAfterSeconds: number) {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: "Too many authenticated requests. Please try again shortly.",
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(Math.max(1, retryAfterSeconds)),
        "cache-control": "no-store",
      },
    },
  );
}

function rateLimitUnavailableResponse() {
  return Response.json(
    {
      error: "rate_limit_unavailable",
      message: "Request protection is temporarily unavailable.",
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "5",
      },
    },
  );
}

function revokedIdentityResponse() {
  const response = Response.json(
    {
      error: "invalid_api_key",
      message: "Use an active Five to Nine API key.",
    },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Bearer realm="0509 API"',
      },
    },
  );
  return response;
}
