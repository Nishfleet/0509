import type { AppEnv } from "~/lib/env.server";

export const E2E_PROVIDER_NETWORK_DENY_FLAG = "E2E_PROVIDER_NETWORK_DENY";
export const E2E_PROVIDER_NETWORK_DENY_HEADER = "x-0509-e2e-test-mode";
export const E2E_PROVIDER_DATABASE_SENTINEL_ID = "local-authenticated";
export const E2E_FIXTURE_PROVIDER = "meta_library_browser" as const;
export const E2E_FIXTURE_PROVIDER_ENV_KEY = "E2E_FIXTURE_PROVIDER" as const;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type ProcessEnvCarrier = typeof globalThis & {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

type E2EProviderEnv = AppEnv & {
  [E2E_PROVIDER_NETWORK_DENY_FLAG]?: string;
};

export type E2EProviderDenyReason =
  | "enabled"
  | "non_local_http_request"
  | "missing_request_header"
  | "missing_deny_flag"
  | "missing_database"
  | "database_error"
  | "missing_sentinel"
  | "disabled_sentinel";

export interface E2EProviderDenyDecision {
  enabled: boolean;
  /** A marked local request must stop rather than fall back to live providers. */
  failClosed: boolean;
  reason: E2EProviderDenyReason;
}

/**
 * The only provider identity a verified local fixture may expose. This is a
 * label for seeded D1 cache rows, never a live provider binding.
 */
export function resolveE2EFixtureProvider(decision: E2EProviderDenyDecision) {
  return decision.enabled && decision.failClosed ? E2E_FIXTURE_PROVIDER : null;
}

export function resolveE2EFixtureProviderFromEnv(env: AppEnv) {
  return (
    denyFlagEnabled(env) &&
    (env as AppEnv & Record<string, unknown>)[E2E_FIXTURE_PROVIDER_ENV_KEY] === E2E_FIXTURE_PROVIDER
  )
    ? E2E_FIXTURE_PROVIDER
    : null;
}

function isOne(value: string | undefined) {
  return value?.trim() === "1";
}

function processEnvValue(name: string) {
  return (globalThis as ProcessEnvCarrier).process?.env?.[name];
}

function denyFlagEnabled(env: E2EProviderEnv) {
  return (
    isOne(env[E2E_PROVIDER_NETWORK_DENY_FLAG]) ||
    isOne(processEnvValue(E2E_PROVIDER_NETWORK_DENY_FLAG))
  );
}

function hasLocalHttpHost(url: URL) {
  return (
    url.protocol === "http:" &&
    url.username === "" &&
    url.password === "" &&
    LOCAL_HOSTS.has(url.hostname.toLowerCase())
  );
}

function isMarkedLocalRequest(request: Request) {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }

  return hasLocalHttpHost(url);
}

function requestHeaderEnabled(request: Request) {
  return isOne(
    request.headers.get(E2E_PROVIDER_NETWORK_DENY_HEADER) ?? undefined,
  );
}

async function readDatabaseSentinel(env: AppEnv) {
  if (!env.DB) {
    return { state: "missing_database" as const };
  }

  try {
    const row = await env.DB.prepare(
      "SELECT enabled FROM e2e_test_mode WHERE id = ? LIMIT 1",
    )
      .bind(E2E_PROVIDER_DATABASE_SENTINEL_ID)
      .first<{ enabled: number | string | null }>();

    if (!row) {
      return { state: "missing_sentinel" as const };
    }

    return {
      state:
        row.enabled === 1 || row.enabled === "1"
          ? ("enabled" as const)
          : ("disabled_sentinel" as const),
    };
  } catch {
    return { state: "database_error" as const };
  }
}

/**
 * Resolves the request-scoped provider network deny mode.
 *
 * The deny mode is opt-in and requires every marker. Once a request is marked
 * as local E2E but its isolated database sentinel cannot be verified, the
 * caller must fail closed instead of using normal provider resolution.
 */
export async function resolveE2EProviderDeny(
  env: AppEnv,
  request: Request,
): Promise<E2EProviderDenyDecision> {
  if (!isMarkedLocalRequest(request)) {
    return { enabled: false, failClosed: false, reason: "non_local_http_request" };
  }

  if (!requestHeaderEnabled(request)) {
    return { enabled: false, failClosed: false, reason: "missing_request_header" };
  }

  if (!denyFlagEnabled(env)) {
    return { enabled: false, failClosed: false, reason: "missing_deny_flag" };
  }

  const sentinel = await readDatabaseSentinel(env);
  if (sentinel.state !== "enabled") {
    return { enabled: false, failClosed: true, reason: sentinel.state };
  }

  return { enabled: true, failClosed: true, reason: "enabled" };
}

export async function isE2EProviderDenyEnabled(env: AppEnv, request: Request) {
  return (await resolveE2EProviderDeny(env, request)).enabled;
}

