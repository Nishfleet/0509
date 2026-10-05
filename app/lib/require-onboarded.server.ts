import { createContext, redirect, type RouterContextProvider } from "react-router";

import { requireSession, signOutToLogin } from "./require-session.server";
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
  const { landing, workspaceId } = await workspaceLandingForRequest(request, session.user);
  if (workspaceId === null) throw await signOutToLogin(request);
  if (landing !== null) throw redirect(landing);
  context.set(onboardedContext, { session, workspaceId });
}
