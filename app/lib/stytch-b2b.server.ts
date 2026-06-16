import { appOrigin, type AppEnv } from "~/lib/env.server";

export const STYTCH_SESSION_COOKIE = "f9_stytch_session";
const STYTCH_AUTH_STATE_COOKIE = "f9_stytch_state";
const STYTCH_CONFIRMATION_COOKIE = "f9_stytch_confirm";
const DEFAULT_SESSION_DURATION_MINUTES = 60 * 24 * 30;
const AUTH_REQUEST_MAX_AGE_SECONDS = 60 * 60;
const CONFIRMATION_MAX_AGE_SECONDS = 10 * 60;

interface StytchConfig {
  baseUrl: string;
  projectId: string;
  secret: string;
  sessionDurationMinutes: number;
}

export class StytchRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorType: string | null,
  ) {
    super(message);
    this.name = "StytchRequestError";
  }
}

export interface StytchMember {
  organization_id: string;
  member_id: string;
  email_address: string;
  name?: string | null;
  email_address_verified?: boolean;
}

export interface StytchOrganization {
  organization_id: string;
  organization_name: string;
  organization_slug?: string | null;
}

export interface StytchDiscoveredOrganization {
  member_authenticated?: boolean;
  organization: StytchOrganization;
  membership?: {
    type?: string;
    member?: StytchMember;
  };
}

interface StytchDiscoveryAuthentication {
  intermediate_session_token: string;
  email_address: string;
  discovered_organizations?: StytchDiscoveredOrganization[];
}

interface StytchDiscoveryOrganizationsList {
  email_address: string;
  discovered_organizations: StytchDiscoveredOrganization[];
}

export interface StytchSessionExchange {
  member_id: string;
  session_token?: string;
  session_jwt?: string;
  member: StytchMember;
  organization?: StytchOrganization;
  member_authenticated?: boolean;
  member_session?: {
    member_session_id: string;
    expires_at: string;
  };
}

interface StytchSessionAuthentication {
  member_session: {
    member_session_id: string;
    expires_at: string;
  };
  member: StytchMember;
  organization: StytchOrganization;
}

export interface StytchAuthRequest {
  email: string;
  mode: "login" | "signup";
  name: string | null;
  organizationName: string | null;
  redirectTo: string;
  state: string;
  intermediateSessionToken: string | null;
  confirmationSecret: string | null;
  confirmationNonce: string | null;
  expiresAt: string;
}

export type StytchWorkspaceCreationReason = "signup" | "team_invite" | "local_user_migration";

export function stytchSessionDurationMinutes(env: AppEnv) {
  const parsed = Number.parseInt(env.STYTCH_SESSION_DURATION_MINUTES ?? "", 10);
  if (Number.isFinite(parsed) && parsed >= 5 && parsed <= 527040) {
    return parsed;
  }
  return DEFAULT_SESSION_DURATION_MINUTES;
}

export function isStytchConfigured(env: AppEnv) {
  return Boolean(env.STYTCH_PROJECT_ID?.trim() && env.STYTCH_SECRET?.trim() && stytchRedirectOrigin(env));
}

function stytchConfig(env: AppEnv): StytchConfig {
  const projectId = env.STYTCH_PROJECT_ID?.trim();
  const secret = env.STYTCH_SECRET?.trim();

  if (!projectId || !secret) {
    throw new Error("STYTCH_PROJECT_ID and STYTCH_SECRET must be configured for Stytch auth.");
  }

  return {
    baseUrl: env.STYTCH_API_BASE_URL?.trim() || "https://test.stytch.com",
    projectId,
    secret,
    sessionDurationMinutes: stytchSessionDurationMinutes(env),
  };
}

function stytchRedirectOrigin(env: AppEnv) {
  const rawOrigin = env.APP_ORIGIN?.trim();
  if (!rawOrigin) {
    return null;
  }

  try {
    const origin = new URL(rawOrigin);
    return origin.protocol === "https:" ? origin.origin : null;
  } catch {
    return null;
  }
}

