import { redirect } from "react-router";

import type { AppEnv } from "~/lib/env.server";
import type { AppSession } from "~/lib/types";
import type { WorkspaceContext } from "~/lib/workspace.server";

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

export async function getOptionalSession(
  env: AppEnv,
  request: Request,
): Promise<AppSession | null> {
  return getCachedOptionalSession(env, request);
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
  const { getE2ETestSession } = await import("~/lib/e2e-auth.server");
  const e2eSession = await getE2ETestSession(env, request);
  if (e2eSession) {
    return e2eSession;
  }

  if (!env.DB) {
    return null;
  }

  try {
    const { getBetterAuthSession } = await import("~/lib/better-auth.server");
    return await getBetterAuthSession(env, request);
  } catch (error) {
    console.warn("Better Auth session lookup failed", error);
    return null;
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
  const session = await getOptionalSession(env, request);

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
