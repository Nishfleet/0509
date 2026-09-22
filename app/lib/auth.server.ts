import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { env } from "cloudflare:workers";

interface AuthEnv {
  DB: D1Database;
  EMAIL: { send(message: unknown): Promise<unknown> };
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
}

const sessionByRequest = new WeakMap<Request, ReturnType<typeof loadSession>>();

function loadSession(request: Request) {
  return createAuth(env).api.getSession({ headers: request.headers });
}

export function readSession(request: Request) {
  const cached = sessionByRequest.get(request);
  if (cached) return cached;
  const pending = loadSession(request);
  sessionByRequest.set(request, pending);
  return pending;
}

export function createAuth(env: AuthEnv) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
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