async function stytchRequest<T>(
  env: AppEnv,
  path: string,
  body: Record<string, unknown>,
  headers: HeadersInit = {},
): Promise<T> {
  const config = stytchConfig(env);
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${config.projectId}:${config.secret}`)}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error_message" in payload &&
      typeof payload.error_message === "string"
        ? payload.error_message
        : `Stytch request failed with ${response.status}.`;
    const errorType =
      typeof payload === "object" &&
      payload !== null &&
      "error_type" in payload &&
      typeof payload.error_type === "string"
        ? payload.error_type
        : null;
    throw new StytchRequestError(message, response.status, errorType);
  }

  return payload as T;
}

export async function sendDiscoveryEmail(
  env: AppEnv,
  _request: Request,
  input: {
    email: string;
    mode: "login" | "signup";
    state: string;
  },
) {
  const origin = stytchRedirectOrigin(env);
  if (!origin) {
    throw new Error("APP_ORIGIN must be configured as an HTTPS origin for Stytch auth.");
  }

  const redirectUrl = new URL("/auth/stytch/callback", origin);
  redirectUrl.searchParams.set("mode", input.mode);
  redirectUrl.searchParams.set("state", input.state);

  await stytchRequest(env, "/v1/b2b/magic_links/email/discovery/send", {
    email_address: input.email.trim().toLowerCase(),
    discovery_redirect_url: redirectUrl.toString(),
    discovery_expiration_minutes: 60,
  });
}

export async function authenticateDiscoveryMagicLink(env: AppEnv, token: string) {
  return stytchRequest<StytchDiscoveryAuthentication>(
    env,
    "/v1/b2b/magic_links/discovery/authenticate",
    {
      discovery_magic_links_token: token,
    },
  );
}

export async function exchangeIntermediateSession(
  env: AppEnv,
  input: {
    intermediateSessionToken: string;
    organizationId: string;
  },
) {
  return stytchRequest<StytchSessionExchange>(
    env,
    "/v1/b2b/discovery/intermediate_sessions/exchange",
    {
      intermediate_session_token: input.intermediateSessionToken,
      organization_id: input.organizationId,
      session_duration_minutes: stytchSessionDurationMinutes(env),
    },
  );
}

export async function listDiscoveredOrganizations(
  env: AppEnv,
  input: {
    intermediateSessionToken: string;
  },
) {
  return stytchRequest<StytchDiscoveryOrganizationsList>(
    env,
    "/v1/b2b/discovery/organizations",
    {
      intermediate_session_token: input.intermediateSessionToken,
    },
  );
}

export async function createOrganizationViaDiscovery(
  env: AppEnv,
  input: {
    intermediateSessionToken: string;
    organizationName: string;
  },
) {
  return stytchRequest<StytchSessionExchange>(env, "/v1/b2b/discovery/organizations/create", {
    intermediate_session_token: input.intermediateSessionToken,
    organization_name: input.organizationName,
    organization_slug: organizationSlug(input.organizationName),
    session_duration_minutes: stytchSessionDurationMinutes(env),
  });
}

export async function authenticateStytchSession(
  env: AppEnv,
  sessionToken: string,
  options: { extend?: boolean } = {},
) {
  const body: Record<string, unknown> = {
    session_token: sessionToken,
  };
  if (options.extend) {
    body.session_duration_minutes = stytchSessionDurationMinutes(env);
  }

  return stytchRequest<StytchSessionAuthentication>(env, "/v1/b2b/sessions/authenticate", body);
}

export async function revokeStytchSession(env: AppEnv, sessionToken: string) {
  await stytchRequest(env, "/v1/b2b/sessions/revoke", {
    session_token: sessionToken,
  });
}

export function isInvalidStytchSessionError(error: unknown) {
  return error instanceof StytchRequestError && [401, 403, 404].includes(error.status);
}

export function readStytchSessionToken(request: Request) {
  return readCookie(request, STYTCH_SESSION_COOKIE);
}

export function stytchSessionCookie(env: AppEnv, request: Request, sessionToken: string) {
  const maxAge = stytchSessionDurationMinutes(env) * 60;
  return buildCookie(STYTCH_SESSION_COOKIE, sessionToken, request, {
    httpOnly: true,
    maxAge,
  });
}

export function clearStytchSessionCookie(request: Request) {
  return buildCookie(STYTCH_SESSION_COOKIE, "", request, {
    httpOnly: true,
    maxAge: 0,
  });
}

export function authRequestStateCookie(request: Request, state: string) {
  return buildCookie(STYTCH_AUTH_STATE_COOKIE, state, request, {
    httpOnly: true,
    maxAge: AUTH_REQUEST_MAX_AGE_SECONDS,
  });
}

export function clearAuthRequestStateCookie(request: Request) {
  return buildCookie(STYTCH_AUTH_STATE_COOKIE, "", request, {
    httpOnly: true,
    maxAge: 0,
  });
}

export function stytchConfirmationCookie(request: Request, secret: string) {
  return buildCookie(STYTCH_CONFIRMATION_COOKIE, secret, request, {
    httpOnly: true,
    maxAge: CONFIRMATION_MAX_AGE_SECONDS,
  });
}

export function clearStytchConfirmationCookie(request: Request) {
  return buildCookie(STYTCH_CONFIRMATION_COOKIE, "", request, {
    httpOnly: true,
    maxAge: 0,
  });
}

export function isSameBrowserAuthRequest(request: Request, state: string) {
  return readCookie(request, STYTCH_AUTH_STATE_COOKIE) === state;
}

export function isSameOriginAuthFormPost(env: AppEnv, request: Request) {
  const allowedOrigins = new Set<string>();
  allowedOrigins.add(new URL(request.url).origin);

  const configuredOrigin = normalizedOrigin(appOrigin(env, request));
  if (configuredOrigin) {
    allowedOrigins.add(configuredOrigin);
  }

  const origin = request.headers.get("origin");
  if (origin) {
    const requestOrigin = normalizedOrigin(origin);
    return Boolean(requestOrigin && allowedOrigins.has(requestOrigin));
  }

  const referer = request.headers.get("referer");
  if (referer) {
    const refererOrigin = normalizedOrigin(referer);
    return Boolean(refererOrigin && allowedOrigins.has(refererOrigin));
  }

  return false;
}

export async function createStytchAuthRequest(
  env: AppEnv,
  input: {
    email: string;
    mode: "login" | "signup";
    name?: string | null;
    organizationName?: string | null;
    redirectTo: string;
  },
) {
  const now = new Date();
  const state = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + AUTH_REQUEST_MAX_AGE_SECONDS * 1000).toISOString();
  const db = ensureDb(env);
  await deleteExpiredStytchAuthRequests(env);
  await db.prepare(
    `
      INSERT INTO stytch_auth_request (
        state, email, mode, name, organization_name, redirect_to, created_at, updated_at, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )
    .bind(
      state,
      input.email.trim().toLowerCase(),
      input.mode,
      input.name?.trim() || null,
      input.organizationName?.trim() || null,
      input.redirectTo,
      now.toISOString(),
      now.toISOString(),
      expiresAt,
    )
    .run();

  return state;
}

