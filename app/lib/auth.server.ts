import { redirect } from "react-router";

import type { AppEnv } from "~/lib/env.server";
import type { AppSession } from "~/lib/types";
import type { WorkspaceContext } from "~/lib/workspace.server";

export const AUTH_SESSION_UNAVAILABLE_MESSAGE =
  "Authentication is temporarily unavailable. Please try again in a moment.";

/**
 * A request-local fault marker used only by the localhost Journey 6 fixture.
 * The marker never changes a session or auth provider state; it makes this
 * one lookup fail closed after every normal fixture boundary is re-verified.
 */
export const E2E_AUTH_FAULT_HEADER = "x-0509-e2e-auth-fault";
export const E2E_AUTH_FAULT_VALUE = "unavailable";
const E2E_AUTH_FAULT_USER_ID = "e2e-starter";
const E2E_FIXTURE_COOKIE = "f9_e2e_fixture";
const E2E_TEST_MODE_HEADER = "x-0509-e2e-test-mode";

/**
 * The session lookup could not establish whether a request is authenticated.
 * This is deliberately distinct from a null session: null is a valid absent
 * or invalid session result, while this error means the auth backend failed.
 */
export class AuthSessionUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(AUTH_SESSION_UNAVAILABLE_MESSAGE, { cause });
    this.name = "AuthSessionUnavailableError";
  }
}

export function isAuthSessionUnavailableError(error: unknown): error is AuthSessionUnavailableError {
  return error instanceof AuthSessionUnavailableError;
}

export function authSessionUnavailableResponse() {
  return new Response(AUTH_SESSION_UNAVAILABLE_MESSAGE, {
    status: 503,
    statusText: "Authentication temporarily unavailable",
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "5",
    },
  });
}

// React Router hands the SAME Request object to every matched loader of a
// document request (workers/app.ts passes one request into requestHandler),
// so a WeakMap keyed by Request memoizes the session chain per invocation —
// root, layout, and page loaders share one lookup instead of three. Requests
// are per-invocation in Workers, so entries can never leak across users. The
// promise (not the resolved value) is cached so parallel loaders join the
// same in-flight lookup.
const sessionCache = new WeakMap<Request, Promise<AppSession | null>>();
const workspaceCache = new WeakMap<
  Request,
  { userId: string; workspace: Promise<WorkspaceContext> }
>();

function isExactLoopbackRequest(request: Request) {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }

  const port = Number(url.port);
  return (
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.username === "" &&
    url.password === "" &&
    Number.isInteger(port) &&
    port >= 1_024 &&
    port <= 65_535 &&
    url.origin === `http://127.0.0.1:${port}`
  );
}

