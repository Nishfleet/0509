import { redirect } from "react-router";

import { requireSession } from "./require-session.server";
import { workspaceLandingForRequest } from "./workspace.server";

export async function requireOnboarded({ request }: { request: Request }): Promise<void> {
  const session = await requireSession(request);
  const landing = await workspaceLandingForRequest(request, session.user);
  if (landing !== null) throw redirect(landing);
}
