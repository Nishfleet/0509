import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";

import {
  appOrigin,
	emailFromSender,
  isBetterAuthEnabled,
  isEmailSendingConfigured,
  type AppEnv,
} from "~/lib/env.server";
import { promiseWithTimeout } from "~/lib/fetch-timeout.server";
import type { AppSession } from "~/lib/types";

export const BETTER_AUTH_BASE_PATH = "/api/auth";
export const BETTER_AUTH_OAUTH_PROVIDERS = ["google", "microsoft"] as const;
export const BETTER_AUTH_EMAIL_SEND_TIMEOUT_MS = 10_000;
const BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE = "f9_better_magic";
const BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE_PATH = "/auth";
const BETTER_AUTH_MAGIC_LINK_CONFIRMATION_LEGACY_COOKIE_PATH = "/auth/better/magic-link";
const BETTER_AUTH_MAGIC_LINK_STATE_COOKIE = "f9_better_magic_state";
const BETTER_AUTH_MAGIC_LINK_CONTEXT_TTL_MS = 15 * 60 * 1000;
const BETTER_AUTH_MAGIC_LINK_STATE_COOKIE_PATH = "/auth";
const BETTER_AUTH_MAGIC_LINK_TICKET_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
export type BetterAuthOAuthProvider = (typeof BETTER_AUTH_OAUTH_PROVIDERS)[number];

export class BetterAuthUnknownUserError extends Error {
  constructor() {
    super("No Better Auth user exists for that email.");
    this.name = "BetterAuthUnknownUserError";
  }
}

export class BetterAuthMagicLinkCallbackError extends Error {
  constructor() {
    super("Better Auth magic-link callback is missing or invalid.");
    this.name = "BetterAuthMagicLinkCallbackError";
  }
}

export function isBetterAuthConfigured(env: AppEnv) {
  return Boolean(
    isBetterAuthEnabled(env) &&
      env.DB &&
      env.BETTER_AUTH_SECRET?.trim() &&
      (env.BETTER_AUTH_URL?.trim() || env.APP_ORIGIN?.trim()),
  );
}

export function enabledBetterAuthOAuthProviders(env: AppEnv): BetterAuthOAuthProvider[] {
  if (!isBetterAuthConfigured(env)) {
    return [];
  }

  return BETTER_AUTH_OAUTH_PROVIDERS.filter((provider) =>
    isBetterAuthOAuthProviderConfigured(env, provider),
  );
}

export function isBetterAuthOAuthProviderConfigured(
  env: AppEnv,
  provider: BetterAuthOAuthProvider,
) {
  if (!isBetterAuthOAuthProviderBrandVerified(env, provider)) {
    return false;
  }

  if (provider === "google") {
    return Boolean(
      env.BETTER_AUTH_GOOGLE_CLIENT_ID?.trim() &&
        env.BETTER_AUTH_GOOGLE_CLIENT_SECRET?.trim(),
    );
  }

  return Boolean(
    env.BETTER_AUTH_MICROSOFT_CLIENT_ID?.trim() &&
      env.BETTER_AUTH_MICROSOFT_CLIENT_SECRET?.trim() &&
      isBetterAuthMicrosoftAccountLinkingTrusted(env),
  );
}

function isBetterAuthOAuthProviderBrandVerified(
  env: AppEnv,
  provider: BetterAuthOAuthProvider,
) {
  return parseBetterAuthOAuthProviders(env.BETTER_AUTH_OAUTH_BRANDED_PROVIDERS).includes(provider);
}

export function isBetterAuthOAuthProvider(value: string): value is BetterAuthOAuthProvider {
  return BETTER_AUTH_OAUTH_PROVIDERS.includes(value as BetterAuthOAuthProvider);
}

export function isBetterAuthPasskeyEnabled(env: AppEnv) {
  return isBetterAuthConfigured(env);
}

export async function hasBetterAuthPasskeysForEmail(env: AppEnv, email: string) {
  if (!isBetterAuthPasskeyEnabled(env) || !env.DB || !email.trim()) {
    return false;
  }

  const row = await env.DB.prepare(
    `
      SELECT passkey.id
      FROM passkey
      JOIN user ON user.id = passkey.userId
      WHERE user.email = ? COLLATE NOCASE
      LIMIT 1
    `,
  )
    .bind(normalizeBetterAuthEmail(email))
    .first<{ id: string }>();

  return Boolean(row?.id);
}

