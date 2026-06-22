import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";

import {
  appOrigin,
  emailFromAddress,
  isBetterAuthEnabled,
  isEmailSendingConfigured,
  type AppEnv,
} from "~/lib/env.server";
import type { AppSession } from "~/lib/types";

export const BETTER_AUTH_BASE_PATH = "/api/auth";
export const BETTER_AUTH_OAUTH_PROVIDERS = ["google", "microsoft"] as const;
const BETTER_AUTH_MAGIC_LINK_COOKIE = "f9_better_magic";
const BETTER_AUTH_MAGIC_LINK_STATE_COOKIE = "f9_better_magic_state";

export type BetterAuthOAuthProvider = (typeof BETTER_AUTH_OAUTH_PROVIDERS)[number];

export class BetterAuthUnknownUserError extends Error {
  constructor() {
    super("No Better Auth user exists for that email.");
    this.name = "BetterAuthUnknownUserError";
  }
}

export class BetterAuthMagicLinkStateError extends Error {
  constructor() {
    super("Better Auth magic-link request state is missing or invalid.");
    this.name = "BetterAuthMagicLinkStateError";
  }
}

export function isBetterAuthConfigured(env: AppEnv) {
  return Boolean(isBetterAuthEnabled(env) && env.DB && env.BETTER_AUTH_SECRET?.trim());
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
    emailAndPassword: {
      enabled: false,
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
            requestState: authRequestStateFromMetadata(metadata),
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

  const user = await env.DB!.prepare(
    "SELECT id, email, name, image, onboardedAt FROM user WHERE id = ? LIMIT 1",
  )
    .bind(session.user.id)
    .first<{
      id: string;
      email: string;
      name: string;
      image: string | null;
      onboardedAt: string | null;
    }>();

  return {
    session: {
      expiresAt: toIsoString(session.session.expiresAt),
      id: session.session.id,
      userId: session.session.userId,
    },
    user: {
      email: user?.email ?? session.user.email,
      id: user?.id ?? session.user.id,
      image: user?.image ?? session.user.image ?? null,
      name: user?.name ?? session.user.name,
      onboardedAt: user?.onboardedAt ?? null,
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
  const magicLinkRequestState = createBetterAuthMagicLinkRequestState(request);
  const requestState = magicLinkRequestState.requestState;
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
        requestState,
      },
      name: input.name?.trim() || undefined,
      newUserCallbackURL: input.mode === "signup" ? callbackURL : undefined,
    },
    headers: request.headers,
  });

  return magicLinkRequestState.cookie;
}

export function dummyBetterAuthMagicLinkRequestStateCookie(request: Request) {
  return createBetterAuthMagicLinkRequestState(request).cookie;
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
  const verifyUrl = new URL(`${BETTER_AUTH_BASE_PATH}/magic-link/verify`, betterAuthBaseURL(env, request));
  verifyUrl.searchParams.set("token", input.token);
  verifyUrl.searchParams.set("callbackURL", input.callbackURL);
  if (input.newUserCallbackURL) {
    verifyUrl.searchParams.set("newUserCallbackURL", input.newUserCallbackURL);
  }
  if (input.errorCallbackURL) {
    verifyUrl.searchParams.set("errorCallbackURL", input.errorCallbackURL);
  }

  return getBetterAuth(env, request).handler(
    new Request(verifyUrl, {
      headers: request.headers,
      method: "GET",
    }),
  );
}

export interface BetterAuthPasskeyRecord {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
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
      target.append("Set-Cookie", cookie);
    }
    return;
  }

  const cookie = source.get("Set-Cookie");
  if (cookie) {
    target.append("Set-Cookie", cookie);
  }
}

export interface BetterAuthMagicLinkConfirmation {
  token: string;
  callbackURL: string;
  requestState: string;
  email?: string;
  newUserCallbackURL?: string;
  errorCallbackURL?: string;
}

export function betterAuthMagicLinkConfirmationCookie(request: Request, verificationUrl: string) {
  const url = new URL(verificationUrl);
  const requestState = url.searchParams.get("state") || "";
  const cookieState = readCookie(request, BETTER_AUTH_MAGIC_LINK_STATE_COOKIE);
  if (!requestState || cookieState !== requestState) {
    throw new BetterAuthMagicLinkStateError();
  }

  const payload: BetterAuthMagicLinkConfirmation = {
    callbackURL: url.searchParams.get("callbackURL") || "/app",
    email: url.searchParams.get("email") || undefined,
    errorCallbackURL: url.searchParams.get("errorCallbackURL") || undefined,
    newUserCallbackURL: url.searchParams.get("newUserCallbackURL") || undefined,
    requestState,
    token: url.searchParams.get("token") || "",
  };

  if (!payload.token) {
    throw new Error("Better Auth magic-link token is missing.");
  }

  return buildBetterAuthCookie(request, BETTER_AUTH_MAGIC_LINK_COOKIE, encodeCookiePayload(payload), {
    maxAge: 10 * 60,
    path: "/auth/better/magic-link",
  });
}

