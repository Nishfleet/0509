import { redirect } from "react-router";

import type { AppEnv } from "~/lib/env.server";
import type { AppSession } from "~/lib/types";

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
  const { resolveWorkspace } = await import("~/lib/workspace.server");
  const workspace = await resolveWorkspace(env, session.user.id);

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
      "Your subscription is still active. Cancel it first from Plan & billing (Open billing portal) - you keep access until the end of the period you've paid for, and can delete the account after that.",
    );
  }
}
