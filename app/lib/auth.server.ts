import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";

import { ensureWorkspaceForSignIn } from "./workspace.server";
import { sendMessage } from "../../workers/delivery/send";

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
        sendMagicLink: async ({ email, url }) => {
          // Through the one send lane (workers/delivery/send.ts), so this repo
          // has exactly one EMAIL.send call site (0509#3979). The magic link is
          // transactional: it has no digest row and no suppression entry, so it
          // sends directly rather than through the queue consumer.
          const sent = await sendMessage(env.EMAIL, {
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
          // sendMessage never throws — it resolves the failure — so the
          // status has to be surfaced here or a rejected sign-in link is lost
          // silently. This used to throw on its own before routing through the
          // one lane; rethrowing keeps the caller's behaviour identical.
          if (sent.outcome === "failed") {
            throw new Error(`magic-link send failed for ${email}: ${sent.error ?? "unknown error"}`);
          }
        },
      }),
      passkey(),
      apiKey(),
    ],
  });
}