export function getBetterAuth(env: AppEnv, request: Request) {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!isBetterAuthEnabled(env) || !env.DB || !secret) {
    throw new Error("Better Auth is not configured.");
  }

  const baseURL = betterAuthBaseURL(env, request);
  const trustedOrigins = betterAuthTrustedOrigins(env, request);
  const accountLinkingTrustedProviders = betterAuthAccountLinkingTrustedProviders(env);

  return betterAuth({
    appName: "Five to Nine",
    basePath: BETTER_AUTH_BASE_PATH,
    baseURL,
    database: env.DB,
    // Email/password sign-in stays disabled (magic link + OAuth). We still wire
    // Better Auth's emailVerification sender per official docs so OAuth/signup
    // paths that leave emailVerified=false can confirm the address. Login is
    // intentionally NOT blocked via requireEmailVerification — unverified users
    // may browse; watchlist creation and digests are gated in-app instead.
    emailAndPassword: {
      enabled: false,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        if (!isEmailSendingConfigured(env)) {
          throw new Error("Cloudflare Email is not configured for Better Auth verification.");
        }
        const { sendEmailVerificationEmail } = await import("~/lib/delivery.server");
        await promiseWithTimeout(
          sendEmailVerificationEmail(env, {
            userId: user.id,
            email: user.email,
            name: user.name ?? null,
            verifyUrl: url,
          }),
          BETTER_AUTH_EMAIL_SEND_TIMEOUT_MS,
          "Better Auth verification email timed out.",
        );
      },
      // WP-25: one welcome after verification completes (OAuth/email verify path).
      // Magic-link signup creates users already verified — covered by databaseHooks.
      afterEmailVerification: async (user) => {
        await maybeSendWelcomeEmail(env, user);
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Magic-link signup inserts emailVerified=true without firing
          // afterEmailVerification. Idempotent welcome covers both paths.
          after: async (user) => {
            const { applySignupSourceToNewUser } = await import("~/lib/signup-source");
            await applySignupSourceToNewUser(env, {
              request,
              user,
            });
            if (user.emailVerified) {
              await maybeSendWelcomeEmail(env, user);
            }
          },
        },
        update: {
          // Magic-link verify can flip emailVerified in place without
          // afterEmailVerification. FIX-4: never welcome on arbitrary profile
          // edits (name/image) for long-standing customers — only young
          // accounts (created within 7 days) may receive welcome here.
          after: async (user) => {
            if (!user.emailVerified) {
              return;
            }
            const createdMs = Date.parse(String(user.createdAt ?? ""));
            if (
              !Number.isFinite(createdMs) ||
              Date.now() - createdMs > 7 * 24 * 60 * 60 * 1000
            ) {
              return;
            }
            await maybeSendWelcomeEmail(env, user);
          },
        },
      },
    },
    account: {
      encryptOAuthTokens: true,
      ...(accountLinkingTrustedProviders.length > 0
        ? {
            accountLinking: {
              trustedProviders: accountLinkingTrustedProviders,
            },
          }
        : {}),
    },
    plugins: [
      magicLink({
        expiresIn: 15 * 60,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url, metadata }) => {
          await sendMagicLinkEmail(env, {
            email,
            mode: authModeFromMetadata(metadata),
            url,
          });
        },
      }),
      passkey({
        authenticatorSelection: {
          residentKey: "required",
          requireResidentKey: true,
        },
        origin: trustedOrigins,
        rpID: passkeyRpId(baseURL),
        rpName: "Five to Nine",
      }),
    ],
    secret,
    socialProviders: socialProviders(env),
    trustedOrigins,
    user: {
      // Surface the app-owned onboarding column on session.user so
      // getBetterAuthSession never needs a second user SELECT per request.
      additionalFields: {
        onboardedAt: {
          type: "string",
          required: false,
          input: false,
        },
      },
      deleteUser: {
        enabled: false,
      },
    },
  });
}

export async function getBetterAuthSession(
  env: AppEnv,
  request: Request,
): Promise<AppSession | null> {
  if (!isBetterAuthConfigured(env)) {
    return null;
  }

  const auth = getBetterAuth(env, request);
  const session = await auth.api.getSession({
    headers: request.headers,
    query: {
      disableCookieCache: true,
    },
  });
  if (!session) {
    return null;
  }

  // The user.additionalFields config surfaces onboardedAt on the session
  // lookup's own user join, so no second user SELECT is needed here.
  const onboardedAt = (session.user as { onboardedAt?: Date | string | null }).onboardedAt;

  return {
    session: {
      expiresAt: toIsoString(session.session.expiresAt),
      id: session.session.id,
      userId: session.session.userId,
    },
    user: {
      email: session.user.email,
      id: session.user.id,
      image: session.user.image ?? null,
      name: session.user.name,
      onboardedAt: onboardedAt == null ? null : toIsoString(onboardedAt),
    },
  };
}

export async function sendBetterAuthMagicLink(
  env: AppEnv,
  request: Request,
  input: {
    email: string;
    mode: "login" | "signup";
    name?: string;
    redirectTo: string;
  },
) {
  if (input.mode === "login" && !(await betterAuthUserExists(env, input.email))) {
    throw new BetterAuthUnknownUserError();
  }

  const auth = getBetterAuth(env, request);
  const callbackURL = absoluteAppUrl(env, request, input.redirectTo);
  const errorCallbackURL = absoluteAppUrl(
    env,
    request,
    `/auth/${input.mode}?error=callback_failed`,
  );

  await auth.api.signInMagicLink({
    body: {
      callbackURL,
      email: input.email,
      errorCallbackURL,
      metadata: {
        mode: input.mode,
      },
      name: input.name?.trim() || undefined,
      newUserCallbackURL: input.mode === "signup" ? callbackURL : undefined,
    },
    headers: request.headers,
  });

}

export async function startBetterAuthSocialSignIn(
  env: AppEnv,
  request: Request,
  input: {
    provider: BetterAuthOAuthProvider;
    mode: "login" | "signup";
    redirectTo: string;
    loginHint?: string;
  },
) {
  const auth = getBetterAuth(env, request);
  const baseURL = betterAuthBaseURL(env, request);
  const callbackURL = absoluteAppUrl(env, request, input.redirectTo);
  const errorCallbackURL = absoluteAppUrl(
    env,
    request,
    `/auth/${input.mode}?error=oauth_failed`,
  );
  const response = await auth.handler(
    new Request(new URL(`${BETTER_AUTH_BASE_PATH}/sign-in/social`, baseURL), {
      body: JSON.stringify({
        callbackURL,
        errorCallbackURL,
        loginHint: input.loginHint?.trim() || undefined,
        newUserCallbackURL: input.mode === "signup" ? callbackURL : undefined,
        provider: input.provider,
        requestSignUp: input.mode === "signup",
      }),
      headers: betterAuthJsonHeaders(request),
      method: "POST",
    }),
  );
  const result = (await response.json().catch(() => null)) as
    | {
        redirect?: boolean;
        url?: string;
      }
    | null;

  if (!response.ok || !result?.redirect || !result.url) {
    throw new Error("Better Auth did not return an OAuth redirect URL.");
  }

  return {
    headers: response.headers,
    url: result.url,
  };
}

export async function signOutBetterAuth(env: AppEnv, request: Request) {
  const auth = getBetterAuth(env, request);
  return (await auth.api.signOut({
    asResponse: true,
    headers: request.headers,
  } as never)) as Response;
}

