import type { Route } from "./+types/settings.brief-pause";

import { readWorkspaceIdForOwner, setBriefPaused } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const form = await request.formData();
  const value = form.get("value");
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null || (value !== "pause" && value !== "resume")) return { saved: false };
  await setBriefPaused(workspaceId, value === "pause" ? new Date().toISOString() : null);
  return { saved: true };
}
