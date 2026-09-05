import { isE2ETestRequestEnabled } from "~/lib/e2e-auth.server";
import {
  E2E_FIXTURE_PROVIDER,
  E2E_FIXTURE_PROVIDER_ENV_KEY,
  resolveE2EFixtureProvider,
  resolveE2EProviderDeny,
} from "~/lib/e2e-provider.server";
import type { AppEnv } from "~/lib/env.server";
import type { SearchResponse } from "~/lib/types";

type ProcessEnvCarrier = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

function configuredLocalRollout() {
  return (globalThis as ProcessEnvCarrier).process?.env?.E2E_SEARCH_ROLLOUT_MODE?.trim().toLowerCase();
}

export const E2E_SEARCH_ROLLOUT_HEADER = "x-0509-e2e-search-rollout";

export type E2ELocalSearchContext = {
  env: AppEnv;
  enabled: boolean;
  fixtureProvider: "meta_library_browser" | null;
};

export async function resolveE2ELocalSearchContext(
  env: AppEnv,
  request: Request,
  rolloutMode = request.headers.get(E2E_SEARCH_ROLLOUT_HEADER)?.trim().toLowerCase() ?? configuredLocalRollout(),
): Promise<E2ELocalSearchContext> {
  const enabled = rolloutMode === "v2" && (await isE2ETestRequestEnabled(env, request));
  const fixtureProvider = resolveE2EFixtureProvider(await resolveE2EProviderDeny(env, request));
  const searchEnv = {
    ...env,
    // This marker is request-scoped and must never be trusted from a Worker
    // binding or an unmarked request.
    [E2E_FIXTURE_PROVIDER_ENV_KEY]: undefined,
    ...(enabled ? { SEARCH_ROLLOUT_MODE: "v2" } : {}),
    ...(enabled && fixtureProvider
      ? { [E2E_FIXTURE_PROVIDER_ENV_KEY]: fixtureProvider }
      : {}),
  } as AppEnv;
  return {
    env: searchEnv,
    enabled,
    fixtureProvider,
  };
}

export async function resolveE2ELocalSearchEnv(
  env: AppEnv,
  request: Request,
  rolloutMode?: string,
): Promise<AppEnv> {
  return (await resolveE2ELocalSearchContext(env, request, rolloutMode)).env;
}

/**
 * Reads an already-seeded Meta-library result from isolated D1 for a verified
 * local release request. This path never invokes fetch or a provider binding;
 * callers must pass the exact cache key produced by the normal search path.
 */
export async function resolveE2EFixtureSearchResponse(
  env: AppEnv,
  request: Request,
  cacheKey: string,
): Promise<SearchResponse | null> {
  const context = await resolveE2ELocalSearchContext(env, request);
  if (!context.enabled || context.fixtureProvider !== "meta_library_browser") return null;
  return readE2EFixtureSearchCache(context.env, cacheKey);
}

/**
 * Cache-only half of the fixture seam for provider code that already received
 * the request-scoped marker from `resolveE2ELocalSearchContext`.
 */
export async function readE2EFixtureSearchCache(
  env: AppEnv,
  cacheKey: string,
): Promise<SearchResponse | null> {
  if (
    env[E2E_FIXTURE_PROVIDER_ENV_KEY as keyof AppEnv] !== E2E_FIXTURE_PROVIDER ||
    !env.DB ||
    typeof cacheKey !== "string" ||
    cacheKey.trim() !== cacheKey ||
    cacheKey.length === 0
  ) {
    return null;
  }

  const row = await env.DB.prepare(
    `SELECT provider, payload_json, expires_at
       FROM discovery_cache_entry
      WHERE cache_key = ?
        AND provider = ?
      LIMIT 1`,
  )
    .bind(cacheKey, E2E_FIXTURE_PROVIDER)
    .first<{ provider: string; payload_json: string; expires_at: string }>();
  if (!row || row.provider !== E2E_FIXTURE_PROVIDER) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    (payload as { source?: unknown }).source !== E2E_FIXTURE_PROVIDER ||
    (payload as { provider?: unknown }).provider !== E2E_FIXTURE_PROVIDER
  ) {
    return null;
  }

  const fixture = payload as SearchResponse;
  const explicitStale =
    fixture.cacheStatus === "stale" && fixture.discoveryStatus === "cache_only";
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expiresAtMs) || (expiresAtMs <= Date.now() && !explicitStale)) {
    return null;
  }

  return {
    ...fixture,
    source: E2E_FIXTURE_PROVIDER,
    provider: E2E_FIXTURE_PROVIDER,
    cacheStatus: explicitStale ? "stale" : "hit",
  };
}
