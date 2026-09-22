import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";

import { ensureWorkspaceForSignIn } from "./workspace.server";

interface AuthEnv {
  DB: D1Database;
  EMAIL: { send(message: unknown): Promise<unknown> };
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
}

export function createAuth(env: AuthEnv) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
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
          await env.EMAIL.send({
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
      passkey(),
      apiKey(),
    ],
  });
}
