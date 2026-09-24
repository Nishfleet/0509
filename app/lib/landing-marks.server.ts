import { env } from "cloudflare:workers";

import { landingMarksFromChanges, type LandingMark } from "./landing-marks";
import { daysBefore, readSiteChangeViews } from "./site-changes.server";

const WINDOW_DAYS = 7;
const READ_LIMIT = 24;

function landingWorkspaceBinding(): unknown {
  return Reflect.get(env, "LANDING_WORKSPACE_ID");
}

export function landingWorkspaceId(): string | null {
  const id = landingWorkspaceBinding();
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  return trimmed === "" ? null : trimmed;
}

export async function readLandingMarks(now: Date): Promise<LandingMark[]> {
  const workspaceId = landingWorkspaceId();
  if (workspaceId === null) return [];
  const views = await readSiteChangeViews({
    workspaceId,
    entityId: null,
    since: daysBefore(now, WINDOW_DAYS),
    limit: READ_LIMIT,
  });
  return landingMarksFromChanges(
    views.map((view) => ({
      id: view.id,
      isSelf: view.isSelf,
      url: view.url,
      capturedAt: view.capturedAt,
      headline: view.headline,
      removed: view.mark?.removed ?? null,
      added: view.mark?.added ?? null,
      before: view.before,
      after: view.after,
    })),
    now,
  );
}
