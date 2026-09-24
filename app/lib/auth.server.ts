import { betterAuth, type BetterAuthOptions } from "better-auth";
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
  BETTER_AUTH_ALLOWED_HOSTS?: string;
  PASSKEY_RP_ID?: string;
}

const COOKIE_PREFIX = "better-auth";
const FRESH_SESSION_SECONDS = 60 * 60 * 24;
const SESSION_COOKIE = `${COOKIE_PREFIX}.session_token`;
const sessionCookieNames = new Set([SESSION_COOKIE, `__Secure-${SESSION_COOKIE}`]);

export function hasSessionCookie(request: Request) {
  const header = request.headers.get("cookie");
  if (!header) return false;
  return header.split(";").some((part) => sessionCookieNames.has(part.trim().split("=")[0] ?? ""));
}

function baseURL(env: AuthEnv): BetterAuthOptions["baseURL"] {
  if (!env.BETTER_AUTH_ALLOWED_HOSTS) return env.BETTER_AUTH_URL;
  return { allowedHosts: [env.BETTER_AUTH_ALLOWED_HOSTS], protocol: "https" };
}

export function createAuth(env: AuthEnv) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: baseURL(env),
    advanced: { cookiePrefix: COOKIE_PREFIX },
    session: { freshAge: FRESH_SESSION_SECONDS },
    user: { deleteUser: { enabled: true } },
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
      passkey({ rpID: env.PASSKEY_RP_ID }),
      apiKey({
        defaultPrefix: API_KEY_PREFIX,
        rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 120 },
      }),
    ],
  });
}

export async function signOut(env: AuthEnv, request: Request): Promise<Headers> {
  const { headers } = await createAuth(env).api.signOut({ headers: request.headers, returnHeaders: true });
  return headers;
}

export async function deleteSignedInUser(env: AuthEnv, request: Request, now: Date): Promise<Headers | null> {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const age = now.getTime() - new Date(session.session.createdAt).getTime();
  if (age >= FRESH_SESSION_SECONDS * 1000) return null;
  const { apiKeys } = await auth.api.listApiKeys({ headers: request.headers });
  await Promise.all(
    apiKeys.map((key) => auth.api.deleteApiKey({ body: { keyId: key.id }, headers: request.headers })),
  );
  const { headers } = await auth.api.deleteUser({ body: {}, headers: request.headers, returnHeaders: true });
  return headers;
}
