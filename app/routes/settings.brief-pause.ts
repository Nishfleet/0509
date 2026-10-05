import type { Route } from "./+types/settings.brief-pause";

import { z } from "zod";

import { readWorkspaceIdForOwner, setBriefPaused } from "../lib/data/workspace.server";
import { requireFreshSession } from "../lib/require-session.server";

const pauseForm = z.object({ value: z.enum(["pause", "resume"]) });

export async function action({ request }: Route.ActionArgs) {
  const session = await requireFreshSession(request);
  const parsed = pauseForm.safeParse(Object.fromEntries(await request.formData()));
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null || !parsed.success) return { saved: false };
  await setBriefPaused(workspaceId, parsed.data.value === "pause" ? new Date().toISOString() : null);
  return { saved: true };
}