export function clearBetterAuthSessionCookies(request: Request) {
  const names = [
    "better-auth.session_token",
    "__Secure-better-auth.session_token",
    "better-auth-session_token",
    "__Secure-better-auth-session_token",
    "better-auth.session_data",
    "__Secure-better-auth.session_data",
    "better-auth-session_data",
    "__Secure-better-auth-session_data",
    "better-auth.dont_remember",
    "__Secure-better-auth.dont_remember",
    "better-auth-dont_remember",
    "__Secure-better-auth-dont_remember",
  ];
  return names.map((name) =>
    buildBetterAuthCookie(request, name, "", {
      maxAge: 0,
      path: "/",
    }),
  );
}

export async function verifyBetterAuthMagicLink(
  env: AppEnv,
  request: Request,
  input: BetterAuthMagicLinkConfirmation,
) {
  const baseURL = betterAuthBaseURL(env, request);
  const verifyUrl = new URL(`${BETTER_AUTH_BASE_PATH}/magic-link/verify`, baseURL);
  verifyUrl.searchParams.set("token", input.token);
  verifyUrl.searchParams.set("callbackURL", input.callbackURL);
  if (input.errorCallbackURL) {
    verifyUrl.searchParams.set("errorCallbackURL", input.errorCallbackURL);
  }
  if (input.newUserCallbackURL) {
    verifyUrl.searchParams.set("newUserCallbackURL", input.newUserCallbackURL);
  }

  const headers = new Headers(request.headers);
  if (!headers.get("user-agent")) {
    headers.set("User-Agent", "Five-to-Nine/1.0");
  }

  return getBetterAuth(env, request).handler(
    new Request(verifyUrl, {
      headers,
      method: "GET",
    }),
  );
}

export function isBetterAuthMagicLinkFailureRedirect(location: string, request: Request) {
  try {
    return Boolean(new URL(location, request.url).searchParams.get("error"));
  } catch {
    return false;
  }
}

export function betterAuthResponseHasSessionCookies(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = getSetCookie ? getSetCookie.call(headers) : [];
  const combined = [...cookies, headers.get("Set-Cookie") ?? ""].join("; ");
  return combined.includes("session_token");
}

export function requestHasBetterAuthSessionCookie(request: Request) {
  const sessionCookieNames = [
    "better-auth.session_token",
    "__Secure-better-auth.session_token",
    "better-auth-session_token",
    "__Secure-better-auth-session_token",
  ];
  return sessionCookieNames.some((name) => Boolean(readCookie(request, name)));
}

export function betterAuthMagicLinkConfirmPath(
  mode: "login" | "signup",
  ticketId?: string | null,
) {
  const path = new URLSearchParams({ mode });
  if (ticketId) {
    path.set("ticket", ticketId);
  }
  return `/auth/better/magic-link?${path.toString()}`;
}

export interface BetterAuthPasskeyRecord {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface BetterAuthSessionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  isCurrent: boolean;
}

interface BetterAuthSessionApiRecord {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function listBetterAuthPasskeys(
  env: AppEnv,
  request: Request,
): Promise<BetterAuthPasskeyRecord[]> {
  if (!isBetterAuthPasskeyEnabled(env)) {
    return [];
  }

  const auth = getBetterAuth(env, request);
  const passkeys = await auth.api.listPasskeys({
    headers: request.headers,
  });

  return passkeys.map((record) => ({
    createdAt: toIsoString(record.createdAt),
    id: record.id,
    label: record.name?.trim() || "Passkey",
    lastUsedAt: null,
  }));
}

export async function listBetterAuthSessions(
  env: AppEnv,
  request: Request,
  currentSessionId: string | null,
): Promise<BetterAuthSessionSummary[]> {
  const sessions = await listBetterAuthSessionsWithTokens(env, request);
  return sessions
    .map((session) => ({
      createdAt: toIsoString(session.createdAt),
      expiresAt: toIsoString(session.expiresAt),
      id: session.id,
      ipAddress: session.ipAddress ?? null,
      isCurrent: session.id === currentSessionId,
      updatedAt: toIsoString(session.updatedAt),
      userAgent: session.userAgent ?? null,
    }))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.updatedAt.localeCompare(a.updatedAt));
}

export async function revokeBetterAuthSessionById(
  env: AppEnv,
  request: Request,
  input: {
    sessionId: string;
    currentSessionId: string | null;
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) {
    return { ok: false, reason: "Choose a session to revoke." };
  }

  const sessions = await listBetterAuthSessionsWithTokens(env, request);
  const selected = sessions.find((session) => session.id === sessionId);
  if (!selected) {
    return { ok: false, reason: "That session is no longer active." };
  }
  if (selected.id === input.currentSessionId) {
    return { ok: false, reason: "Use Sign out to end the session on this device." };
  }

  const auth = getBetterAuth(env, request);
  await auth.api.revokeSession({
    body: {
      token: selected.token,
    },
    headers: request.headers,
  });

  return { ok: true };
}

export async function revokeOtherBetterAuthSessions(env: AppEnv, request: Request) {
  const auth = getBetterAuth(env, request);
  await auth.api.revokeOtherSessions({
    headers: request.headers,
  });
}

async function listBetterAuthSessionsWithTokens(
  env: AppEnv,
  request: Request,
): Promise<BetterAuthSessionApiRecord[]> {
  const auth = getBetterAuth(env, request);
  return (await auth.api.listSessions({
    headers: request.headers,
  })) as BetterAuthSessionApiRecord[];
}

