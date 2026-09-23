import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";

import { ensureWorkspaceForSignIn } from "./workspace.server";
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

const PREVIEW_ALLOWED_HOSTS = ["*-0509.nishant345.workers.dev"];
const PREVIEW_RP_ID = "nishant345.workers.dev";

function baseURLFor(env: AuthEnv) {
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL;
  return { allowedHosts: PREVIEW_ALLOWED_HOSTS, protocol: "https" as const };
}

export function createAuth(env: AuthEnv) {
  const baseURL = baseURLFor(env);
  const rpID = typeof baseURL === "string" ? new URL(baseURL).hostname : PREVIEW_RP_ID;
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
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
        sendMagicLink: async ({ email, url }) => {
          await sendOrThrow(env.EMAIL, {
            to: email,
            from: { email: "hello@0509.io", name: "Five to Nine" },
            subject: "Your sign-in link",
            text: [
              "Sign in to Five to Nine:",
              "",
              url,
              "",
              "The link works once and expires shortly.",
              "If you did not ask for it, ignore this email.",
            ].join("\n"),
          });
        },
      }),
      passkey({ rpID }),
      apiKey(),
    ],
  });
}