export function readBetterAuthMagicLinkConfirmation(
  request: Request,
): BetterAuthMagicLinkConfirmation | null {
  const value = readCookie(request, BETTER_AUTH_MAGIC_LINK_COOKIE);
  if (!value) {
    return null;
  }

  const payload = decodeCookiePayload(value);
  if (
    !payload ||
    typeof payload.token !== "string" ||
    typeof payload.callbackURL !== "string" ||
    typeof payload.requestState !== "string" ||
    readCookie(request, BETTER_AUTH_MAGIC_LINK_STATE_COOKIE) !== payload.requestState
  ) {
    return null;
  }

  return {
    callbackURL: payload.callbackURL,
    email: typeof payload.email === "string" ? payload.email : undefined,
    errorCallbackURL:
      typeof payload.errorCallbackURL === "string" ? payload.errorCallbackURL : undefined,
    newUserCallbackURL:
      typeof payload.newUserCallbackURL === "string" ? payload.newUserCallbackURL : undefined,
    requestState: payload.requestState,
    token: payload.token,
  };
}

export function clearBetterAuthMagicLinkConfirmationCookie(request: Request) {
  return buildBetterAuthCookie(request, BETTER_AUTH_MAGIC_LINK_COOKIE, "", {
    maxAge: 0,
    path: "/auth/better/magic-link",
  });
}

export function clearBetterAuthMagicLinkStateCookie(request: Request) {
  return buildBetterAuthCookie(request, BETTER_AUTH_MAGIC_LINK_STATE_COOKIE, "", {
    maxAge: 0,
    path: "/auth/better/magic-link",
  });
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
    requestState: string;
    url: string;
  },
) {
  if (!isEmailSendingConfigured(env)) {
    throw new Error("Cloudflare Email is not configured for Better Auth magic links.");
  }

  const subject =
    input.mode === "signup"
      ? "Set up your Five to Nine workspace"
      : "Sign in to Five to Nine";
  const confirmationUrl = betterAuthMagicLinkConfirmationUrl(
    input.url,
    input.email,
    input.requestState,
  );
  const htmlUrl = escapeHtml(confirmationUrl);
  await env.EMAIL!.send({
    from: emailFromAddress(env),
    html: [
      "<p>Use this secure link to continue to Five to Nine:</p>",
      `<p><a href="${htmlUrl}">${htmlUrl}</a></p>`,
      "<p>This link expires soon. If you did not request it, you can ignore this email.</p>",
    ].join(""),
    subject,
    text: [
      "Use this secure link to continue to Five to Nine:",
      "",
      confirmationUrl,
      "",
      "This link expires soon. If you did not request it, you can ignore this email.",
    ].join("\n"),
    to: input.email,
  });
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

function betterAuthMagicLinkConfirmationUrl(
  verificationUrl: string,
  email: string,
  requestState: string,
) {
  const url = new URL(verificationUrl);
  const confirmationUrl = new URL("/auth/better/magic-link", url.origin);
  for (const key of ["token", "callbackURL", "newUserCallbackURL", "errorCallbackURL"]) {
    const value = url.searchParams.get(key);
    if (value) {
      confirmationUrl.searchParams.set(key, value);
    }
  }
  confirmationUrl.searchParams.set("email", email);
  confirmationUrl.searchParams.set("state", requestState);
  return confirmationUrl.toString();
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

function createBetterAuthMagicLinkRequestState(request: Request) {
  const requestState = randomBetterAuthState();
  return {
    cookie: buildBetterAuthCookie(request, BETTER_AUTH_MAGIC_LINK_STATE_COOKIE, requestState, {
      maxAge: 15 * 60,
      path: "/auth/better/magic-link",
    }),
    requestState,
  };
}

function buildBetterAuthCookie(
  request: Request,
  name: string,
  value: string,
  options: {
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
  if (new URL(request.url).protocol === "https:") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function readCookie(request: Request, name: string) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? null;
}

function encodeCookiePayload(payload: BetterAuthMagicLinkConfirmation) {
  return base64UrlEncode(JSON.stringify(payload));
}

function decodeCookiePayload(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(base64UrlDecode(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  return base64UrlEncodeBytes(bytes);
}

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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

function authRequestStateFromMetadata(metadata: Record<string, unknown> | undefined) {
  const requestState = metadata?.requestState;
  if (typeof requestState !== "string" || !requestState) {
    throw new BetterAuthMagicLinkStateError();
  }
  return requestState;
}

function randomBetterAuthState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
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
