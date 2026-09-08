import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";

async function logout({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    clearBetterAuthSessionCookies,
    isBetterAuthConfigured,
    isSameOriginAuthFormPost,
    signOutBetterAuth,
  } = await import("~/lib/better-auth.server");
  const { E2E_TEST_SESSION_COOKIE, shouldClearE2ETestSessionCookie } = await import("~/lib/e2e-auth.server");
  const env = getEnv(context);
  if (!isSameOriginAuthFormPost(env, request)) {
    throw new Response("Invalid logout request.", { status: 403 });
  }

  const headers = new Headers();
  if (isBetterAuthConfigured(env)) {
    const signOutResponse = await signOutBetterAuth(env, request).catch((error) => {
      console.warn("Better Auth sign-out failed", error);
      return null;
    });
    appendSetCookieHeaders(headers, signOutResponse?.headers);
    for (const cookie of clearBetterAuthSessionCookies(request)) {
      headers.append("Set-Cookie", cookie);
    }
  }
  if (await shouldClearE2ETestSessionCookie(env, request)) {
    headers.append("Set-Cookie", `${E2E_TEST_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
  }

  throw redirect("/", { headers });
}

export async function loader() {
  throw redirect("/");
}

export async function action(args: ActionFunctionArgs) {
  return logout(args);
}

function appendSetCookieHeaders(target: Headers, source: Headers | undefined) {
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
