import { redactEmailShaped } from "./auth/redact-email-shaped";
import { createContext, redirect, type RouterContextProvider } from "react-router";

import { sessionForRequest, signOutToLogin, type Session } from "./require-session.server";
import { touchWorkspaceSeen } from "./data/workspace.server";
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
  await touchWorkspaceSeen(workspaceId, new Date()).catch((error: unknown) => {
    console.error(JSON.stringify({ event: "workspace.seen_failed", error: redactEmailShaped(String(error)) }));
  });
  context.set(onboardedContext, { session, workspaceId });
}
