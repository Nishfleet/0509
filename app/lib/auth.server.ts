import { createCookie } from "react-router";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha, magicLink } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";

import { API_KEY_PREFIX, READ_SCOPE } from "./agent/paths";
import { cancelPendingDigests } from "./data/digest.server";
import { suppressWorkspaceTargets } from "./data/email_suppression.server";
import { readOwnedWorkspaces } from "./data/workspace.server";
import { withEmailLanding } from "./email-change-landing";
import { ensureWorkspaceForSignIn } from "./workspace.server";
import { accessPrecleared } from "./auth/access-preclearance.server";
import { captchaApplies } from "./auth-captcha";
import { changeEmailEmail } from "./auth/change-email-email";
import { changeEmailAllowed } from "./auth/change-email-limit";
import { chargeFixtureMagicLink, chargeFixtureSignup } from "./auth/fixture-signup-cap.server";
import { MAGIC_LINK_TTL_SECONDS, magicLinkEmail } from "./auth/magic-link-email";
import { MAGIC_LINK_PATH } from "./auth/magic-link-path";
import { redactEmailShaped } from "./auth/redact-email-shaped";
import { signInLinkAllowed } from "./auth/sign-in-limit.server";
import { errorText, sendOrThrow } from "../../workers/delivery/send";

interface AuthEnv {
  DB: D1Database;
  EMAIL: SendEmail;
  SIGN_IN_EMAIL_LIMIT: RateLimit;
  SIGN_IN_IP_LIMIT: RateLimit;
  TURNSTILE_SECRET_KEY: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  CAPTCHA?: string;
}

const CLIENT_IP_HEADER = "cf-connecting-ip";

function emailOf(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const email: unknown = Reflect.get(body, "email");
  return typeof email === "string" ? email : "";
}

const COOKIE_PREFIX = "better-auth";
const FRESH_SESSION_SECONDS = 60 * 60 * 24;
const EMAIL_CHANGE_TTL_SECONDS = 60 * 60;
const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;
const FRESH = { disableCookieCache: true };
const SESSION_COOKIE = `${COOKIE_PREFIX}.session_token`;
const sessionCookies = [SESSION_COOKIE, `__Secure-${SESSION_COOKIE}`].map((name) => createCookie(name));

export async function hasSessionCookie(request: Request) {
  const header = request.headers.get("cookie");
  if (!header) return false;
  const parsed = await Promise.all(sessionCookies.map((cookie) => cookie.parse(header)));
  return parsed.some((value) => value !== null);
}

function sendChangeEmailMessage(
  email: SendEmail,
  input: { kind: "approve" | "confirm"; to: string; named: string; url: string },
): Promise<void> {
  const message = changeEmailEmail({
    kind: input.kind,
    email: input.named,
    url: withEmailLanding(input.url, input.kind),
  });
  return sendOrThrow(email, {
    to: input.to,
    from: { email: "hello@0509.io", name: "Five to Nine" },
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

const DISABLED_AUTH_PATHS = [
  "/delete-user",
  "/delete-user/callback",
  "/change-email",
  "/update-user",
  "/change-password",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/sign-out",
  "/sign-up/email",
  "/sign-in/email",
  "/sign-in/social",
  "/send-verification-email",
  "/request-password-reset",
  "/reset-password",
  "/verify-password",
  "/update-session",
  "/link-social",
  "/unlink-account",
  "/list-accounts",
  "/refresh-token",
  "/get-access-token",
  "/account-info",
  "/ok",
  "/error",
  "/passkey/delete-passkey",
  "/passkey/update-passkey",
  "/passkey/list-user-passkeys",
  "/api-key/create",
  "/api-key/delete",
  "/api-key/update",
  "/api-key/get",
  "/api-key/list",
];

function authHooks(env: AuthEnv) {
  return {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== MAGIC_LINK_PATH) return;
      const ip = ctx.headers?.get(CLIENT_IP_HEADER) ?? null;
      if (!(await signInLinkAllowed(env, emailOf(ctx.body), ip))) {
        throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in links. Wait a minute and try again." });
      }
    }),
  };
}

function databaseHooks(env: AuthEnv): BetterAuthOptions["databaseHooks"] {
  return {
    user: {
      create: {
        before: async (user) => {
          if (!(await chargeFixtureSignup(user.email))) {
            throw new APIError("TOO_MANY_REQUESTS", { message: "Too many test accounts today. Try again tomorrow." });
          }
        },
      },
    },
    session: {
      create: {
        after: async (session, context) => {
          const request = context?.request ?? null;
          if (!request) return;
          await ensureWorkspaceForSignIn(env.DB, {
            userId: session.userId,
            request,
          });
        },
      },
    },
  };
}