export async function getLiveStytchAuthRequest(
  env: AppEnv,
  state: string,
): Promise<StytchAuthRequest | null> {
  const db = ensureDb(env);
  const row = await db.prepare(
    `
      SELECT state, email, mode, name, organization_name, redirect_to,
             intermediate_session_token, confirmation_secret, confirmation_nonce, expires_at
      FROM stytch_auth_request
      WHERE state = ?
        AND consumed_at IS NULL
        AND expires_at > ?
      LIMIT 1
    `,
  )
    .bind(state, new Date().toISOString())
    .first<{
      state: string;
      email: string;
      mode: string;
      name: string | null;
      organization_name: string | null;
      redirect_to: string;
      intermediate_session_token: string | null;
      confirmation_secret: string | null;
      confirmation_nonce: string | null;
      expires_at: string;
    }>();

  if (!row || (row.mode !== "login" && row.mode !== "signup")) {
    return null;
  }

  return {
    email: row.email,
    mode: row.mode,
    name: row.name,
    organizationName: row.organization_name,
    redirectTo: row.redirect_to,
    state: row.state,
    intermediateSessionToken: row.intermediate_session_token,
    confirmationSecret: row.confirmation_secret,
    confirmationNonce: row.confirmation_nonce,
    expiresAt: row.expires_at,
  };
}

export async function storeStytchIntermediateSession(
  env: AppEnv,
  state: string,
  input: {
    email: string;
    intermediateSessionToken: string;
  },
) {
  const db = ensureDb(env);
  await db.prepare(
    `
      UPDATE stytch_auth_request
      SET intermediate_session_token = ?,
          email = ?,
          updated_at = ?
      WHERE state = ?
        AND consumed_at IS NULL
    `,
  )
    .bind(
      input.intermediateSessionToken,
      input.email.trim().toLowerCase(),
      new Date().toISOString(),
      state,
    )
    .run();
}

