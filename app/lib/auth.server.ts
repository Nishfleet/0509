import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha, magicLink } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";

import { API_KEY_PREFIX } from "./agent/paths";
import { ensureWorkspaceForSignIn } from "./workspace.server";
import { accessPrecleared } from "./auth/access-preclearance.server";
import { changeEmailEmail } from "./auth/change-email-email";
import { changeEmailAllowed } from "./auth/change-email-limit";
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
const sessionCookieNames = new Set([SESSION_COOKIE, `__Secure-${SESSION_COOKIE}`]);

export function hasSessionCookie(request: Request) {
  const header = request.headers.get("cookie");
  if (!header) return false;
  return header.split(";").some((part) => sessionCookieNames.has(part.trim().split("=")[0] ?? ""));
}

function sendChangeEmailMessage(
  email: SendEmail,
  input: { kind: "approve" | "confirm"; to: string; named: string; url: string },
): Promise<void> {
  const message = changeEmailEmail({ kind: input.kind, email: input.named, url: input.url });
  return sendOrThrow(email, {
    to: input.to,
    from: { email: "hello@0509.io", name: "Five to Nine" },
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

function authHooks(env: AuthEnv) {
  return {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/send-verification-email") throw new APIError("NOT_FOUND");
      if (ctx.path !== MAGIC_LINK_PATH) return;
      const ip = ctx.headers?.get(CLIENT_IP_HEADER) ?? null;
      if (!(await signInLinkAllowed(env, emailOf(ctx.body), ip))) {
        throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in links. Wait a minute and try again." });
      }
    }),
  };
}

function sendMagicLinkEmail(env: AuthEnv) {
  return async ({ email, url }: { email: string; url: string }) => {
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
    ...(options?.captcha === false
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
      deleteUser: { enabled: true },
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
    hooks: authHooks(env),
    databaseHooks: {
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
    },
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

export async function deleteSignedInUser(env: AuthEnv, request: Request, now: Date): Promise<Headers | null> {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers, query: FRESH });
  if (!session) return null;
  const age = now.getTime() - new Date(session.session.createdAt).getTime();
  if (age >= FRESH_SESSION_SECONDS * 1000) return null;
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

export async function requestEmailChange(
  env: AuthEnv & { CHANGE_EMAIL_LIMIT: RateLimit },
  request: Request,
  newEmail: string,
): Promise<"sent" | "limited"> {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers, query: FRESH });
  if (!session) throw new Error("no session");
  if (Date.now() - new Date(session.session.createdAt).getTime() >= FRESH_SESSION_SECONDS * 1000) {
    throw new Error("session not fresh");
  }
  if (!(await changeEmailAllowed(env.CHANGE_EMAIL_LIMIT, session.user.id, newEmail))) return "limited";
  await auth.api.changeEmail({
    body: { newEmail, callbackURL: "/app/settings" },
    headers: request.headers,
    query: FRESH,
  });
  return "sent";
}
