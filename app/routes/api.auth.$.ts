import { createAuth } from "../lib/auth.server";

/**
 * better-auth's own handler, mounted whole.
 *
 * Every auth route the plugins define — magic-link request and verify, passkey
 * registration and assertion, session, sign-out — is served from here. Nothing
 * is reimplemented above it, which is the point: the routes and the schema come
 * from the same library version, so they cannot drift apart.
 */
export async function loader({ request, context }: { request: Request; context: { cloudflare: { env: never } } }) {
  return createAuth(context.cloudflare.env).handler(request);
}

export async function action({ request, context }: { request: Request; context: { cloudflare: { env: never } } }) {
  return createAuth(context.cloudflare.env).handler(request);
}