export async function prepareStytchConfirmation(env: AppEnv, state: string) {
  const secret = crypto.randomUUID();
  const db = ensureDb(env);
  await db.prepare(
    `
      UPDATE stytch_auth_request
      SET confirmation_secret = ?,
          confirmation_nonce = NULL,
          updated_at = ?
      WHERE state = ?
        AND consumed_at IS NULL
    `,
  )
    .bind(secret, new Date().toISOString(), state)
    .run();
  return secret;
}

export async function rotateStytchConfirmationNonce(env: AppEnv, state: string) {
  const nonce = crypto.randomUUID();
  const db = ensureDb(env);
  await db.prepare(
    `
      UPDATE stytch_auth_request
      SET confirmation_nonce = ?,
          updated_at = ?
      WHERE state = ?
        AND consumed_at IS NULL
    `,
  )
    .bind(nonce, new Date().toISOString(), state)
    .run();
  return nonce;
}

export function verifyStytchConfirmationNonce(
  authRequest: StytchAuthRequest,
  nonce: string | null | undefined,
) {
  return Boolean(authRequest.confirmationNonce && nonce === authRequest.confirmationNonce);
}

export function verifyStytchConfirmationSecret(request: Request, authRequest: StytchAuthRequest) {
  return Boolean(
    authRequest.confirmationSecret &&
      readCookie(request, STYTCH_CONFIRMATION_COOKIE) === authRequest.confirmationSecret,
  );
}

export async function consumeStytchAuthRequest(env: AppEnv, state: string) {
  const now = new Date().toISOString();
  const db = ensureDb(env);
  await db.prepare(
    `
      UPDATE stytch_auth_request
      SET consumed_at = ?,
          updated_at = ?
      WHERE state = ?
    `,
  )
    .bind(now, now, state)
    .run();
}

export async function deleteExpiredStytchAuthRequests(env: AppEnv) {
  const db = ensureDb(env);
  await db.prepare("DELETE FROM stytch_auth_request WHERE expires_at <= ?")
    .bind(new Date().toISOString())
    .run();
}

export function stytchAuthFailurePath(mode: "login" | "signup") {
  return mode === "signup" ? "/auth/signup?error=callback_failed" : "/auth/login?error=callback_failed";
}

export function stytchNoWorkspacePath(mode: "login" | "signup") {
  return mode === "signup" ? "/auth/signup?error=no_workspace" : "/auth/login?error=no_workspace";
}

export function stytchMultipleWorkspacesPath(mode: "login" | "signup") {
  return mode === "signup"
    ? "/auth/signup?error=multiple_workspaces"
    : "/auth/login?error=multiple_workspaces";
}

export function stytchUnsupportedPolicyPath(mode: "login" | "signup") {
  return mode === "signup"
    ? "/auth/signup?error=unsupported_policy"
    : "/auth/login?error=unsupported_policy";
}

export function stytchAuthRequestMatchesEmail(authRequest: StytchAuthRequest, email: string) {
  return authRequest.email.trim().toLowerCase() === email.trim().toLowerCase();
}

export function stytchWorkspaceCreationReason(
  authRequest: Pick<StytchAuthRequest, "mode" | "organizationName" | "redirectTo">,
  options: { hasExistingLocalUser?: boolean } = {},
): StytchWorkspaceCreationReason | null {
  if (authRequest.mode === "signup" && authRequest.organizationName?.trim()) {
    return "signup";
  }
  if (authRequest.redirectTo.startsWith("/team/accept?")) {
    return "team_invite";
  }
  if (authRequest.mode === "login" && options.hasExistingLocalUser) {
    return "local_user_migration";
  }
  return null;
}

function organizationSlug(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);

  return `${normalized || "workspace"}-${crypto.randomUUID().slice(0, 8)}`;
}

function ensureDb(env: AppEnv) {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is not configured.");
  }

  return env.DB;
}

function normalizedOrigin(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return rawValue.join("=");
    }
  }

  return null;
}

function buildCookie(
  name: string,
  value: string,
  request: Request,
  options: {
    httpOnly: boolean;
    maxAge: number;
  },
) {
  const origin = new URL(request.url);
  const parts = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${options.maxAge}`,
    "SameSite=Lax",
  ];

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (origin.protocol === "https:") {
    parts.push("Secure");
  }

  return parts.join("; ");
}
