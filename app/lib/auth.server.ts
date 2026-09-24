import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";

import { API_KEY_PREFIX } from "./agent/paths";
import { ensureWorkspaceForSignIn } from "./workspace.server";
import { MAGIC_LINK_TTL_SECONDS, magicLinkEmail } from "./auth/magic-link-email";
import { sendOrThrow } from "../../workers/delivery/send";

interface AuthEnv {
  DB: D1Database;
  EMAIL: SendEmail;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
}

const COOKIE_PREFIX = "better-auth";
const SESSION_COOKIE = `${COOKIE_PREFIX}.session_token`;
const sessionCookieNames = new Set([SESSION_COOKIE, `__Secure-${SESSION_COOKIE}`]);

export function hasSessionCookie(request: Request) {
  const header = request.headers.get("cookie");
  if (!header) return false;
  return header.split(";").some((part) => sessionCookieNames.has(part.trim().split("=")[0] ?? ""));
}

export function createAuth(env: AuthEnv) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: { cookiePrefix: COOKIE_PREFIX },
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
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        sendMagicLink: async ({ email, url }) => {
          const message = magicLinkEmail({ email, url });
          await sendOrThrow(env.EMAIL, {
            to: email,
            from: { email: "hello@0509.io", name: "Five to Nine" },
            subject: message.subject,
            text: message.text,
            html: message.html,
          });
        },
      }),
      passkey(),
      apiKey({
        defaultPrefix: API_KEY_PREFIX,
        rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 120 },
      }),
    ],
  });
}