function hasExactFixtureCookie(request: Request) {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${E2E_FIXTURE_COOKIE}=`));
  if (values.length !== 1) return false;

  let value = "";
  try {
    value = decodeURIComponent(values[0]!.slice(`${E2E_FIXTURE_COOKIE}=`.length));
  } catch {
    return false;
  }
  return value === E2E_AUTH_FAULT_USER_ID;
}

/**
 * Synchronous portion of the fixture fault boundary. The async session lookup
 * additionally verifies the local sentinel and provider network deny mode.
 */
export function resolveE2EAuthFaultRequest(request: Request) {
  return (
    request.headers.get(E2E_AUTH_FAULT_HEADER) === E2E_AUTH_FAULT_VALUE &&
    request.headers.get(E2E_TEST_MODE_HEADER) === "1" &&
    isExactLoopbackRequest(request) &&
    hasExactFixtureCookie(request)
  );
}

async function shouldInjectE2EAuthFault(env: AppEnv, request: Request) {
  if (!resolveE2EAuthFaultRequest(request)) return false;

  try {
    const [{ resolveE2EProviderDeny }, { isE2ETestRequestEnabled }] = await Promise.all([
      import("~/lib/e2e-provider.server"),
      import("~/lib/e2e-auth.server"),
    ]);
    const networkDeny = await resolveE2EProviderDeny(env, request);
    if (!networkDeny.enabled || !networkDeny.failClosed) return false;
    return await isE2ETestRequestEnabled(env, request);
  } catch {
    return false;
  }
}

export async function getOptionalSession(
  env: AppEnv,
  request: Request,
): Promise<AppSession | null> {
  try {
    return await getCachedOptionalSession(env, request);
  } catch (error) {
    if (isAuthSessionUnavailableError(error)) {
      return null;
    }
    throw error;
  }
}

export async function getCachedOptionalSession(
  env: AppEnv,
  request: Request,
): Promise<AppSession | null> {
  const cached = sessionCache.get(request);
  if (cached) {
    return cached;
  }

  const pending = lookupOptionalSession(env, request);
  sessionCache.set(request, pending);
  return pending;
}

async function lookupOptionalSession(
  env: AppEnv,
  request: Request,
): Promise<AppSession | null> {
  if (await shouldInjectE2EAuthFault(env, request)) {
    throw new AuthSessionUnavailableError();
  }

  try {
    const { getE2ETestSession } = await import("~/lib/e2e-auth.server");
    const e2eSession = await getE2ETestSession(env, request);
    if (e2eSession) {
      return e2eSession;
    }

    if (!env.DB) {
      return null;
    }

    const { getBetterAuthSession } = await import("~/lib/better-auth.server");
    return await getBetterAuthSession(env, request);
  } catch (error) {
    console.warn("Better Auth session lookup failed", error);
    throw new AuthSessionUnavailableError(error);
  }
}

// resolveWorkspace is keyed by user id, so the per-request memo lives here:
// the Request object is the safe per-invocation cache key, and the stored
// user id guards against ever serving another user's workspace lookup.
export async function getCachedWorkspaceForRequest(
  env: AppEnv,
  request: Request,
  userId: string,
): Promise<WorkspaceContext> {
  const cached = workspaceCache.get(request);
  if (cached && cached.userId === userId) {
    return cached.workspace;
  }

  const workspace = import("~/lib/workspace.server").then(({ resolveWorkspace }) =>
    resolveWorkspace(env, userId),
  );
  workspaceCache.set(request, { userId, workspace });
  return workspace;
}

export interface WorkspaceSession {
  session: Awaited<ReturnType<typeof requireSession>>;
  workspaceUserId: string;
  isMember: boolean;
  ownerName: string | null;
}

// Data routes call this instead of requireSession: members of an Agency
// workspace operate on the owner's data; everyone else gets their own id.
// Billing and account routes must keep using requireSession directly.
export async function requireWorkspaceSession(
  env: AppEnv,
  request: Request,
): Promise<WorkspaceSession> {
  const session = await requireSession(env, request);
  const workspace = await getCachedWorkspaceForRequest(env, request, session.user.id);

  return {
    session,
    workspaceUserId: workspace.workspaceUserId,
    isMember: workspace.isMember,
    ownerName: workspace.ownerName,
  };
}

export async function requireSession(env: AppEnv, request: Request) {
  let session: AppSession | null;
  try {
    session = await getCachedOptionalSession(env, request);
  } catch (error) {
    if (isAuthSessionUnavailableError(error)) {
      throw authSessionUnavailableResponse();
    }
    throw error;
  }

  if (!session) {
    const url = new URL(request.url);
    throw redirect(`/auth/login?redirectTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
  }

  return session;
}

// A deleted account cannot cancel its own subscription, and deletion destroys
// the row linking the user to their Dodo subscription. Keep account deletion
// blocked until billing is settled.
export function assertAccountDeletable(billing: {
  plan: string;
  dodoStatus: string | null;
}) {
  if (billing.plan !== "free") {
    throw new Error(
      "Your subscription is still active. Start cancellation from Plan & billing or open a billing support case first - you keep access until the end of the period you've paid for, and can delete the account after that.",
    );
  }
}
