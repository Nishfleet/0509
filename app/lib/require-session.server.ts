import { env } from "cloudflare:workers";
import { createContext, redirect, type RouterContextProvider } from "react-router";

import { createAuth, hasSessionCookie, signOut } from "./auth.server";
import { deadLinkMessage } from "./login-link-error";

async function loginPath(request: Request, returnTo: string | undefined): Promise<string> {
  const params = new URLSearchParams();
  if (returnTo !== undefined) params.set("next", returnTo);
  const search = new URL(request.url).searchParams;
  const linkError = search.get("error");
  if (linkError !== null && deadLinkMessage(search) !== null) params.set("error", linkError);
  if (await hasSessionCookie(request)) params.set("ended", "1");
  const query = params.toString();
  return query === "" ? "/login" : `/login?${query}`;
}

async function readSession(request: Request, returnTo: string | undefined, disableCookieCache: boolean) {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache } });
  if (!session) throw redirect(await loginPath(request, returnTo));
  return session;
}

export function requireSession(request: Request, returnTo?: string) {
  return readSession(request, returnTo, false);
}

export function requireFreshSession(request: Request, returnTo?: string) {
  return readSession(request, returnTo, true);
}

export function sessionForRequest(request: Request, returnTo?: string) {
  return request.method === "GET" ? requireSession(request, returnTo) : requireFreshSession(request, returnTo);
}

export type Session = Awaited<ReturnType<typeof requireSession>>;

export const sessionContext = createContext<Session>();

export async function requireSessionMiddleware({
  request,
  context,
}: {
  request: Request;
  context: Pick<RouterContextProvider, "set">;
}): Promise<void> {
  context.set(sessionContext, await sessionForRequest(request));
}

export async function hasSession(request: Request): Promise<boolean> {
  const auth = createAuth(env);
  return (await auth.api.getSession({ headers: request.headers })) !== null;
}

export async function signOutToLogin(request: Request): Promise<never> {
  throw redirect("/login", { headers: await signOut(env, request) });
}
