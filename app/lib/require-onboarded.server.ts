import { createContext, redirect, type RouterContextProvider } from "react-router";

import { readWorkspaceIdForOwner } from "./data/workspace.server";
import { requireSession } from "./require-session.server";
import { workspaceLandingForRequest } from "./workspace.server";

export const onboardedContext = createContext<{
  session: Awaited<ReturnType<typeof requireSession>>;
  workspaceId: string | null;
}>();

export async function requireOnboarded({
  request,
  context,
}: {
  request: Request;
  context: Pick<RouterContextProvider, "set">;
}): Promise<void> {
  const session = await requireSession(request);
  const [landing, workspaceId] = await Promise.all([
    workspaceLandingForRequest(request, session.user),
    readWorkspaceIdForOwner(session.user.id),
  ]);
  if (landing !== null) throw redirect(landing);
  context.set(onboardedContext, { session, workspaceId });
}