function sendMagicLinkEmail(env: AuthEnv) {
  return async ({ email, url }: { email: string; url: string }) => {
    if (!(await chargeFixtureMagicLink(email))) {
      throw new APIError("TOO_MANY_REQUESTS", { message: "Too many test sign-in links today. Try again tomorrow." });
    }
    const message = magicLinkEmail({ email, url });
    try {
      await sendOrThrow(env.EMAIL, {
        to: email,
        from: { email: "hello@0509.io", name: "Five to Nine" },
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (failed) {
      const detail = redactEmailShaped(errorText(failed)).slice(0, 200);
      console.error(JSON.stringify({ event: "login.magic_link_send_failed", error: detail }));
      throw new APIError("SERVICE_UNAVAILABLE", {
        message: "We couldn't send the link. Try again in a minute.",
      });
    }
  };
}

function authPlugins(env: AuthEnv, options?: { captcha?: boolean }) {
  const origin = env.BETTER_AUTH_URL === undefined ? undefined : new URL(env.BETTER_AUTH_URL).origin;
  return [
    ...(options?.captcha === false || !captchaApplies(env.CAPTCHA)
      ? []
      : [
          captcha({
            provider: "cloudflare-turnstile",
            secretKey: env.TURNSTILE_SECRET_KEY,
            endpoints: [MAGIC_LINK_PATH],
          }),
        ]),
    magicLink({
      expiresIn: MAGIC_LINK_TTL_SECONDS,
      storeToken: "hashed",
      sendMagicLink: sendMagicLinkEmail(env),
    }),
    passkey({ rpName: "Five to Nine", origin }),
    apiKey({
      defaultPrefix: API_KEY_PREFIX,
      maximumNameLength: 60,
      enableMetadata: true,
      permissions: { defaultPermissions: { [READ_SCOPE]: ["*"] } },
      rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 120 },
    }),
  ];
}

export function createAuth(env: AuthEnv, options?: { captcha?: boolean; validateSchema?: boolean }) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      database: { joins: true, validateSchema: options?.validateSchema ?? false },
    },
    session: {
      freshAge: FRESH_SESSION_SECONDS,
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: ({ id }) => silenceWorkspace(env.DB, id),
      },
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: false,
        sendChangeEmailConfirmation: ({ user, newEmail, url }) =>
          sendChangeEmailMessage(env.EMAIL, { kind: "approve", to: user.email, named: newEmail, url }),
      },
    },
    emailVerification: {
      expiresIn: EMAIL_CHANGE_TTL_SECONDS,
      sendVerificationEmail: ({ user, url }) =>
        sendChangeEmailMessage(env.EMAIL, { kind: "confirm", to: user.email, named: user.email, url }),
    },
    disabledPaths: DISABLED_AUTH_PATHS,
    hooks: authHooks(env),
    databaseHooks: databaseHooks(env),
    plugins: authPlugins(env, options),
  });
}

export async function createAuthForRequest(env: AuthEnv, request: Request) {
  const cleared = await accessPrecleared(request, env);
  return createAuth(env, { captcha: !cleared });
}

export async function signOut(env: AuthEnv, request: Request): Promise<Headers> {
  const { headers } = await createAuth(env).api.signOut({ headers: request.headers, returnHeaders: true });
  return headers;
}

export async function signOutEverywhere(env: AuthEnv, request: Request): Promise<Headers> {
  await createAuth(env).api.revokeSessions({ headers: request.headers });
  return signOut(env, request);
}

async function silenceWorkspace(db: D1Database, userId: string): Promise<void> {
  for (const { id: workspaceId } of await readOwnedWorkspaces(userId)) {
    await suppressWorkspaceTargets(workspaceId);
    await cancelPendingDigests(db, workspaceId);
  }
}

export async function hasFreshSession(env: AuthEnv, request: Request, now: Date): Promise<boolean> {
  const session = await createAuth(env).api.getSession({ headers: request.headers, query: FRESH });
  if (!session) return false;
  return now.getTime() - new Date(session.session.createdAt).getTime() < FRESH_SESSION_SECONDS * 1000;
}

export async function deleteSignedInUser(env: AuthEnv, request: Request, now: Date): Promise<Headers | null> {
  if (!(await hasFreshSession(env, request, now))) return null;
  const auth = createAuth(env);
  const { apiKeys } = await auth.api.listApiKeys({ headers: request.headers });
  await Promise.all(
    apiKeys.map((key) => auth.api.deleteApiKey({ body: { keyId: key.id }, headers: request.headers, query: FRESH })),
  );
  const { headers } = await auth.api.deleteUser({
    body: {},
    headers: request.headers,
    query: FRESH,
    returnHeaders: true,
  });
  return headers;
}

export async function removeSignedInPasskey(env: AuthEnv, request: Request, id: string): Promise<"removed" | "stale"> {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers, query: FRESH });
  if (!session) return "stale";
  if (Date.now() - new Date(session.session.createdAt).getTime() >= FRESH_SESSION_SECONDS * 1000) return "stale";
  await auth.api.deletePasskey({ body: { id }, headers: request.headers, query: FRESH });
  return "removed";
}

export async function requestEmailChange(
  env: AuthEnv & { CHANGE_EMAIL_LIMIT: RateLimit },
  request: Request,
  newEmail: string,
): Promise<"sent" | "limited" | "stale"> {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers, query: FRESH });
  if (!session) return "stale";
  if (Date.now() - new Date(session.session.createdAt).getTime() >= FRESH_SESSION_SECONDS * 1000) return "stale";
  if (!(await changeEmailAllowed(env.CHANGE_EMAIL_LIMIT, session.user.id, newEmail))) return "limited";
  await auth.api.changeEmail({
    body: { newEmail, callbackURL: "/app/settings" },
    headers: request.headers,
    query: FRESH,
  });
  return "sent";
}