export function isSameOriginAuthFormPost(env: AppEnv, request: Request) {
  if (request.method.toUpperCase() !== "POST") {
    return false;
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const presentedOrigin = origin ?? originFromUrl(referer);
  if (!presentedOrigin) {
    return false;
  }

  const allowedOrigins = new Set(
    betterAuthTrustedOrigins(env, request)
      .map((value) => originFromUrl(value))
      .filter((value): value is string => Boolean(value)),
  );
  allowedOrigins.add(new URL(request.url).origin);
  return allowedOrigins.has(presentedOrigin);
}

export function appendBetterAuthSetCookieHeaders(target: Headers, source: Headers | undefined) {
  if (!source) {
    return;
  }

  const getSetCookie = (source as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = getSetCookie ? getSetCookie.call(source) : [];
  if (cookies.length > 0) {
    for (const cookie of cookies) {
      for (const parsed of splitCombinedSetCookieHeader(cookie)) {
        target.append("Set-Cookie", parsed);
      }
    }
    return;
  }

  const combined = source.get("Set-Cookie");
  if (!combined) {
    return;
  }

  for (const cookie of splitCombinedSetCookieHeader(combined)) {
    target.append("Set-Cookie", cookie);
  }
}

function splitCombinedSetCookieHeader(setCookie: string) {
  const cookies: string[] = [];
  let start = 0;

  for (let index = 0; index < setCookie.length; index += 1) {
    if (setCookie[index] !== ",") {
      continue;
    }

    let cursor = index + 1;
    while (cursor < setCookie.length && setCookie[cursor] === " ") {
      cursor += 1;
    }

    let tokenEnd = cursor;
    while (
      tokenEnd < setCookie.length &&
      setCookie[tokenEnd] !== "=" &&
      setCookie[tokenEnd] !== ";" &&
      setCookie[tokenEnd] !== ","
    ) {
      tokenEnd += 1;
    }

    if (tokenEnd < setCookie.length && setCookie[tokenEnd] === "=") {
      const cookie = setCookie.slice(start, index).trim();
      if (cookie) {
        cookies.push(cookie);
      }
      start = index + 1;
      while (start < setCookie.length && setCookie[start] === " ") {
        start += 1;
      }
      index = start - 1;
    }
  }

  const last = setCookie.slice(start).trim();
  if (last) {
    cookies.push(last);
  }

  return cookies;
}

function appendSetCookies(headers: Headers, cookies: string[]) {
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
}

export function appendHeadersSetCookies(target: Headers, source: Headers) {
  const getSetCookie = (source as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = getSetCookie ? getSetCookie.call(source) : [];
  if (cookies.length > 0) {
    for (const cookie of cookies) {
      target.append("Set-Cookie", cookie);
    }
    return;
  }

  const combined = source.get("Set-Cookie");
  if (combined) {
    for (const cookie of splitCombinedSetCookieHeader(combined)) {
      target.append("Set-Cookie", cookie);
    }
  }
}

export interface BetterAuthMagicLinkConfirmation {
  token: string;
  callbackURL: string;
  email?: string;
  newUserCallbackURL?: string;
  errorCallbackURL?: string;
}

export function betterAuthBaseURL(env: AppEnv, request: Request) {
  return removeTrailingSlash(env.BETTER_AUTH_URL?.trim() || appOrigin(env, request));
}

function betterAuthTrustedOrigins(env: AppEnv, request: Request) {
  return [
    betterAuthBaseURL(env, request),
    appOrigin(env, request),
    new URL(request.url).origin,
    ...parseOriginList(env.BETTER_AUTH_TRUSTED_ORIGINS),
  ]
    .map((value) => removeTrailingSlash(value))
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
}

function socialProviders(env: AppEnv) {
  const providers: {
    google?: { clientId: string; clientSecret: string; disableImplicitSignUp: true };
    microsoft?: {
      clientId: string;
      clientSecret: string;
      disableImplicitSignUp: true;
      tenantId?: string;
    };
  } = {};

  const googleClientId = env.BETTER_AUTH_GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = env.BETTER_AUTH_GOOGLE_CLIENT_SECRET?.trim();
  if (isBetterAuthOAuthProviderBrandVerified(env, "google") && googleClientId && googleClientSecret) {
    providers.google = {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      disableImplicitSignUp: true,
    };
  }

  const microsoftClientId = env.BETTER_AUTH_MICROSOFT_CLIENT_ID?.trim();
  const microsoftClientSecret = env.BETTER_AUTH_MICROSOFT_CLIENT_SECRET?.trim();
  if (
    isBetterAuthOAuthProviderBrandVerified(env, "microsoft") &&
    isBetterAuthMicrosoftAccountLinkingTrusted(env) &&
    microsoftClientId &&
    microsoftClientSecret
  ) {
    providers.microsoft = {
      clientId: microsoftClientId,
      clientSecret: microsoftClientSecret,
      disableImplicitSignUp: true,
      tenantId: env.BETTER_AUTH_MICROSOFT_TENANT_ID?.trim() || "common",
    };
  }

  return providers;
}

function betterAuthAccountLinkingTrustedProviders(env: AppEnv) {
  return isBetterAuthMicrosoftAccountLinkingTrusted(env) ? ["microsoft"] : [];
}

function isBetterAuthMicrosoftAccountLinkingTrusted(env: AppEnv) {
  return parseBooleanFlag(env.BETTER_AUTH_MICROSOFT_ACCOUNT_LINKING_TRUSTED);
}

function parseBetterAuthOAuthProviders(value: string | undefined): BetterAuthOAuthProvider[] {
  const parsed = new Set<BetterAuthOAuthProvider>();
  for (const item of (value ?? "").split(",")) {
    const provider = item.trim().toLowerCase();
    if (isBetterAuthOAuthProvider(provider)) {
      parsed.add(provider);
    }
  }
  return [...parsed];
}

function betterAuthJsonHeaders(request: Request) {
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  return headers;
}

async function sendMagicLinkEmail(
  env: AppEnv,
  input: {
    email: string;
    mode: "login" | "signup";
    url: string;
  },
) {
  if (!isEmailSendingConfigured(env)) {
    throw new Error("Cloudflare Email is not configured for Better Auth magic links.");
  }

  const email = buildBetterAuthMagicLinkEmail({
    mode: input.mode,
    url: await betterAuthMagicLinkConfirmationUrl(env, {
      email: input.email,
      mode: input.mode,
      url: input.url,
    }),
  });
  await promiseWithTimeout(
    Promise.resolve().then(() =>
      env.EMAIL!.send({
				from: emailFromSender(env),
        html: email.html,
        subject: email.subject,
        text: email.text,
        to: input.email,
      }),
    ),
    BETTER_AUTH_EMAIL_SEND_TIMEOUT_MS,
    "Better Auth magic-link email timed out.",
  );
}

async function betterAuthUserExists(env: AppEnv, email: string) {
  if (!env.DB) {
    return false;
  }

  const row = await env.DB.prepare("SELECT id FROM user WHERE email = ? COLLATE NOCASE LIMIT 1")
    .bind(email.trim().toLowerCase())
    .first<{ id: string }>();
  return Boolean(row?.id);
}

interface BetterAuthMagicLinkConfirmationTicket extends BetterAuthMagicLinkConfirmation {
  expiresAt: number;
  mode: "login" | "signup";
}

interface BetterAuthMagicLinkTicketCookie {
  expiresAt: number;
  mode: "login" | "signup";
  ticketId: string;
}

interface BetterAuthMagicLinkTicketRow {
  consumed_at: string | null;
  expires_at: string;
  id: string;
  mode: "login" | "signup";
  payload: string;
}

export async function betterAuthMagicLinkConfirmationUrl(
  env: AppEnv,
  input: {
    email: string;
    mode: "login" | "signup";
    url: string;
  },
) {
  const url = new URL(input.url);
  const ticketId = await createBetterAuthMagicLinkTicket(env, {
    ...betterAuthMagicLinkConfirmationFromUrl(url),
    email: normalizeBetterAuthEmail(input.email),
    mode: input.mode,
  });

  const confirmationUrl = new URL("/auth/better/magic-link", url.origin);
  confirmationUrl.searchParams.set("ticket", ticketId);
  confirmationUrl.searchParams.set("mode", input.mode);
  return confirmationUrl.toString();
}

export async function betterAuthMagicLinkConfirmationTicketCookie(
  env: AppEnv,
  request: Request,
  input: { ticketId: string },
) {
  const row = await readBetterAuthMagicLinkTicketRow(env, input.ticketId);
  const expiresAt = row ? Date.parse(row.expires_at) : Number.NaN;
  if (!row || row.consumed_at || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    throw new BetterAuthMagicLinkCallbackError();
  }
  const payload = await parseBetterAuthMagicLinkTicketPayload(env, request, row, expiresAt);
  if (!payload) {
    throw new BetterAuthMagicLinkCallbackError();
  }

  const cookieValue = await encryptBetterAuthMagicLinkPayload(env, {
    expiresAt,
    mode: payload.mode,
    ticketId: input.ticketId,
  });

  return {
    cookie: buildBetterAuthCookie(
      request,
      BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE,
      cookieValue,
      {
        maxAge: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
        path: BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE_PATH,
      },
    ),
    mode: payload.mode,
  };
}

export async function betterAuthLegacyMagicLinkConfirmationTicketCookie(
  env: AppEnv,
  request: Request,
  input: { mode: "login" | "signup" },
) {
  const url = new URL(request.url);
  const requestState = url.searchParams.get("state") || "";
  if (!hasBetterAuthMagicLinkRequestState(request, requestState)) {
    throw new BetterAuthMagicLinkCallbackError();
  }

  const confirmation = betterAuthMagicLinkConfirmationFromUrl(url);
  return buildBetterAuthCookie(
    request,
    BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE,
    await encryptBetterAuthMagicLinkPayload(env, {
      ...confirmation,
      expiresAt: Date.now() + BETTER_AUTH_MAGIC_LINK_CONTEXT_TTL_MS,
      mode: input.mode,
    }),
    {
      maxAge: 15 * 60,
      path: BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE_PATH,
    },
  );
}

export async function readBetterAuthMagicLinkConfirmationTicket(
  env: AppEnv,
  request: Request,
): Promise<
  Omit<
    BetterAuthMagicLinkConfirmationTicket,
    "callbackURL" | "token"
  > & { emailHint?: string; ticketId?: string } | null
> {
  for (const ticketId of await readBetterAuthMagicLinkTicketIds(env, request)) {
    const row = await readBetterAuthMagicLinkTicketRow(env, ticketId);
    const expiresAt = row ? Date.parse(row.expires_at) : Number.NaN;
    if (!row || row.consumed_at || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      continue;
    }

    const payload = await parseBetterAuthMagicLinkTicketPayload(env, request, row, expiresAt);
    if (!payload?.email) {
      continue;
    }

    return {
      email: payload.email,
      emailHint: maskEmail(payload.email),
      expiresAt,
      mode: row.mode,
      ticketId,
    };
  }

  const legacy = await readBetterAuthLegacyMagicLinkConfirmationCookie(env, request);
  return legacy
    ? {
        email: "",
        emailHint: "",
        expiresAt: legacy.expiresAt,
        mode: legacy.mode,
      }
    : null;
}

export async function readBetterAuthMagicLinkVerificationTicket(
  env: AppEnv,
  request: Request,
): Promise<BetterAuthMagicLinkConfirmationTicket | null> {
  for (const ticketId of await readBetterAuthMagicLinkTicketIds(env, request)) {
    const row = await readBetterAuthMagicLinkTicketRow(env, ticketId);
    const expiresAt = row ? Date.parse(row.expires_at) : Number.NaN;
    if (!row || row.consumed_at || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      continue;
    }

    const confirmation = await parseBetterAuthMagicLinkTicketPayload(env, request, row, expiresAt);
    if (confirmation) {
      return confirmation;
    }
  }

  return readBetterAuthLegacyMagicLinkConfirmationCookie(env, request);
}

export async function consumeBetterAuthMagicLinkConfirmationTicket(
  env: AppEnv,
  request: Request,
) {
  for (const ticketId of await readBetterAuthMagicLinkTicketIds(env, request)) {
    const row = await readBetterAuthMagicLinkTicketRow(env, ticketId);
    const expiresAt = row ? Date.parse(row.expires_at) : Number.NaN;
    if (row && !row.consumed_at && Number.isFinite(expiresAt) && expiresAt > Date.now()) {
      return consumeBetterAuthMagicLinkTicketRow(env, row.id);
    }
  }

  return Boolean(await readBetterAuthLegacyMagicLinkConfirmationCookie(env, request));
}

async function consumeBetterAuthMagicLinkTicketRow(env: AppEnv, storageId: string) {
  const now = new Date().toISOString();
  const result = await env.DB!.prepare(
    `
      UPDATE better_auth_magic_link_ticket
      SET consumed_at = ?
      WHERE id = ?
        AND consumed_at IS NULL
        AND expires_at > ?
    `,
  )
    .bind(now, storageId, now)
    .run();

  return d1ChangedRows(result) === 1;
}

async function readBetterAuthLegacyMagicLinkConfirmationCookie(
  env: AppEnv,
  request: Request,
): Promise<BetterAuthMagicLinkConfirmationTicket | null> {
  for (const cookie of readCookies(request, BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE)) {
    const parsed = await decryptBetterAuthMagicLinkPayload(env, cookie);
    if (
      !parsed ||
      typeof parsed.callbackURL !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      (parsed.mode !== "login" && parsed.mode !== "signup") ||
      typeof parsed.token !== "string" ||
      parsed.expiresAt < Date.now()
    ) {
      continue;
    }

    const origin = new URL(betterAuthBaseURL(env, request)).origin;
    const callbackURL = parseSameOriginUrl(parsed.callbackURL, origin);
    const errorCallbackURL =
      typeof parsed.errorCallbackURL === "string"
        ? parseSameOriginUrl(parsed.errorCallbackURL, origin)
        : undefined;
    const newUserCallbackURL =
      typeof parsed.newUserCallbackURL === "string"
        ? parseSameOriginUrl(parsed.newUserCallbackURL, origin)
        : undefined;
    if (
      !callbackURL ||
      (typeof parsed.errorCallbackURL === "string" && !errorCallbackURL) ||
      (typeof parsed.newUserCallbackURL === "string" && !newUserCallbackURL)
    ) {
      continue;
    }

    return {
      callbackURL,
      expiresAt: parsed.expiresAt,
      mode: parsed.mode,
      ...(errorCallbackURL ? { errorCallbackURL } : {}),
      ...(newUserCallbackURL ? { newUserCallbackURL } : {}),
      token: parsed.token,
    };
  }

  return null;
}

async function parseBetterAuthMagicLinkTicketPayload(
  env: AppEnv,
  request: Request,
  row: BetterAuthMagicLinkTicketRow,
  expiresAt: number,
): Promise<BetterAuthMagicLinkConfirmationTicket | null> {
  const parsed = await decryptBetterAuthMagicLinkPayload(env, row.payload);
  if (
    !parsed ||
    typeof parsed.callbackURL !== "string" ||
    typeof parsed.email !== "string" ||
    (parsed.mode !== "login" && parsed.mode !== "signup") ||
    typeof parsed.token !== "string"
  ) {
    return null;
  }

  const origin = new URL(betterAuthBaseURL(env, request)).origin;
  const callbackURL = parseSameOriginUrl(parsed.callbackURL, origin);
  const errorCallbackURL =
    typeof parsed.errorCallbackURL === "string"
      ? parseSameOriginUrl(parsed.errorCallbackURL, origin)
      : undefined;
  const newUserCallbackURL =
    typeof parsed.newUserCallbackURL === "string"
      ? parseSameOriginUrl(parsed.newUserCallbackURL, origin)
      : undefined;
  if (
    !callbackURL ||
    (typeof parsed.errorCallbackURL === "string" && !errorCallbackURL) ||
    (typeof parsed.newUserCallbackURL === "string" && !newUserCallbackURL)
  ) {
    return null;
  }

  return {
    callbackURL,
    email: normalizeBetterAuthEmail(parsed.email),
    expiresAt,
    mode: parsed.mode,
    ...(errorCallbackURL ? { errorCallbackURL } : {}),
    ...(newUserCallbackURL ? { newUserCallbackURL } : {}),
    token: parsed.token,
  };
}

async function readBetterAuthMagicLinkTicketIds(env: AppEnv, request: Request) {
  const url = new URL(request.url);
  const ticketFromUrl = url.searchParams.get("ticket");
  const ticketIds: string[] = [];
  if (ticketFromUrl && isBetterAuthMagicLinkTicketId(ticketFromUrl)) {
    ticketIds.push(ticketFromUrl);
  }

  for (const ticket of await readBetterAuthMagicLinkConfirmationCookies(env, request)) {
    if (!ticketIds.includes(ticket.ticketId)) {
      ticketIds.push(ticket.ticketId);
    }
  }

  return ticketIds;
}

export async function readBetterAuthMagicLinkConfirmationCookie(
  env: AppEnv,
  request: Request,
): Promise<BetterAuthMagicLinkTicketCookie | null> {
  return (await readBetterAuthMagicLinkConfirmationCookies(env, request))[0] ?? null;
}

async function readBetterAuthMagicLinkConfirmationCookies(
  env: AppEnv,
  request: Request,
): Promise<BetterAuthMagicLinkTicketCookie[]> {
  const tickets: BetterAuthMagicLinkTicketCookie[] = [];
  for (const cookie of readCookies(request, BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE)) {
    const parsed = await decryptBetterAuthMagicLinkPayload(env, cookie);
    if (
      !parsed ||
      typeof parsed.expiresAt !== "number" ||
      (parsed.mode !== "login" && parsed.mode !== "signup") ||
      typeof parsed.ticketId !== "string" ||
      !isBetterAuthMagicLinkTicketId(parsed.ticketId) ||
      parsed.expiresAt < Date.now()
    ) {
      continue;
    }

    tickets.push({
      expiresAt: parsed.expiresAt,
      mode: parsed.mode,
      ticketId: parsed.ticketId,
    });
  }

  return tickets;
}

async function createBetterAuthMagicLinkTicket(
  env: AppEnv,
  input: BetterAuthMagicLinkConfirmation & {
    mode: "login" | "signup";
  },
) {
  if (!env.DB) {
    throw new BetterAuthMagicLinkCallbackError();
  }

  const ticketId = randomBetterAuthState();
  const storageId = await betterAuthMagicLinkTicketStorageId(env, ticketId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + BETTER_AUTH_MAGIC_LINK_CONTEXT_TTL_MS);
  const payload = await encryptBetterAuthMagicLinkPayload(env, {
    ...input,
    expiresAt: expiresAt.getTime(),
  });

  await env.DB.prepare(
    `
      INSERT INTO better_auth_magic_link_ticket (
        id,
        mode,
        payload,
        created_at,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
  )
    .bind(storageId, input.mode, payload, now.toISOString(), expiresAt.toISOString())
    .run();

  return ticketId;
}

async function readBetterAuthMagicLinkTicketRow(
  env: AppEnv,
  ticketId: string,
): Promise<BetterAuthMagicLinkTicketRow | null> {
  if (!env.DB || !isBetterAuthMagicLinkTicketId(ticketId)) {
    return null;
  }
  const storageId = await betterAuthMagicLinkTicketStorageId(env, ticketId);

  return env.DB.prepare(
    `
      SELECT id, mode, payload, expires_at, consumed_at
      FROM better_auth_magic_link_ticket
      WHERE id = ?
      LIMIT 1
    `,
  )
    .bind(storageId)
    .first<BetterAuthMagicLinkTicketRow>();
}

function d1ChangedRows(result: unknown) {
  return Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);
}

export function clearBetterAuthMagicLinkConfirmationCookies(request: Request) {
  return [
    ...clearBetterAuthMagicLinkConfirmationCookiePath(
      request,
      BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE_PATH,
    ),
    ...clearBetterAuthMagicLinkConfirmationCookiePath(
      request,
      BETTER_AUTH_MAGIC_LINK_CONFIRMATION_LEGACY_COOKIE_PATH,
    ),
  ];
}

function clearBetterAuthMagicLinkConfirmationCookiePath(request: Request, path: string) {
  const cookies = [
    buildBetterAuthCookie(request, BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE, "", {
      maxAge: 0,
      path,
    }),
  ];
  const domain = parentAuthCookieDomain(request);
  if (domain) {
    cookies.push(
      buildBetterAuthCookie(request, BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE, "", {
        domain,
        maxAge: 0,
        path,
      }),
    );
  }
  return cookies;
}

export function clearBetterAuthLegacyMagicLinkConfirmationCookies(request: Request) {
  return clearBetterAuthMagicLinkConfirmationCookiePath(
    request,
    BETTER_AUTH_MAGIC_LINK_CONFIRMATION_LEGACY_COOKIE_PATH,
  );
}

export function replacementBetterAuthMagicLinkConfirmationCookies(request: Request, cookie: string) {
  return [
    ...clearBetterAuthMagicLinkConfirmationCookiePath(
      request,
      BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE_PATH,
    ),
    ...clearBetterAuthLegacyMagicLinkConfirmationCookies(request),
    cookie,
  ];
}

export function clearBetterAuthMagicLinkStateCookies(request: Request) {
  return [
    buildBetterAuthCookie(request, BETTER_AUTH_MAGIC_LINK_STATE_COOKIE, "", {
      domain: parentAuthCookieDomain(request),
      maxAge: 0,
      path: BETTER_AUTH_MAGIC_LINK_STATE_COOKIE_PATH,
    }),
    buildBetterAuthCookie(request, BETTER_AUTH_MAGIC_LINK_STATE_COOKIE, "", {
      domain: parentAuthCookieDomain(request),
      maxAge: 0,
      path: "/auth/better/magic-link",
    }),
  ];
}

function betterAuthMagicLinkConfirmationFromUrl(url: URL): BetterAuthMagicLinkConfirmation {
  const token = url.searchParams.get("token") || "";
  if (!token) {
    throw new BetterAuthMagicLinkCallbackError();
  }

  return {
    callbackURL: sameOriginMagicLinkUrl(url, "callbackURL", "/app"),
    errorCallbackURL: optionalSameOriginMagicLinkUrl(url, "errorCallbackURL"),
    newUserCallbackURL: optionalSameOriginMagicLinkUrl(url, "newUserCallbackURL"),
    token,
  };
}

export function normalizeBetterAuthMagicLinkEmail(value: string) {
  return normalizeBetterAuthEmail(value);
}

export function buildBetterAuthMagicLinkEmail(input: {
  mode: "login" | "signup";
  url: string;
}) {
  const isSignup = input.mode === "signup";
	const subject = isSignup ? "Activate your Five to Nine workspace" : "Sign in to Five to Nine";
  const heading = isSignup ? "Activate your Five to Nine workspace" : "Sign in to Five to Nine";
	const kicker = isSignup ? "Five to Nine account activation" : "Five to Nine sign in";
  const action = isSignup ? "Activate account" : "Sign in";
  const preview = isSignup
    ? "Confirm this request to activate your Five to Nine workspace."
    : "Confirm this request to open your Five to Nine account.";
  const htmlUrl = escapeHtml(input.url);

  return {
    html: [
      '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">',
      escapeHtml(preview),
      "</div>",
      '<div style="font-family: Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; background-color:#ffffff; color:#101828; line-height:1.55; padding:0;">',
      `<p style="margin:0 0 8px; color:#667085; font-size:13px; letter-spacing:.08em; text-transform:uppercase;">${escapeHtml(kicker)}</p>`,
      `<h1 style="margin:0 0 16px; font-size:24px; line-height:1.25; font-weight:700;">${escapeHtml(heading)}</h1>`,
      `<p style="margin:0 0 22px; color:#344054; font-size:15px;">${escapeHtml(preview)}</p>`,
      '<p style="margin:0 0 24px;">',
      `<a href="${htmlUrl}" style="display:inline-block; background-color:#101828; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:8px; font-weight:700;">${escapeHtml(action)}</a>`,
      "</p>",
      '<p style="margin:0 0 10px; color:#667085; font-size:13px;">This link expires in 15 minutes. If you did not request it, you can ignore this email.</p>',
      '<p style="margin:0; color:#98a2b3; font-size:12px;">Five to Nine - 0509.io</p>',
      "</div>",
    ].join(""),
    subject,
    text: [
      heading,
      "",
      preview,
      "",
      `${action}: ${input.url}`,
      "",
      "This link expires in 15 minutes. If you did not request it, you can ignore this email.",
      "",
      "Five to Nine - 0509.io",
    ].join("\n"),
  };
}

function absoluteAppUrl(env: AppEnv, request: Request, path: string) {
  return new URL(path, betterAuthBaseURL(env, request)).toString();
}

function passkeyRpId(baseURL: string) {
  const hostname = new URL(baseURL).hostname.toLowerCase();
  if (hostname === "www.0509.io" || hostname.endsWith(".0509.io")) {
    return "0509.io";
  }
  if (hostname === "www.0509.in" || hostname.endsWith(".0509.in")) {
    return "0509.in";
  }
  return hostname;
}

function normalizeBetterAuthEmail(value: string) {
  return value.trim().toLowerCase();
}

function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  if (!local || !domain) {
    return "this email";
  }
  const visibleLocal =
    local.length <= 2 ? `${local[0] ?? ""}...` : `${local.slice(0, 2)}...${local.slice(-1)}`;
  return `${visibleLocal}@${domain}`;
}

function parseOriginList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parseBooleanFlag(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function removeTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function buildBetterAuthCookie(
  request: Request,
  name: string,
  value: string,
  options: {
    domain?: string;
    maxAge: number;
    path: string;
  },
) {
  const parts = [
    `${name}=${value}`,
    "HttpOnly",
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    "SameSite=Lax",
  ];
  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }
  if (new URL(request.url).protocol === "https:") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function readCookie(request: Request, name: string) {
  return readCookies(request, name)[0] ?? null;
}

function readCookies(request: Request, name: string) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith(`${name}=`))
    .map((cookie) => cookie.slice(name.length + 1));
}

async function encryptBetterAuthMagicLinkPayload(
  env: AppEnv,
  payload: Record<string, unknown>,
) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    await betterAuthMagicLinkContextKey(env),
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `v1.${base64UrlEncodeBytes(iv)}.${base64UrlEncodeBytes(new Uint8Array(encrypted))}`;
}

async function decryptBetterAuthMagicLinkPayload(env: AppEnv, value: string) {
  try {
    const [version, encodedIv, encodedCiphertext, extra] = value.split(".");
    if (version !== "v1" || !encodedIv || !encodedCiphertext || extra !== undefined) {
      return null;
    }
    const decrypted = await crypto.subtle.decrypt(
      { iv: base64UrlToBytes(encodedIv), name: "AES-GCM" },
      await betterAuthMagicLinkContextKey(env),
      base64UrlToBytes(encodedCiphertext),
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function betterAuthMagicLinkContextKey(env: AppEnv) {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new BetterAuthMagicLinkCallbackError();
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`0509:better-auth:magic-link-context:${secret}`),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt", "encrypt"]);
}

async function betterAuthMagicLinkTicketStorageId(env: AppEnv, ticketId: string) {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new BetterAuthMagicLinkCallbackError();
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`0509:better-auth:magic-link-ticket:${ticketId}`),
  );
  return `v1.${base64UrlEncodeBytes(new Uint8Array(digest))}`;
}

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function originFromUrl(value: string | null) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function authModeFromMetadata(metadata: Record<string, unknown> | undefined): "login" | "signup" {
  return metadata?.mode === "signup" ? "signup" : "login";
}

function randomBetterAuthState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

function isBetterAuthMagicLinkTicketId(value: string) {
  return BETTER_AUTH_MAGIC_LINK_TICKET_ID_PATTERN.test(value);
}

function hasBetterAuthMagicLinkRequestState(request: Request, requestState: string) {
  return Boolean(
    requestState && readCookies(request, BETTER_AUTH_MAGIC_LINK_STATE_COOKIE).includes(requestState),
  );
}


function parentAuthCookieDomain(request: Request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  if (hostname === "0509.io" || hostname.endsWith(".0509.io")) {
    return "0509.io";
  }
  if (hostname === "0509.in" || hostname.endsWith(".0509.in")) {
    return "0509.in";
  }
  return undefined;
}

function sameOriginMagicLinkUrl(url: URL, key: string, fallback: string) {
  const value = url.searchParams.get(key) || fallback;
  const parsed = parseSameOriginUrl(value, url.origin);
  if (!parsed) {
    throw new BetterAuthMagicLinkCallbackError();
  }
  return parsed;
}

function optionalSameOriginMagicLinkUrl(url: URL, key: string) {
  const value = url.searchParams.get(key);
  if (!value) {
    return undefined;
  }
  const parsed = parseSameOriginUrl(value, url.origin);
  if (!parsed) {
    throw new BetterAuthMagicLinkCallbackError();
  }
  return parsed;
}

function parseSameOriginUrl(value: string, origin: string) {
  try {
    const parsed = new URL(value, origin);
    return parsed.origin === origin ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * WP-25 welcome: fire-and-forget from verification/signup hooks.
 * Never throws into Better Auth auth flows — claim idempotency owns exactly-once.
 */
async function maybeSendWelcomeEmail(
  env: AppEnv,
  user: { id: string; email: string; name?: string | null },
) {
  if (!isEmailSendingConfigured(env)) {
    return;
  }
  const email = user.email?.trim();
  if (!user.id || !email) {
    return;
  }

  try {
    const { sendWelcomeEmail } = await import("~/lib/delivery.server");
    await promiseWithTimeout(
      sendWelcomeEmail(env, {
        userId: user.id,
        email,
        name: user.name ?? null,
      }),
      BETTER_AUTH_EMAIL_SEND_TIMEOUT_MS,
      "Welcome email timed out.",
    );
  } catch {
    // Auth success must not depend on welcome delivery; failed sends leave a
    // reclaimable delivery_attempt (or none) for later ops review.
  }
}