const PROVIDER_KEYS_TO_STRIP: ReadonlyArray<keyof AppEnv> = [
  "AI",
  "ALLOW_PLATFORM_META_API_FALLBACK",
  "BETTER_AUTH_GOOGLE_CLIENT_ID",
  "BETTER_AUTH_GOOGLE_CLIENT_SECRET",
  "BETTER_AUTH_MICROSOFT_CLIENT_ID",
  "BETTER_AUTH_MICROSOFT_CLIENT_SECRET",
  "BETTER_AUTH_MICROSOFT_ACCOUNT_LINKING_TRUSTED",
  "BETTER_AUTH_MICROSOFT_TENANT_ID",
  "BETTER_AUTH_OAUTH_BRANDED_PROVIDERS",
  "BROWSER",
  "BROWSERLESS_PROOF_ALLOWLIST_ORIGINS",
  "BROWSERLESS_TOKEN",
  "BROWSERLESS_BQL_URL",
  "BROWSER_RUN_ACCOUNT_ID",
  "BROWSER_RUN_API_TOKEN",
  "BROWSER_RUN_SESSION_REUSE",
  "CANARY_BYPASS_TOKEN", // gitleaks:allow -- configuration key name, never a credential value.
  "DODO_0509_ADAPTIVE_CURRENCY",
  "DODO_0509_ADAPTIVE_CURRENCY_FEES_INCLUSIVE",
  "DODO_0509_API_KEY",
  "DODO_0509_BRAND_ID",
  "DODO_0509_ENVIRONMENT",
  "DODO_0509_MODE",
  "DODO_0509_PRODUCT_AGENCY_MONTHLY_ID",
  "DODO_0509_PRODUCT_AGENCY_YEARLY_ID",
  "DODO_0509_PRODUCT_SCOUT_MONTHLY_ID",
  "DODO_0509_PRODUCT_SCOUT_YEARLY_ID",
  "DODO_0509_PRODUCT_PROOF_PACK_500_ID",
  "DODO_0509_PRODUCT_PROOF_PACK_2000_ID",
  "DODO_0509_PRODUCT_PROOF_PACK_7500_ID",
  "DODO_0509_PRODUCT_STARTER_MONTHLY_ID",
  "DODO_0509_PRODUCT_STARTER_YEARLY_ID",
  "DODO_0509_WEBHOOK_SECRET",
  "DODO_API_KEY",
  "DODO_PAYMENTS_API_KEY",
  "EMAIL",
  "EMAIL_FROM_EMAIL",
  "LANDING_PAGE_ARTIFACTS",
  "LAUNCH_CANARY_EMAIL",
  "META_AD_LIBRARY_TOKEN",
  "META_AD_LIBRARY_API_VERSION",
  "META_TOKEN_ENCRYPTION_SECRET",
  "MONITORING_FANOUT_MODE",
  "MONITORING_FANOUT_ALLOWLIST",
  "MONITORING_FANOUT_GLOBAL",
  "MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID",
  "MONITORING_FANOUT_MAX_INFLIGHT",
  "MONITORING_ORCHESTRATION_LEASE_MS",
  "MONITORING_ORCHESTRATION_MAX_AGE_MS",
  "MONITORING_CONCURRENCY_SLOT_LEASE_MS",
  "MONITORING_SCHEDULED_BROWSER_ALLOWLIST",
  "MONITORING_SCHEDULED_BROWSER_MODE",
  "PRESENCE_WEBSITE_ROLLOUT",
  "PRESENCE_X_ROLLOUT",
  "PRESENCE_REDDIT_ROLLOUT",
  "PRESENCE_LINKEDIN_ROLLOUT",
  "PRESENCE_DIGEST_ROLLOUT",
  "PRESENCE_OAUTH_STATE_SECRET",
  "PRESENCE_INTERNAL_WORKSPACE_ID",
  "PRESENCE_X_MOCK",
  "PRESENCE_REDDIT_MOCK",
  "PRESENCE_LINKEDIN_MOCK",
  "X_API_BEARER_TOKEN",
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
  "REDDIT_COMMERCIAL_ACCESS",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "UNSUBSCRIBE_SIGNING_SECRET",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_DELIVERY_ENABLED",
  "WHATSAPP_GRAPH_API_VERSION",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_TEMPLATE_NAMESPACE",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
];

/** Returns a new environment with provider bindings, credentials, and side-effect controls removed. */
export function sanitizeE2EProviderEnv(env: AppEnv): AppEnv {
  const sanitized = {
    ...env,
    E2E_PROVIDER_NETWORK_DENY: "1",
  };
  delete (sanitized as Record<string, unknown>)[E2E_FIXTURE_PROVIDER_ENV_KEY];
  for (const key of PROVIDER_KEYS_TO_STRIP) {
    delete sanitized[key];
  }

  return sanitized;
}

export class E2EProviderNetworkDeniedError extends Error {
  readonly code = "e2e_provider_network_denied" as const;

  constructor(url: string) {
    super(`External provider network denied for local E2E request: ${url}`);
    this.name = "E2EProviderNetworkDeniedError";
  }
}

function requestUrl(input: RequestInfo | URL, baseUrl: string) {
  if (input instanceof Request) {
    return new URL(input.url);
  }

  if (input instanceof URL) {
    return new URL(input.href);
  }

  return new URL(input, baseUrl);
}

/**
 * Creates a request-local fetch implementation. It never mutates global fetch
 * and rejects every non-local HTTP(S) target before the delegate is called.
 */
export function createE2EProviderDenyFetcher(
  localRequest: Request,
  delegate: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async (input, init) => {
    let target: URL;
    try {
      target = requestUrl(input, localRequest.url);
    } catch {
      throw new E2EProviderNetworkDeniedError(String(input));
    }

    if (
      (target.protocol === "http:" || target.protocol === "https:") &&
      !LOCAL_HOSTS.has(target.hostname.toLowerCase())
    ) {
      throw new E2EProviderNetworkDeniedError(target.href);
    }

    return delegate(input, init);
  };
}
