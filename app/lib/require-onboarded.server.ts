import { createContext, redirect, type RouterContextProvider } from "react-router";

import { sessionForRequest, signOutToLogin, type Session } from "./require-session.server";
import { workspaceLandingForRequest } from "./workspace.server";

export const onboardedContext = createContext<{
  session: Session;
  workspaceId: string | null;
}>();

export async function requireOnboarded({
  request,
  context,
}: {
  request: Request;
  context: Pick<RouterContextProvider, "set">;
}): Promise<void> {
  const session = await sessionForRequest(request);
  const { landing, workspaceId } = await workspaceLandingForRequest(request, session.user);
  if (workspaceId === null) return await signOutToLogin(request);
  if (landing !== null) throw redirect(landing);
  context.set(onboardedContext, { session, workspaceId });
}
