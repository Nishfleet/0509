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
const BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE = "f9_better_magic";
const BETTER_AUTH_MAGIC_LINK_STATE_COOKIE = "f9_better_magic_state";
const BETTER_AUTH_MAGIC_LINK_CONTEXT_TTL_MS = 15 * 60 * 1000;
const BETTER_AUTH_MAGIC_LINK_STATE_COOKIE_PATH = "/auth";
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
  return (await getBetterAuth(env, request).api.magicLinkVerify({
    asResponse: true,
    headers: request.headers,
    query: {
      callbackURL: input.callbackURL,
      ...(input.errorCallbackURL ? { errorCallbackURL: input.errorCallbackURL } : {}),
      ...(input.newUserCallbackURL ? { newUserCallbackURL: input.newUserCallbackURL } : {}),
      token: input.token,
    },
  } as never)) as Response;
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
    requestState: string;
    url: string;
  },
) {
  if (!isEmailSendingConfigured(env)) {
    throw new Error("Cloudflare Email is not configured for Better Auth magic links.");
  }

  const email = buildBetterAuthMagicLinkEmail({
    mode: input.mode,
    url: await betterAuthMagicLinkConfirmationUrl(env, {
      mode: input.mode,
      requestState: input.requestState,
      url: input.url,
    }),
  });
  await env.EMAIL!.send({
    from: {
      email: emailFromAddress(env),
      name: input.mode === "signup" ? "0509 Account Activation" : "0509 Sign In",
    },
    html: email.html,
    subject: email.subject,
    text: email.text,
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

interface BetterAuthMagicLinkConfirmationTicket extends BetterAuthMagicLinkConfirmation {
  expiresAt: number;
  mode: "login" | "signup";
}

export function betterAuthMagicLinkConfirmationUrl(
  _env: AppEnv,
  input: {
    mode: "login" | "signup";
    requestState: string;
    url: string;
  },
) {
  const url = new URL(input.url);
  const token = url.searchParams.get("token") || "";
  if (!token) {
    throw new BetterAuthMagicLinkCallbackError();
  }

  const confirmationUrl = new URL("/auth/better/magic-link", url.origin);
  for (const key of ["token", "callbackURL", "newUserCallbackURL", "errorCallbackURL"]) {
    const value = url.searchParams.get(key);
    if (value) {
      confirmationUrl.searchParams.set(key, value);
    }
  }
  confirmationUrl.searchParams.set("state", input.requestState);
  return confirmationUrl.toString();
}

export function hasBetterAuthMagicLinkRequestState(request: Request) {
  const url = new URL(request.url);
  const requestState = url.searchParams.get("state") || "";
  const cookieStates = readCookies(request, BETTER_AUTH_MAGIC_LINK_STATE_COOKIE);
  return Boolean(requestState && cookieStates.includes(requestState));
}

export async function betterAuthMagicLinkConfirmationTicketCookie(
  env: AppEnv,
  request: Request,
  input: BetterAuthMagicLinkConfirmation & { mode: "login" | "signup" },
) {
  return buildBetterAuthCookie(
    request,
    BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE,
    await encryptBetterAuthMagicLinkPayload(env, {
      ...input,
      expiresAt: Date.now() + BETTER_AUTH_MAGIC_LINK_CONTEXT_TTL_MS,
    }),
    {
      maxAge: 15 * 60,
      path: "/auth/better/magic-link",
    },
  );
}

export async function readBetterAuthMagicLinkConfirmationTicket(
  env: AppEnv,
  request: Request,
): Promise<BetterAuthMagicLinkConfirmationTicket | null> {
  const parsed = await decryptBetterAuthMagicLinkPayload(
    env,
    readCookie(request, BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE) ?? "",
  );
  if (
    !parsed ||
    typeof parsed.callbackURL !== "string" ||
    typeof parsed.expiresAt !== "number" ||
    (parsed.mode !== "login" && parsed.mode !== "signup") ||
    typeof parsed.token !== "string" ||
    parsed.expiresAt < Date.now()
  ) {
    return null;
  }

  const origin = new URL(request.url).origin;
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
    expiresAt: parsed.expiresAt,
    mode: parsed.mode,
    ...(errorCallbackURL ? { errorCallbackURL } : {}),
    ...(newUserCallbackURL ? { newUserCallbackURL } : {}),
    token: parsed.token,
  };
}

export function clearBetterAuthMagicLinkConfirmationCookie(request: Request) {
  return buildBetterAuthCookie(request, BETTER_AUTH_MAGIC_LINK_CONFIRMATION_COOKIE, "", {
    maxAge: 0,
    path: "/auth/better/magic-link",
  });
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

export function betterAuthMagicLinkConfirmationFromRequest(
  request: Request,
): BetterAuthMagicLinkConfirmation {
  const url = new URL(request.url);
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

export function buildBetterAuthMagicLinkEmail(input: {
  mode: "login" | "signup";
  url: string;
}) {
  const isSignup = input.mode === "signup";
  const subject = isSignup ? "Activate your 0509 workspace" : "Sign in to 0509";
  const heading = isSignup ? "Activate your Five to Nine workspace" : "Sign in to Five to Nine";
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
      '<p style="margin:0 0 8px; color:#667085; font-size:13px; letter-spacing:.08em; text-transform:uppercase;">0509 Account Activation</p>',
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
      domain: parentAuthCookieDomain(request),
      maxAge: 15 * 60,
      path: BETTER_AUTH_MAGIC_LINK_STATE_COOKIE_PATH,
    }),
    requestState,
  };
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

function authRequestStateFromMetadata(metadata: Record<string, unknown> | undefined) {
  const requestState = metadata?.requestState;
  if (typeof requestState !== "string" || !requestState) {
    throw new BetterAuthMagicLinkCallbackError();
  }
  return requestState;
}

function randomBetterAuthState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
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
