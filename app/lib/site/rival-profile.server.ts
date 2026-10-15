import { setCompetitorDescription } from "../data/entity.server";
import type { SiteSweepTarget } from "../data/watch.server";
import type { ReadUrlResult } from "../fetch/transport.server";
import { extractIdentity } from "../identity/extract";

const MAX_DESCRIPTION = 300;

export async function rememberRivalDescription(target: SiteSweepTarget, read: ReadUrlResult): Promise<void> {
  if (!read.ok || target.pageRole !== "home" || target.entityRole !== "competitor") return;
  try {
    const found = (await extractIdentity(read.html, target.url)).description?.replace(/\s+/g, " ").trim() ?? "";
    if (found === "") return;
    await setCompetitorDescription({
      workspaceId: target.workspaceId,
      entityId: target.entityId,
      description: found.slice(0, MAX_DESCRIPTION),
      readAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "site.description_failed",
        workspaceId: target.workspaceId,
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
  }
}
