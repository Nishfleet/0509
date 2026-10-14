import { readSilentRivals } from "../data/page.server";
import { readPaidWorkspaceIds } from "../data/plan.server";

const SILENT_DAYS = 7;

export async function checkSilentRivals(now: Date): Promise<void> {
  const since = new Date(now.getTime() - SILENT_DAYS * 86_400_000).toISOString();
  const [rivals, paid] = await Promise.all([readSilentRivals(since), readPaidWorkspaceIds(now)]);
  const silent = rivals.filter((rival) => paid.has(rival.workspaceId));
  if (silent.length === 0) return;
  const byReason: Record<string, number> = {};
  for (const rival of silent) byReason[rival.reason] = (byReason[rival.reason] ?? 0) + 1;
  console.warn(JSON.stringify({ event: "site.rivals_silent", days: SILENT_DAYS, rivals: silent.length, byReason }));
  throw new Error(`site: paid rivals with no snapshot for ${String(SILENT_DAYS)} days`);
}
